import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('refresh tokens are hashed, rotated atomically, and rejected when unusable', async (t) => {
  const prisma = new PrismaClient();
  const secret = 'refresh-test-secret-only';
  const password = 'refresh-test-password';
  let user;
  const hash = (token) => createHash('sha256').update(token).digest('hex');
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32103', JWT_SECRET: secret, REFRESH_TOKEN_EXPIRES_DAYS: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const request = async (path, body) => {
    const response = await fetch(`http://localhost:32103/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const login = () => request('login', { email: user.email, password });
  const refresh = (token) => request('refresh', { refreshToken: token });
  const unauthorized = { status: 401, body: { message: 'Invalid refresh token.' } };

  try {
    await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => { throw new Error('Server exited before listening'); }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Server startup timed out')), 5000).unref();
      }),
    ]);
    user = await prisma.user.create({ data: {
      name: 'Refresh Test', email: `${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash(password, 4), role: 'CLIENT',
    } });

    await t.test('login stores only a hash with the configured lifetime; refresh rotates both tokens', async () => {
      const initial = await login();
      assert.equal(initial.status, 200);
      const token = initial.body.refreshToken;
      assert.match(token, /^[a-f0-9]{64}$/);
      const session = await prisma.refreshSession.findUniqueOrThrow({ where: { tokenHash: hash(token) } });
      assert.notEqual(session.tokenHash, token);
      assert.equal(session.userId, user.id);
      assert.equal(session.revokedAt, null);
      assert.ok(Math.abs(session.expiresAt - session.createdAt - 2 * 86400000) < 5000);
      assert.equal(await prisma.refreshSession.count({ where: { tokenHash: token } }), 0);

      const renewed = await refresh(token);
      assert.equal(renewed.status, 200);
      assert.deepEqual(Object.keys(renewed.body).sort(), ['accessToken', 'refreshToken']);
      assert.notEqual(renewed.body.refreshToken, token);
      const payload = jwt.verify(renewed.body.accessToken, secret, { algorithms: ['HS256'] });
      assert.equal(payload.id, user.id);
      assert.equal(payload.role, user.role);
      assert.equal(payload.exp - payload.iat, 900);
      assert.ok((await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt);
      const replacement = await prisma.refreshSession.findUniqueOrThrow({
        where: { tokenHash: hash(renewed.body.refreshToken) },
      });
      assert.equal(replacement.revokedAt, null);
      assert.equal(replacement.userId, user.id);
      assert.deepEqual(await refresh(token), unauthorized);
      assert.equal((await refresh(renewed.body.refreshToken)).status, 200);
    });

    await t.test('only one simultaneous exchange can consume a refresh token', async () => {
      const initial = await login();
      const count = await prisma.refreshSession.count({ where: { userId: user.id } });
      const results = await Promise.all([refresh(initial.body.refreshToken), refresh(initial.body.refreshToken)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
      assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), count + 1);
      assert.equal((await refresh(results.find((result) => result.status === 200).body.refreshToken)).status, 200);
    });

    await t.test('invalid, expired, revoked, and inactive-user sessions return the same 401', async () => {
      assert.deepEqual(await refresh('unknown-token'), unauthorized);
      for (const changes of [
        { expiresAt: new Date(Date.now() - 1000) }, { revokedAt: new Date() },
      ]) {
        const initial = await login();
        await prisma.refreshSession.update({ where: { tokenHash: hash(initial.body.refreshToken) }, data: changes });
        assert.deepEqual(await refresh(initial.body.refreshToken), unauthorized);
      }
      const initial = await login();
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      const count = await prisma.refreshSession.count({ where: { userId: user.id } });
      assert.deepEqual(await refresh(initial.body.refreshToken), unauthorized);
      assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), count);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
    });

    await t.test('missing, empty, non-string, and malformed JSON input returns 400', async () => {
      for (const body of [{}, { refreshToken: null }, { refreshToken: 42 },
        { refreshToken: [] }, { refreshToken: {} }, { refreshToken: '' }, { refreshToken: ' ' }, null]) {
        assert.equal((await request('refresh', body)).status, 400);
      }
      const result = await fetch('http://localhost:32103/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
      });
      assert.equal(result.status, 400);
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    if (user) {
      await prisma.refreshSession.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  }
});
