import { openAssignmentChannel, assignmentQueue, priorities } from './assignment-queue.js';
import { openNotificationChannel, notificationQueue } from './notification-queue.js';

export async function publishJob(job) {
  const assignment = job.type === 'TICKET_ASSIGNMENT';
  const queue = assignment ? assignmentQueue : notificationQueue;
  const { connection, channel } = await (assignment ? openAssignmentChannel : openNotificationChannel)(true);
  try {
    const delay = job.attempts === 1 ? 5000 : job.attempts >= 2 ? 15000 : 0;
    const destination = delay ? `${queue}.retry.${delay}` : queue;
    if (delay) await channel.assertQueue(destination, {
      durable: true, arguments: { 'x-message-ttl': delay, 'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue, 'x-queue-type': 'classic' },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Publish timeout')), 5000);
      channel.sendToQueue(destination, Buffer.from(JSON.stringify({ jobId: job.id, attempt: job.attempts,
        ticketId: job.ticketId })), { persistent: true, contentType: 'application/json',
        priority: assignment ? priorities[job.payload.priority] : undefined }, (error) => {
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      });
    });
  } finally { await connection.close().catch(() => {}); }
}
