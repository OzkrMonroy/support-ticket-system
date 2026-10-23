import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('administrators create, list, and deactivate users with protected access', async (t) => {
  const prisma = new PrismaClient();
  const secret = 'users-test-secret-only';
  const password = 'users-test-password';
  const emails = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32104', JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const request = async (path, body, authorization, method = 'POST') => {
    const response = await fetch(`http://localhost:32104/api/${path}`, {
      method, headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      }, body: method === 'GET' ? undefined : JSON.stringify(body),
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

    await t.test('all roles can view only their own current profile fields', async () => {
      for (const role of ['ADMIN', 'CLIENT', 'TECHNICIAN']) {
        const input = data();
        const user = await prisma.user.create({ data: {
          name: input.name, email: input.email, passwordHash: await bcrypt.hash(password, 4), role,
        } });
        const signedIn = await login(user.email);
        assert.equal(signedIn.status, 200);
        const header = `Bearer ${signedIn.body.accessToken}`;
        assert.deepEqual(await request('users/me', undefined, header, 'GET'), {
          status: 200, body: { id: user.id, name: user.name, email: user.email, role },
        });
        const current = await prisma.user.update({
          where: { id: user.id },
          data: { name: 'Updated Profile', role: role === 'CLIENT' ? 'TECHNICIAN' : role },
        });
        const result = await request(`users/me?id=${admin.id}`, undefined, header, 'GET');
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, {
          id: current.id, name: current.name, email: current.email, role: current.role,
        });
      }
    });

    await t.test('profile rejects missing, invalid, expired, and deleted-user tokens', async () => {
      for (const header of [undefined, 'Bearer invalid',
        `Bearer ${jwt.sign({ id: admin.id, role: 'ADMIN' }, secret, { expiresIn: -1 })}`,
        `Bearer ${jwt.sign({ id: admin.id, role: 'ADMIN' }, 'wrong-secret', { expiresIn: '15m' })}`,
        `Bearer ${jwt.sign({ id: randomUUID(), role: 'CLIENT' }, secret, { expiresIn: '15m' })}`,
      ]) {
        assert.deepEqual(await request('users/me', undefined, header, 'GET'), {
          status: 401, body: { message: 'Invalid access token.' },
        });
      }
    });

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

    await t.test('administrators list safe fields in a predictable order', async () => {
      const result = await request('users', undefined, authorization, 'GET');
      assert.equal(result.status, 200);
      const expected = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, isActive: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      assert.deepEqual(result.body, expected);
    });

    await t.test('listing and deactivation require valid administrator access', async () => {
      const headers = [undefined, 'Bearer invalid',
        `Bearer ${jwt.sign({ id: admin.id, role: 'ADMIN' }, secret, { expiresIn: -1 })}`,
        `Bearer ${jwt.sign({ id: randomUUID(), role: 'ADMIN' }, secret, { expiresIn: '15m' })}`,
        `Bearer ${jwt.sign({ id: 'invalid', role: 'ADMIN' }, secret, { expiresIn: '15m' })}`];
      for (const header of headers) {
        assert.equal((await request('users', undefined, header, 'GET')).status, 401);
        assert.equal((await request(`users/${admin.id}/deactivate`, {}, header, 'PATCH')).status, 401);
      }
      for (const role of ['CLIENT', 'TECHNICIAN']) {
        const input = data();
        const user = await prisma.user.create({ data: {
          name: input.name, email: input.email, passwordHash: await bcrypt.hash(password, 4), role,
        } });
        const signedIn = await login(user.email);
        const header = `Bearer ${signedIn.body.accessToken}`;
        assert.equal((await request('users', undefined, header, 'GET')).status, 403);
        assert.equal((await request(`users/${admin.id}/deactivate`, {}, header, 'PATCH')).status, 403);
      }
    });

    await t.test('deactivation preserves records and immediately blocks login, refresh, and protected routes', async () => {
      const input = data();
      const target = await prisma.user.create({ data: {
        name: input.name, email: input.email, passwordHash: await bcrypt.hash(password, 4), role: 'ADMIN',
      } });
      const signedIn = await login(target.email);
      const header = `Bearer ${signedIn.body.accessToken}`;
      assert.equal((await request('users', undefined, header, 'GET')).status, 200);
      assert.equal((await request('users/me', undefined, header, 'GET')).status, 200);
      const result = await request(`users/${target.id}/deactivate`, {}, authorization, 'PATCH');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, {
        id: target.id, name: target.name, email: target.email, role: 'ADMIN', isActive: false,
      });
      assert.deepEqual(await request(`users/${target.id}/deactivate`, {}, authorization, 'PATCH'), result);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(stored.isActive, false);
      assert.equal(stored.passwordHash, target.passwordHash);
      assert.equal((await login(target.email)).status, 401);
      assert.equal((await request('auth/refresh', { refreshToken: signedIn.body.refreshToken })).status, 401);
      assert.equal((await request('users', undefined, header, 'GET')).status, 401);
      assert.equal((await request('users/me', undefined, header, 'GET')).status, 401);
      assert.equal((await request('users', data(), header)).status, 401);
      assert.equal((await request(`users/${admin.id}/deactivate`, {}, header, 'PATCH')).status, 401);
      const listed = await request('users', undefined, authorization, 'GET');
      assert.deepEqual(listed.body.find((user) => user.id === target.id), result.body);
    });

    await t.test('self-deactivation is forbidden and unknown or malformed IDs return 404', async () => {
      for (const id of [admin.id, admin.id.toUpperCase()]) {
        assert.equal((await request(`users/${id}/deactivate`, {}, authorization, 'PATCH')).status, 403);
      }
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive, true);
      for (const id of [randomUUID(), 'invalid-id']) {
        assert.equal((await request(`users/${id}/deactivate`, {}, authorization, 'PATCH')).status, 404);
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
