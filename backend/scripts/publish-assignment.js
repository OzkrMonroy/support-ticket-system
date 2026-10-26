import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createJob, dispatchJobs } from '../src/jobs/async-jobs.js';

const prisma = new PrismaClient();
try {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: process.argv[2] } });
  await createJob(prisma, 'TICKET_ASSIGNMENT', ticket);
  await dispatchJobs(prisma, undefined, ticket.id);
  console.log(`Assignment job persisted: ${ticket.id}`);
} catch {
  console.error('Unable to publish assignment. Supply an existing ticket UUID and check the broker.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
