import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('login validates requests, credentials, active status, roles, and signed tokens', async (t) => {
  const prisma = new PrismaClient();
  const secret = 'login-test-secret-only';
  const password = 'integration-test-password';
  const createdIds = [];
  const adminSessionIds = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32102', JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const request = async (body) => {
    const response = await fetch('http://localhost:32102/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => { throw new Error('Server exited before listening'); }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Server startup timed out')), 5000).unref();
      }),
    ]);
    const passwordHash = await bcrypt.hash(password, 4);
    for (const role of ['ADMIN', 'CLIENT', 'TECHNICIAN']) {
      await t.test(`active ${role} receives a signed access token`, async () => {
        const user = await prisma.user.create({ data: {
          name: 'Login Test', email: `${randomUUID()}@example.test`, passwordHash, role,
        } });
        createdIds.push(user.id);
        const result = await request({ email: user.email, password });
        assert.equal(result.status, 200);
        assert.deepEqual(Object.keys(result.body).sort(), ['accessToken', 'refreshToken', 'user']);
        assert.match(result.body.refreshToken, /^[a-f0-9]{64}$/);
        assert.deepEqual(result.body.user, {
          id: user.id, name: user.name, email: user.email, role,
        });
        const payload = jwt.verify(result.body.accessToken, secret, { algorithms: ['HS256'] });
        assert.equal(payload.id, user.id);
        assert.equal(payload.role, role);
        assert.equal(payload.exp - payload.iat, 900);
        assert.throws(() => jwt.verify(result.body.accessToken, 'wrong-secret'));
        assert.throws(() => jwt.verify(result.body.accessToken, secret, {
          clockTimestamp: payload.exp + 1,
        }));
      });
    }

    await t.test('seeded administrator can log in', async () => {
      const result = await request({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
      assert.equal(result.status, 200);
      assert.equal(result.body.user.role, 'ADMIN');
      const session = await prisma.refreshSession.findUniqueOrThrow({ where: {
        tokenHash: createHash('sha256').update(result.body.refreshToken).digest('hex'),
      } });
      adminSessionIds.push(session.id);
    });

    await t.test('incorrect passwords and unknown emails return 401; inactive status requires a correct password', async () => {
      const active = await prisma.user.findUniqueOrThrow({ where: { id: createdIds[0] } });
      const inactive = await prisma.user.create({ data: {
        name: 'Inactive Test', email: `${randomUUID()}@example.test`, passwordHash,
        role: 'CLIENT', isActive: false,
      } });
      createdIds.push(inactive.id);
      const sessionCount = await prisma.refreshSession.count({ where: { userId: active.id } });
      for (const credentials of [
        { email: `${randomUUID()}@example.test`, password },
        { email: active.email, password: 'wrong-password' },
        { email: inactive.email, password: 'wrong-password' },
      ]) {
        assert.deepEqual(await request(credentials), {
          status: 401, body: { message: 'Invalid credentials.' },
        });
      }
      assert.deepEqual(await request({ email: inactive.email, password }), {
        status: 403, body: { message: 'Your account has been deactivated. Contact an administrator.' },
      });
      assert.equal(await prisma.refreshSession.count({ where: { userId: inactive.id } }), 0);
      assert.equal(await prisma.refreshSession.count({ where: { userId: active.id } }), sessionCount);
    });

    await t.test('malformed email returns a field error', async () => {
      assert.deepEqual(await request({ email: 'invalid', password }), {
        status: 400, body: { message: 'Validation failed.', errors: { email: 'Invalid email address.' } },
      });
    });

    await t.test('missing fields, invalid types, and malformed JSON return 400', async () => {
      for (const body of [{}, { email: 'a' }, { password },
        { email: 42, password }, { email: 'a', password: [] },
        { email: '', password }, { email: 'a', password: ' ' }, null]) {
        assert.equal((await request(body)).status, 400);
      }
      const response = await fetch('http://localhost:32102/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'Invalid JSON body.' });
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    // Remove only fixtures created by this test, never existing application users.
    await prisma.refreshSession.deleteMany({ where: { OR: [
      { userId: { in: createdIds } }, { id: { in: adminSessionIds } },
    ] } });
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  }
});
