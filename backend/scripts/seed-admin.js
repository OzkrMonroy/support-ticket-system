import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

try {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME?.trim() || !ADMIN_EMAIL?.trim() || !ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD before running the seed.');
  }
  // Bcrypt uses at most 72 bytes; reject longer passwords instead of truncating them.
  if (Buffer.byteLength(ADMIN_PASSWORD, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD must not exceed 72 UTF-8 bytes.');
  }

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing && existing.role !== 'ADMIN') {
    throw new Error('ADMIN_EMAIL already belongs to a non-administrator user.');
  }

  if (existing) {
    console.log('Administrator already exists; no changes made.');
  } else {
    await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
        role: 'ADMIN',
      },
    });
    console.log('Administrator created.');
  }
} catch (error) {
  // Do not print database connection details or credentials.
  console.error(error instanceof Error && !error.name.startsWith('Prisma')
    ? error.message
    : 'Administrator seed failed. Check the database connection and migrations.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
