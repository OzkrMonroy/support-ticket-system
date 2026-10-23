import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

test('seed stores a password hash and preserves the administrator on repeated runs', async () => {
  const prisma = new PrismaClient();
  const runSeed = () => {
    const result = spawnSync(process.execPath, ['scripts/seed-admin.js'], { encoding: 'utf8' });
    assert.equal(result.status, 0, 'Seed must finish successfully');
  };

  try {
    runSeed();
    const before = await prisma.user.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL } });
    assert.equal(before.role, 'ADMIN');
    assert.equal(before.isActive, true);
    assert.notEqual(before.passwordHash, process.env.ADMIN_PASSWORD);
    assert.equal(await bcrypt.compare(process.env.ADMIN_PASSWORD, before.passwordHash), true);
    runSeed();
    const after = await prisma.user.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL } });
    assert.deepEqual(after, before);
    assert.equal(await prisma.user.count({ where: { email: process.env.ADMIN_EMAIL } }), 1);
  } finally {
    await prisma.$disconnect();
  }
});

test('health endpoint responds with HTTP 200 and the expected JSON', async () => {
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32101', JWT_SECRET: 'setup-test-secret-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => { throw new Error('Server exited before listening'); }),
      new Promise((_, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
        timeout.unref();
      }),
    ]);
    const response = await fetch('http://localhost:32101/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
});
