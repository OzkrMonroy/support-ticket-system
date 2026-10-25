import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { openAssignmentChannel, assignmentQueue } from '../jobs/assignment-queue.js';
import { handleAssignment } from '../jobs/assignment.js';

const prisma = new PrismaClient();
try {
  const { connection, channel } = await openAssignmentChannel();
  connection.on('close', () => {
    console.error('RabbitMQ disconnected; restart the assignment worker.');
    void prisma.$disconnect();
    process.exitCode = 1;
  });
  await channel.prefetch(1);
  await channel.consume(assignmentQueue, (message) => {
    handleAssignment(channel, message, prisma).catch(() => {
      console.error('Assignment consumer unavailable; closing connection.');
      void connection.close().catch(() => {});
    });
  }, { noAck: false });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void connection.close().catch(() => {});
  });
  console.log('Ticket assignment worker listening.');
} catch {
  console.error('Unable to start assignment worker. Check database and broker configuration.');
  await prisma.$disconnect();
  process.exitCode = 1;
}
