import { publishNotification } from './notification-queue.js';

export const notificationEvents = ['TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_RESOLVED', 'TICKET_CLOSED'];

export async function queueTicketNotification(prisma, event, ticket, publish = publishNotification, log = console) {
  try {
    const userId = event === 'TICKET_ASSIGNED' ? ticket.assignedToId : ticket.createdById;
    const recipient = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!recipient) throw new Error('Recipient unavailable.');
    await publish({ event, ticketId: ticket.id, title: ticket.title, priority: ticket.priority,
      status: ticket.status, to: recipient.email });
    log.info(`Notification ${event} ${ticket.id}: queued.`);
    return true;
  } catch {
    log.error(`Notification ${event} ${ticket.id}: publication failed; operation remains committed, manual recovery required.`);
    return false;
  }
}

const headings = {
  TICKET_CREATED: 'Tu ticket ha sido creado',
  TICKET_ASSIGNED: 'Se te ha asignado un ticket',
  TICKET_RESOLVED: 'Tu ticket ha sido resuelto',
  TICKET_CLOSED: 'Tu ticket ha sido cerrado',
};
const priorities = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };
const statuses = { OPEN: 'Abierto', IN_PROGRESS: 'En progreso', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function renderNotification(job) {
  const heading = headings[job.event];
  if (!notificationEvents.includes(job.event)) throw new Error('Invalid notification event.');
  const lines = [heading, `Ticket: ${job.ticketId}`, `Título: ${job.title}`,
    `Prioridad: ${priorities[job.priority]}`, `Estado: ${statuses[job.status]}`];
  return { subject: `${heading} (${job.ticketId})`, text: lines.join('\n'),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') };
}

export async function handleNotification(channel, message, transport, from, log = console) {
  if (!message) throw new Error('Notification consumer cancelled.');
  let label = 'invalid-message';
  try {
    const job = JSON.parse(message.content.toString());
    if (!notificationEvents.includes(job.event) ||
        typeof job.ticketId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.ticketId)) {
      throw new Error('Invalid notification message.');
    }
    label = `${job.event} ${job.ticketId}`;
    if (typeof job.title !== 'string' || !Object.hasOwn(priorities, job.priority) || !Object.hasOwn(statuses, job.status) ||
        typeof job.to !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(job.to)) {
      throw new Error('Invalid notification fields.');
    }
    const result = await transport.sendMail({ from, to: { address: job.to, name: '' }, ...renderNotification(job) });
    if (!result.accepted?.length) throw new Error('Recipient not accepted.');
    log.info(`Notification ${label}: sent.`);
    channel.ack(message);
  } catch (error) {
    // Never log provider messages: they can contain addresses or authentication details.
    const code = ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(error?.code)
      ? error.code : 'PROCESSING_ERROR';
    const response = Number.isInteger(error?.responseCode) ? ` SMTP ${error.responseCode}` : '';
    log.error(`Notification ${label}: ${code}${response}; rejected without requeue.`);
    channel.nack(message, false, false);
  }
}
