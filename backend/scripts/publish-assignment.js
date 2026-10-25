import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { publishAssignment } from '../src/jobs/assignment-queue.js';

const prisma = new PrismaClient();
try {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: process.argv[2] } });
  await publishAssignment(ticket);
  console.log(`Assignment published: ${ticket.id}`);
} catch {
  console.error('Unable to publish assignment. Supply an existing ticket UUID and check the broker.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
