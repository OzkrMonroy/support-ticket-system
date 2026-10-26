import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import amqp from 'amqplib';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';

process.env.ASSIGNMENT_QUEUE = `hu13-assignment-${randomUUID()}`;
process.env.NOTIFICATION_QUEUE = `hu13-notification-${randomUUID()}`;
const { createJob, dispatchJobs, recoverJobs, processJob, handleJob, failureKind } = await import('../src/jobs/async-jobs.js');
const prisma = new PrismaClient();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('durable jobs, retries, recovery, idempotency and API visibility', async (t) => {
  const userIds = [];
  const tickets = [];
  const user = async (role) => {
    const value = await prisma.user.create({ data: { name: 'HU13', email: `${randomUUID()}@example.test`, passwordHash: 'unused', role } });
    userIds.push(value.id); return value;
  };
  const client = await user('CLIENT'), other = await user('CLIENT'), admin = await user('ADMIN'), tech = await user('TECHNICIAN');
  const ticket = await prisma.ticket.create({ data: { title: 'HU13', description: 'Private', priority: 'HIGH', createdById: client.id } });
  tickets.push(ticket.id);
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();
  let server;
  try {
    await t.test('rollback creates neither business event nor jobs; repeated event creation is unique', async () => {
      await assert.rejects(prisma.$transaction(async (tx) => {
        await createJob(tx, 'EMAIL_NOTIFICATION', ticket, 'TICKET_CLOSED');
        throw Error('rollback');
      }));
      assert.equal(await prisma.asyncJob.count({ where: { ticketId: ticket.id } }), 0);
      const first = await createJob(prisma, 'EMAIL_NOTIFICATION', ticket, 'TICKET_CREATED');
      assert.equal((await createJob(prisma, 'EMAIL_NOTIFICATION', ticket, 'TICKET_CREATED')).id, first.id);
    });
    await t.test('outage leaves pending; uncertain confirmation/republication and duplicate delivery send once', async () => {
      const job = await prisma.asyncJob.findFirstOrThrow({ where: { ticketId: ticket.id } });
      await dispatchJobs(prisma, async () => { throw Error('secret broker credentials'); }, ticket.id);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).publishedAt, null);
      let publications = 0;
      await dispatchJobs(prisma, async () => { publications++; throw Error('confirmation lost'); }, ticket.id);
      await dispatchJobs(prisma, async () => { publications++; }, ticket.id);
      assert.equal(publications, 2);
      let sends = 0;
      const transport = { sendMail: async () => { sends++; return { accepted: ['test'] }; } };
      await Promise.all([processJob(prisma, job.id, 0, job.type, transport, 'test'), processJob(prisma, job.id, 0, job.type, transport, 'test')]);
      await processJob(prisma, job.id, 0, job.type, transport, 'test');
      assert.equal(sends, 1);
      const done = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(done.status, 'COMPLETED'); assert.equal(done.result, 'SUCCESS'); assert.equal(done.attempts, 1);
    });
    await t.test('real broker retries after 5s and 15s; three transient SMTP failures become FAILED', async () => {
      const job = await createJob(prisma, 'EMAIL_NOTIFICATION', { ...ticket, status: 'RESOLVED' }, 'TICKET_RESOLVED');
      let sends = 0;
      const transport = { sendMail: async () => { sends++; throw Object.assign(Error('secret SMTP address'), { code: 'ETIMEDOUT' }); } };
      await dispatchJobs(prisma, undefined, ticket.id);
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = Date.now();
        let message;
        while (!(message = await channel.get(process.env.NOTIFICATION_QUEUE))) {
          assert.ok(Date.now() - started < 23000, 'retry delivery timeout');
          await pause(100);
        }
        const elapsed = Date.now() - started;
        if (attempt) assert.ok(elapsed >= (attempt === 1 ? 4800 : 14800), `retry arrived after ${elapsed}ms`);
        assert.equal(JSON.parse(message.content).jobId, job.id);
        await handleJob(channel, message, prisma, job.type, transport, 'test');
      }
      const failed = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(sends, 3); assert.equal(failed.attempts, 3); assert.equal(failed.status, 'FAILED');
      assert.equal(failed.lastError, 'transient-processing-error');
      assert.equal(await channel.get(process.env.NOTIFICATION_QUEUE), false);
    });
    await t.test('permanent auth errors stop immediately; transient succeeds on retry; stale messages cannot bypass schedule', async () => {
      assert.equal(failureKind({ responseCode: 450 }).permanent, false);
      assert.equal(failureKind({ responseCode: 550 }).permanent, true);
      const job = await createJob(prisma, 'EMAIL_NOTIFICATION', { ...ticket, status: 'CLOSED' }, 'TICKET_CLOSED');
      await processJob(prisma, job.id, 0, job.type, { sendMail: async () => { throw Object.assign(Error('secret'), { code: 'EAUTH' }); } }, 'test');
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'FAILED');
      const retry = await prisma.asyncJob.create({ data: { ticketId: ticket.id, type: 'EMAIL_NOTIFICATION', eventKey: randomUUID(), payload: job.payload } });
      await processJob(prisma, retry.id, 0, retry.type, { sendMail: async () => { throw Error('temporary'); } }, 'test');
      let sent = 0; const transport = { sendMail: async () => { sent++; return { accepted: ['test'] }; } };
      await processJob(prisma, retry.id, 0, retry.type, transport, 'test');
      await processJob(prisma, retry.id, 1, retry.type, transport, 'test');
      assert.equal(sent, 0);
      await prisma.asyncJob.update({ where: { id: retry.id }, data: { availableAt: new Date(0) } });
      await processJob(prisma, retry.id, 1, retry.type, transport, 'test');
      assert.equal(sent, 1);
    });
    await t.test('interrupted claims and lost publications recover; active claims stay protected; final interruption is bounded', async () => {
      const job = await createJob(prisma, 'TICKET_ASSIGNMENT', ticket);
      await prisma.asyncJob.update({ where: { id: job.id }, data: { status: 'PROCESSING', attempts: 1,
        claimedAt: new Date(), claimToken: randomUUID() } });
      await recoverJobs(prisma, undefined, ticket.id);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'PROCESSING');
      await prisma.asyncJob.update({ where: { id: job.id }, data: { claimedAt: new Date(0) } });
      await recoverJobs(prisma, undefined, ticket.id);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'PENDING');
      await prisma.asyncJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
      await processJob(prisma, job.id, 1, job.type);
      const done = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(done.status, 'COMPLETED');
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.ok(after.assignedToId);
      await processJob(prisma, job.id, 1, job.type);
      assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assignedToId, after.assignedToId);
      assert.equal(await prisma.asyncJob.count({ where: { ticketId: ticket.id, event: 'TICKET_ASSIGNED' } }), 1);
      const interrupted = await prisma.asyncJob.create({ data: { ticketId: ticket.id, type: job.type, eventKey: randomUUID(), payload: {}, status: 'PROCESSING', attempts: 3, claimedAt: new Date(0) } });
      await recoverJobs(prisma, undefined, ticket.id);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: interrupted.id } })).status, 'FAILED');
      const skipped = await prisma.asyncJob.create({ data: { ticketId: ticket.id, type: job.type, eventKey: randomUUID(), payload: {} } });
      await processJob(prisma, skipped.id, 0, skipped.type);
      const result = await prisma.asyncJob.findUniqueOrThrow({ where: { id: skipped.id } });
      assert.equal(result.result, 'SKIPPED'); assert.equal(result.lastError, 'already-assigned');
      await prisma.asyncJob.update({ where: { id: skipped.id }, data: { status: 'PENDING', publishedAt: new Date(0) } });
      await recoverJobs(prisma, undefined, ticket.id);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: skipped.id } })).publishedAt, null);
    });
    await t.test('assignment commit failure rolls back assignment and notification; next attempt succeeds', async () => {
      const fresh = await prisma.ticket.create({ data: { title: 'Rollback', description: 'Test', priority: 'MEDIUM', createdById: client.id } });
      tickets.push(fresh.id);
      const job = await createJob(prisma, 'TICKET_ASSIGNMENT', fresh);
      const broken = { asyncJob: prisma.asyncJob, $transaction: (callback, options) => prisma.$transaction(async (tx) => {
        await callback(tx);
        throw Error('simulated transaction failure');
      }, options) };
      await processJob(broken, job.id, 0, job.type);
      assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: fresh.id } })).assignedToId, null);
      assert.equal(await prisma.asyncJob.count({ where: { ticketId: fresh.id, event: 'TICKET_ASSIGNED' } }), 0);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'PENDING');
      await prisma.asyncJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
      await processJob(prisma, job.id, 1, job.type);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).result, 'SUCCESS');
      assert.equal(await prisma.asyncJob.count({ where: { ticketId: fresh.id, event: 'TICKET_ASSIGNED' } }), 1);
    });
    await t.test('no active technician completes as SKIPPED without retry', async () => {
      const fresh = await prisma.ticket.create({ data: { title: 'No technicians', description: 'Test', priority: 'LOW', createdById: client.id } });
      tickets.push(fresh.id);
      const job = await createJob(prisma, 'TICKET_ASSIGNMENT', fresh);
      const noTechnicians = { asyncJob: prisma.asyncJob, $transaction: (callback, options) => prisma.$transaction((tx) =>
        callback(new Proxy(tx, { get(target, key) { return key === 'user' ? { findMany: async () => [] } : target[key]; } })), options) };
      await processJob(noTechnicians, job.id, 0, job.type);
      const done = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(done.status, 'COMPLETED'); assert.equal(done.result, 'SKIPPED');
      assert.equal(done.lastError, 'no-technicians'); assert.equal(done.attempts, 1);
    });
    await t.test('terminated SMTP process leaves a recoverable claim; restarted processing finishes', async () => {
      const source = await prisma.asyncJob.findFirstOrThrow({ where: { ticketId: ticket.id, event: 'TICKET_CREATED' } });
      const job = await prisma.asyncJob.create({ data: { ticketId: ticket.id, type: source.type, eventKey: randomUUID(), payload: source.payload } });
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        import 'dotenv/config';
        import { PrismaClient } from '@prisma/client';
        import { processJob } from './src/jobs/async-jobs.js';
        const db = new PrismaClient();
        await processJob(db, ${JSON.stringify(job.id)}, 0, 'EMAIL_NOTIFICATION', {
          sendMail: async () => { console.log('claimed-before-send'); await new Promise(() => {}); }
        }, 'test');
        await db.$disconnect();
      `], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        const [output] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw Error('child exited before claim'); })]);
        assert.match(output.toString(), /claimed-before-send/);
      } finally { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'PROCESSING');
      // Advance the persisted lease age without waiting two minutes in the suite.
      await prisma.asyncJob.update({ where: { id: job.id }, data: { claimedAt: new Date(0) } });
      await recoverJobs(prisma, undefined, ticket.id);
      await prisma.asyncJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
      await processJob(prisma, job.id, 1, job.type, { sendMail: async () => ({ accepted: ['test'] }) }, 'test');
      const done = await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(done.status, 'COMPLETED'); assert.equal(done.attempts, 2);
    });
    await t.test('legacy assignment delivery is adopted and duplicate effects are suppressed', async () => {
      const legacy = await prisma.ticket.create({ data: { title: 'Legacy', description: 'Test', priority: 'LOW', createdById: client.id } });
      tickets.push(legacy.id);
      const job = await createJob(prisma, 'TICKET_ASSIGNMENT', legacy);
      let acks = 0;
      const localChannel = { ack: () => { acks++; }, nack: () => assert.fail('legacy delivery rejected') };
      const message = { content: Buffer.from(JSON.stringify({ ticketId: legacy.id })) };
      await handleJob(localChannel, message, prisma, job.type);
      await handleJob(localChannel, message, prisma, job.type);
      assert.equal(acks, 2);
      assert.equal((await prisma.asyncJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'COMPLETED');
      assert.equal(await prisma.asyncJob.count({ where: { ticketId: legacy.id, event: 'TICKET_ASSIGNED' } }), 1);
    });
    await t.test('GET jobs requires current visibility and returns only safe fields newest first', async () => {
      server = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: '32113', JWT_SECRET: 'hu13-test' }, stdio: ['ignore', 'pipe', 'pipe'] });
      await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw Error('server exited'); })]);
      const get = (id, account) => fetch(`http://localhost:32113/api/tickets/${id}/jobs`, { headers: account ? {
        Authorization: `Bearer ${jwt.sign({ id: account.id, role: account.role }, 'hu13-test', { expiresIn: '15m' })}` } : {} });
      assert.equal((await get(ticket.id)).status, 401);
      assert.equal((await get('invalid', client)).status, 400);
      assert.equal((await get(randomUUID(), client)).status, 404);
      assert.equal((await get(ticket.id, other)).status, 404);
      await prisma.ticket.update({ where: { id: ticket.id }, data: { assignedToId: tech.id } });
      for (const account of [client, admin, tech]) {
        const response = await get(ticket.id, account); assert.equal(response.status, 200);
        const jobs = await response.json(); assert.ok(Array.isArray(jobs)); assert.ok(jobs.length >= 4);
        assert.ok(jobs.every((value) => !('payload' in value) && !('eventKey' in value) && !('claimToken' in value)));
        assert.deepEqual(jobs.map((value) => value.createdAt), jobs.map((value) => value.createdAt).sort().reverse());
      }
      await prisma.ticket.update({ where: { id: ticket.id }, data: { deletedAt: new Date() } });
      assert.equal((await get(ticket.id, admin)).status, 404);
    });
  } finally {
    if (server) { const exited = once(server, 'exit'); server.kill(); await exited; }
    await prisma.ticket.deleteMany({ where: { id: { in: tickets } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const queue of [process.env.ASSIGNMENT_QUEUE, process.env.NOTIFICATION_QUEUE]) {
      for (const suffix of ['', '.retry.5000', '.retry.15000']) await channel.deleteQueue(queue + suffix);
    }
    await connection.close(); await prisma.$disconnect();
  }
});
