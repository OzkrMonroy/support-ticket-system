import amqp from 'amqplib';

export const notificationQueue = process.env.NOTIFICATION_QUEUE || 'ticket-notification';
export const queueOptions = { durable: true, arguments: { 'x-queue-type': 'classic' } };

export async function openNotificationChannel(confirm = false) {
  if (!process.env.RABBITMQ_URL) throw new Error('Set RABBITMQ_URL.');
  const connection = await amqp.connect(process.env.RABBITMQ_URL, { timeout: 5000 });
  connection.on('error', () => console.error('RabbitMQ connection error.'));
  try {
    const channel = await (confirm ? connection.createConfirmChannel() : connection.createChannel());
    channel.on('error', () => console.error('RabbitMQ channel error.'));
    await channel.assertQueue(notificationQueue, queueOptions);
    return { connection, channel };
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
}

export async function publishNotification(job, openChannel = openNotificationChannel) {
  const { connection, channel } = await openChannel(true);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Publish confirmation timed out.')), 5000);
      channel.sendToQueue(notificationQueue, Buffer.from(JSON.stringify(job)), {
        persistent: true, contentType: 'application/json',
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
