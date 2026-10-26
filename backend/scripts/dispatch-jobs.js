import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { recoverJobs, dispatchJobs } from '../src/jobs/async-jobs.js';
const prisma = new PrismaClient();
try {
  await recoverJobs(prisma);
  await dispatchJobs(prisma);
} catch { console.error('Job recovery unavailable. Check database/broker and run again.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
