import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

test('ticket soft deletion permissions and integration', async (t) => {
  const prisma = new PrismaClient();
  const secret = 'ticket-deletion-test-secret-only';
  const ids = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32108', JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const token = (user, options = {}) => `Bearer ${jwt.sign(
    { id: user.id, role: user.role }, secret, { expiresIn: '15m', ...options },
  )}`;
  const request = async (id, body, authorization) => {
    const response = await fetch(`http://localhost:32108/api/tickets/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
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
    const users = {};
    for (const [key, role] of Object.entries({ admin: 'ADMIN', client: 'CLIENT',
      technician: 'TECHNICIAN', otherClient: 'CLIENT', otherTechnician: 'TECHNICIAN' })) {
      users[key] = await prisma.user.create({ data: {
        name: key, email: `${randomUUID()}@example.test`, passwordHash: 'unused', role,
      } });
      ids.push(users[key].id);
    }
    const create = (status = 'OPEN') => prisma.ticket.create({ data: {
      title: 'Delete test', description: 'Keep record', priority: 'LOW', status,
      createdById: users.client.id, assignedToId: users.technician.id,
    } });
    const remove = async (id, authorization) => {
      const response = await fetch(`http://localhost:32108/api/tickets/${id}`, {
        method: 'DELETE', headers: authorization ? { Authorization: authorization } : {},
      });
      const body = await response.text();
      return { status: response.status, body: body ? JSON.parse(body) : '' };
    };
    const stored = (id) => prisma.ticket.findUniqueOrThrow({ where: { id } });
    const denied = async (ticket, user, status) => {
      const before = await stored(ticket.id);
      assert.deepEqual(await remove(ticket.id, token(user)), {
        status, body: { message: status === 404 ? 'Ticket not found.' : 'Ticket deletion is not permitted.' },
      });
      assert.deepEqual(await stored(ticket.id), before);
    };
    await t.test('permissions, persisted soft deletion, and exclusion from all existing operations', async () => {
      for (const state of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
        const ticket = await create(state);
        assert.equal(ticket.deletedAt, null);
        await denied(ticket, users.otherClient, 404);
        await denied(ticket, users.otherTechnician, 404);
        await denied(ticket, users.technician, 403);
        if (state !== 'OPEN') await denied(ticket, users.client, 403);
        const started = Date.now();
        assert.deepEqual(await remove(ticket.id, token(state === 'OPEN' ? users.client : users.admin)), {
          status: 204, body: '',
        });
        const after = await stored(ticket.id);
        assert.ok(after.deletedAt.getTime() >= started && after.deletedAt.getTime() <= Date.now());
        const { deletedAt, updatedAt, ...unchanged } = after;
        const { deletedAt: oldDeletedAt, updatedAt: oldUpdatedAt, ...original } = ticket;
        assert.deepEqual(unchanged, original);
        for (const user of [users.admin, users.client, users.technician]) {
          await denied(ticket, user, 404);
          const headers = { Authorization: token(user) };
          const list = await fetch('http://localhost:32108/api/tickets', { headers });
          assert.equal(list.status, 200);
          assert.ok(!(await list.json()).some((item) => item.id === ticket.id));
          const detail = await fetch(`http://localhost:32108/api/tickets/${ticket.id}`, { headers });
          assert.equal(detail.status, 404);
          assert.deepEqual(await detail.json(), { message: 'Ticket not found.' });
          assert.deepEqual(await request(ticket.id, { title: 'Changed' }, token(user)), {
            status: 404, body: { message: 'Ticket not found.' },
          });
          assert.deepEqual(await stored(ticket.id), after);
        }
      }
      const open = await create();
      assert.equal((await remove(open.id, token(users.admin))).status, 204);
    });
    await t.test('validation and authentication use existing conventions and current database roles', async () => {
      const ticket = await create();
      assert.deepEqual(await remove('invalid', token(users.admin)), {
        status: 400, body: { message: 'Validation failed.', errors: { id: 'Ticket ID must be a valid UUID.' } },
      });
      for (const user of Object.values(users)) {
        assert.deepEqual(await remove(randomUUID(), token(user)), {
          status: 404, body: { message: 'Ticket not found.' },
        });
      }
      await prisma.user.update({ where: { id: users.otherClient.id }, data: { isActive: false } });
      for (const authorization of [undefined, 'Bearer invalid', token(users.client, { expiresIn: -1 }),
        token({ id: randomUUID(), role: 'ADMIN' }), token(users.otherClient)]) {
        assert.equal((await remove('invalid', authorization)).status, 401);
        assert.equal((await remove(ticket.id, authorization)).status, 401);
      }
      const stale = token(users.admin);
      await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'TECHNICIAN' } });
      assert.equal((await remove(ticket.id, stale)).status, 404);
      assert.deepEqual(await stored(ticket.id), ticket);
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await prisma.ticket.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
