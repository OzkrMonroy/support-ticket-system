import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('administrators create users with validated input and protected credentials', async (t) => {
  const prisma = new PrismaClient();
  const secret = 'users-test-secret-only';
  const password = 'users-test-password';
  const emails = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32104', JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const request = async (path, body, authorization) => {
    const response = await fetch(`http://localhost:32104/api/${path}`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const login = (email) => request('auth/login', { email, password });
  const data = () => {
    const email = `${randomUUID()}@example.test`;
    emails.push(email);
    return { name: ' User Test ', email, password, role: 'CLIENT' };
  };

  try {
    await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => { throw new Error('Server exited before listening'); }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Server startup timed out')), 5000).unref();
      }),
    ]);
    const admin = await prisma.user.create({ data: {
      ...data(), name: 'Users Admin', password: undefined,
      passwordHash: await bcrypt.hash(password, 4), role: 'ADMIN',
    } });
    const adminLogin = await login(admin.email);
    assert.equal(adminLogin.status, 200);
    const authorization = `Bearer ${adminLogin.body.accessToken}`;

    await t.test('both supported roles are created, hashed, normalized, and can log in', async () => {
      for (const role of ['CLIENT', 'TECHNICIAN']) {
        const input = { ...data(), role };
        const result = await request('users', { ...input, email: ` ${input.email.toUpperCase()} ` }, authorization);
        assert.equal(result.status, 201);
        const stored = await prisma.user.findUniqueOrThrow({ where: { email: input.email } });
        assert.deepEqual(result.body, {
          id: stored.id, name: 'User Test', email: input.email, role, isActive: true,
        });
        assert.notEqual(stored.passwordHash, password);
        assert.equal(bcrypt.getRounds(stored.passwordHash), 12);
        assert.ok(await bcrypt.compare(password, stored.passwordHash));
        const signedIn = await login(input.email);
        assert.equal(signedIn.status, 200);
        assert.equal((await request('users', data(), `Bearer ${signedIn.body.accessToken}`)).status, 403);
        assert.equal((await request('users', { ...input, email: ` ${input.email.toUpperCase()} ` }, authorization)).status, 409);
      }
    });

    await t.test('missing, malformed, expired, and incorrectly signed tokens return 401', async () => {
      for (const header of [undefined, 'Basic abc', 'Bearer invalid',
        `Bearer ${jwt.sign({ id: admin.id, role: 'ADMIN' }, secret, { expiresIn: -1 })}`,
        `Bearer ${jwt.sign({ id: admin.id, role: 'ADMIN' }, 'wrong-secret', { expiresIn: '15m' })}`,
        `Bearer ${jwt.sign({ id: admin.id, role: 'ADMIN' }, secret, { algorithm: 'HS384', expiresIn: '15m' })}`,
        `Bearer ${jwt.sign({ role: 'ADMIN' }, secret, { expiresIn: '15m' })}`,
      ]) {
        assert.equal((await request('users', data(), header)).status, 401);
      }
    });

    await t.test('missing fields, invalid types, unsupported roles, and oversized passwords return 400', async () => {
      const valid = data();
      const invalid = [null, {}, { ...valid, email: 'invalid' },
        { ...valid, role: 'ADMIN' }, { ...valid, role: 'client' },
        { ...valid, password: 'a'.repeat(73) }, { ...valid, password: 'é'.repeat(37) }];
      for (const field of ['name', 'email', 'password', 'role']) {
        for (const value of [undefined, null, 42, [], {}, '', ' ']) {
          invalid.push({ ...valid, [field]: value });
        }
      }
      for (const body of invalid) {
        assert.equal((await request('users', body, authorization)).status, 400);
      }
      assert.equal(await prisma.user.count({ where: { email: valid.email } }), 0);
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    // Remove only this test's fixtures and their login sessions.
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  }
});
