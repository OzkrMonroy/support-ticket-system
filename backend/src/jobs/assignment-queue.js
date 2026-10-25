import amqp from 'amqplib';

export const assignmentQueue = 'ticket-assignment';
export const queueOptions = { durable: true, arguments: { 'x-queue-type': 'classic', 'x-max-priority': 3 } };
export const priorities = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export async function openAssignmentChannel(confirm = false) {
  if (!process.env.RABBITMQ_URL) throw new Error('Set RABBITMQ_URL.');
  const connection = await amqp.connect(process.env.RABBITMQ_URL, { timeout: 5000 });
  connection.on('error', () => console.error('RabbitMQ connection error.'));
  try {
    const channel = await (confirm ? connection.createConfirmChannel() : connection.createChannel());
    channel.on('error', () => console.error('RabbitMQ channel error.'));
    await channel.assertQueue(assignmentQueue, queueOptions);
    return { connection, channel };
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
}

export async function publishAssignment(ticket, openChannel = openAssignmentChannel) {
  const { connection, channel } = await openChannel(true);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Publish confirmation timed out.')), 5000);
      channel.sendToQueue(assignmentQueue, Buffer.from(JSON.stringify({ ticketId: ticket.id })), {
        persistent: true, priority: priorities[ticket.priority], contentType: 'application/json',
      }, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    });
  } finally {
    await connection.close().catch(() => {});
  }
}
