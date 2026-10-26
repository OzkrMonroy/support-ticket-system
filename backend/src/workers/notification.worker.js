import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createMailTransport } from '../jobs/smtp.js';
import { openNotificationChannel, notificationQueue } from '../jobs/notification-queue.js';
import { handleJob } from '../jobs/async-jobs.js';

const prisma = new PrismaClient();

try {
  const transport = createMailTransport();
  const { connection, channel } = await openNotificationChannel();
  connection.on('close', () => {
    console.error('RabbitMQ disconnected; restart the notification worker.');
    transport.close();
    void prisma.$disconnect();
    process.exitCode = 1;
  });
  await channel.prefetch(1);
  await channel.consume(notificationQueue, (message) => {
    handleJob(channel, message, prisma, 'EMAIL_NOTIFICATION', transport, process.env.EMAIL_FROM).catch(() => {
      console.error('Notification consumer unavailable; closing connection.');
      void connection.close().catch(() => {});
    });
  }, { noAck: false });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void connection.close().catch(() => {});
  });
  console.log('Ticket notification worker listening.');
} catch {
  console.error('Unable to start notification worker. Check SMTP environment and broker configuration.');
  process.exitCode = 1;
}
