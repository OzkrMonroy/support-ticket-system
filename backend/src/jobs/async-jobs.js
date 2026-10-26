import { randomUUID } from 'node:crypto';
import { publishJob } from './job-queue.js';
import { assignTicket } from './assignment.js';
import { renderNotification, notificationEvents } from './notifications.js';

export const publicJobSelect = Object.fromEntries(['id', 'type', 'event', 'status', 'result', 'attempts',
  'maxAttempts', 'lastError', 'createdAt', 'updatedAt'].map((key) => [key, true]));

export async function createJob(tx, type, ticket, event = null) {
  const eventKey = `${ticket.id}:${event || type}`;
  let payload = { priority: ticket.priority };
  if (event) {
    const recipient = await tx.user.findUniqueOrThrow({
      where: { id: event === 'TICKET_ASSIGNED' ? ticket.assignedToId : ticket.createdById },
      select: { email: true },
    });
    payload = { event, ticketId: ticket.id, title: ticket.title, priority: ticket.priority,
      status: ticket.status, to: recipient.email };
  }
  return tx.asyncJob.upsert({ where: { eventKey }, update: {},
    create: { ticketId: ticket.id, type, event, eventKey, payload } });
}

// One-shot outbox dispatch. Duplicate publication is safe; never mark before confirmation.
export async function dispatchJobs(prisma, publish = publishJob, ticketId) {
  const jobs = await prisma.asyncJob.findMany({ where: { status: 'PENDING', publishedAt: null,
    ...(ticketId ? { ticketId } : {}) }, orderBy: { createdAt: 'asc' }, take: 100 });
  for (const job of jobs) {
    try {
      await publish(job);
      await prisma.asyncJob.updateMany({ where: { id: job.id, status: 'PENDING', attempts: job.attempts,
        publishedAt: null }, data: { publishedAt: new Date() } });
    } catch { console.error(`Job ${job.id} ticket ${job.ticketId} ${job.type}/${job.event || '-'} PENDING attempt ${job.attempts}: dispatch-unavailable`); }
  }
}

// Locks held by active processing transactions prevent concurrent recovery/business effects.
export async function recoverJobs(prisma, now = new Date(), ticketId) {
  const stale = new Date(now.getTime() - 120000);
  const scope = ticketId ? { ticketId } : {};
  await prisma.asyncJob.updateMany({ where: { ...scope, status: 'PROCESSING', claimedAt: { lt: stale }, attempts: { gte: 3 } },
    data: { status: 'FAILED', lastError: 'interrupted-attempt-limit', claimToken: null, claimedAt: null } });
  await prisma.asyncJob.updateMany({ where: { ...scope, status: 'PROCESSING', claimedAt: { lt: stale }, attempts: { lt: 3 } },
    data: { status: 'PENDING', lastError: 'interrupted', claimToken: null, claimedAt: null,
      publishedAt: null, availableAt: now } });
  await prisma.asyncJob.updateMany({ where: { ...scope, status: 'PENDING', publishedAt: { lt: new Date(now.getTime() - 300000) } },
    data: { publishedAt: null } });
}

export function failureKind(error) {
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE', 'INVALID_JOB'].includes(error?.code) || error?.responseCode >= 500) {
    return { permanent: true, reason: 'permanent-processing-error' };
  }
  return { permanent: false, reason: 'transient-processing-error' };
}

export async function processJob(prisma, jobId, attempt, type, transport, from) {
  const token = randomUUID();
  const claimed = await prisma.asyncJob.updateMany({ where: { id: jobId, type, status: 'PENDING',
    attempts: attempt, availableAt: { lte: new Date() } },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, claimedAt: new Date(), claimToken: token } });
  if (!claimed.count) return;
  try {
    const completed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AsyncJob" WHERE id = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.asyncJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status !== 'PROCESSING' || job.claimToken !== token) return;
      let result = 'SUCCESS', reason = null;
      if (type === 'TICKET_ASSIGNMENT') {
        let assigned;
        const outcome = await assignTicket(tx, job.ticketId, (value) => { reason = value; }, (value) => { assigned = value; });
        if (outcome === 'assigned') await createJob(tx, 'EMAIL_NOTIFICATION', assigned, 'TICKET_ASSIGNED');
        else { result = 'SKIPPED'; reason ||= outcome; }
      } else {
        const mail = job.payload;
        if (!notificationEvents.includes(mail.event) || typeof mail.to !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail.to) ||
            typeof mail.title !== 'string' || !['LOW', 'MEDIUM', 'HIGH'].includes(mail.priority) ||
            !['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(mail.status)) {
          throw Object.assign(new Error('Invalid job'), { code: 'INVALID_JOB' });
        }
        const sent = await transport.sendMail({ from, to: { address: mail.to, name: '' }, ...renderNotification(mail) });
        if (!sent.accepted?.length) throw Object.assign(new Error('Rejected recipient'), { code: 'EENVELOPE' });
      }
      await tx.asyncJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', result,
        lastError: reason, claimToken: null, claimedAt: null } });
      return { job, result, reason };
    }, { timeout: 60000 });
    if (completed) {
      const { job, result, reason } = completed;
      console.info(`Job ${job.id} ticket ${job.ticketId} ${job.type}/${job.event || '-'} COMPLETED attempt ${job.attempts}: ${reason || result}`);
    }
  } catch (error) {
    const { permanent, reason } = failureKind(error);
    const job = await prisma.asyncJob.findUniqueOrThrow({ where: { id: jobId } });
    const failed = permanent || job.attempts >= job.maxAttempts;
    await prisma.asyncJob.updateMany({ where: { id: jobId, status: 'PROCESSING', claimToken: token },
      data: { status: failed ? 'FAILED' : 'PENDING', lastError: reason, claimedAt: null, claimToken: null,
        publishedAt: null, availableAt: new Date(Date.now() + (job.attempts === 1 ? 5000 : 15000)) } });
    console.error(`Job ${job.id} ticket ${job.ticketId} ${job.type}/${job.event || '-'} ${failed ? 'FAILED' : 'PENDING'} attempt ${job.attempts}: ${reason}`);
  }
}

export async function handleJob(channel, message, prisma, type, transport, from) {
  if (!message) throw new Error('Consumer cancelled');
  let data;
  try { data = JSON.parse(message.content.toString()); } catch { channel.nack(message, false, false); return; }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!data?.jobId && uuid.test(data?.ticketId)) {
    // Adopt queued HU-11/HU-12 messages without discarding pending work.
    const ticket = await prisma.ticket.findUnique({ where: { id: data.ticketId } });
    if (!ticket) { console.info(`Legacy delivery ticket ${data.ticketId}: not-found`); channel.ack(message); return; }
    let job;
    if (type === 'TICKET_ASSIGNMENT') job = await createJob(prisma, type, ticket);
    else if (['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_RESOLVED', 'TICKET_CLOSED'].includes(data.event)) {
      const eventKey = `${ticket.id}:${data.event}`;
      job = await prisma.asyncJob.upsert({ where: { eventKey }, update: {},
        create: { ticketId: ticket.id, type, event: data.event, eventKey, payload: data } });
    }
    if (job) data = { jobId: job.id, attempt: 0 };
  }
  if (!uuid.test(data?.jobId) || !Number.isInteger(data.attempt) || data.attempt < 0 || data.attempt > 2) {
    console.error('Invalid delivery rejected: invalid-job-envelope');
    channel.nack(message, false, false); return;
  }
  await processJob(prisma, data.jobId, data.attempt, type, transport, from);
  channel.ack(message);
  const job = await prisma.asyncJob.findUnique({ where: { id: data.jobId }, select: { ticketId: true } });
  if (job) await dispatchJobs(prisma, undefined, job.ticketId);
}
