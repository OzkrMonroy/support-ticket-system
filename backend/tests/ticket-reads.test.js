import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

test('ticket reads enforce current visibility and safe responses', async (t) => {
  const prisma = new PrismaClient();
  const secret = 'ticket-reads-test-secret-only';
  const ids = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32106', JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const token = (user, options = {}) => `Bearer ${jwt.sign(
    { id: user.id, role: user.role }, secret, { expiresIn: '15m', ...options },
  )}`;
  const request = async (path, authorization) => {
    const response = await fetch(`http://localhost:32106/api/tickets${path}`, {
      headers: authorization ? { Authorization: authorization } : {},
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
    for (const [key, role] of Object.entries({
      admin: 'ADMIN', client: 'CLIENT', otherClient: 'CLIENT',
      technician: 'TECHNICIAN', otherTechnician: 'TECHNICIAN', emptyClient: 'CLIENT',
    })) {
      users[key] = await prisma.user.create({ data: {
        name: key, email: `${randomUUID()}@example.test`, passwordHash: 'unused', role,
      } });
      ids.push(users[key].id);
    }
    const tickets = [];
    for (const [creator, assignee, createdAt] of [
      ['client', 'technician', '2026-01-01'],
      ['otherClient', 'otherTechnician', '2026-01-02'],
      ['client', null, '2026-01-02'],
      ['admin', 'technician', '2026-01-03'],
    ]) {
      tickets.push(await prisma.ticket.create({ data: {
        title: 'Read test', description: 'Read fixture', priority: 'MEDIUM',
        createdById: users[creator].id, assignedToId: assignee ? users[assignee].id : null,
        createdAt: new Date(createdAt),
      } }));
    }
    const expectedIds = (items) => [...items].sort((a, b) =>
      b.createdAt - a.createdAt || b.id.localeCompare(a.id)).map(({ id }) => id);
    await t.test('role lists and details share safe representations and deterministic ordering', async () => {
      for (const [key, visible] of [
        ['admin', tickets], ['client', [tickets[0], tickets[2]]],
        ['otherClient', [tickets[1]]], ['technician', [tickets[0], tickets[3]]],
        ['otherTechnician', [tickets[1]]], ['emptyClient', []],
      ]) {
        const result = await request('', token(users[key]));
        assert.equal(result.status, 200);
        // ADMIN may also see pre-existing tickets; never remove or assume an empty database.
        const fixtures = result.body.filter(({ createdById }) => ids.includes(createdById));
        assert.deepEqual(fixtures.map(({ id }) => id), expectedIds(visible));
        if (key !== 'admin') assert.equal(result.body.length, visible.length);
        const sorted = [...result.body].sort((a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
        assert.deepEqual(result.body, sorted);
        for (const ticket of fixtures) {
          assert.deepEqual(Object.keys(ticket).sort(), [
            'id', 'title', 'description', 'priority', 'status', 'createdById',
            'assignedToId', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'assignedTo',
          ].sort());
          for (const related of [ticket.createdBy, ticket.assignedTo]) {
            if (related === null) continue;
            const user = Object.values(users).find(({ id }) => id === related.id);
            assert.deepEqual(related, { id: user.id, name: user.name, email: user.email, role: user.role });
          }
          if (ticket.assignedToId === null) assert.equal(ticket.assignedTo, null);
          assert.deepEqual(await request(`/${ticket.id}`, token(users[key])), { status: 200, body: ticket });
        }
        for (const ticket of tickets.filter(({ id }) => !visible.some((item) => item.id === id))) {
          assert.deepEqual(await request(`/${ticket.id}`, token(users[key])), {
            status: 404, body: { message: 'Ticket not found.' },
          });
        }
      }
      assert.deepEqual(await request('', token(users.emptyClient)), { status: 200, body: [] });
      await prisma.ticket.updateMany({
        where: { assignedToId: users.otherTechnician.id }, data: { assignedToId: null },
      });
      assert.deepEqual(await request('', token(users.otherTechnician)), { status: 200, body: [] });
    });
    await t.test('missing IDs and malformed UUIDs follow existing error conventions', async () => {
      for (const user of Object.values(users)) {
        assert.deepEqual(await request(`/${randomUUID()}`, token(user)), {
          status: 404, body: { message: 'Ticket not found.' },
        });
        assert.deepEqual(await request('/invalid', token(user)), {
          status: 400, body: { message: 'Validation failed.', errors: { id: 'Ticket ID must be a valid UUID.' } },
        });
      }
    });
    await t.test('authentication precedes validation and uses current account state', async () => {
      const staleToken = token(users.admin);
      await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'CLIENT' } });
      assert.deepEqual((await request('', staleToken)).body.map(({ id }) => id), [tickets[3].id]);
      assert.equal((await request(`/${tickets[0].id}`, staleToken)).status, 404);
      await prisma.user.update({ where: { id: users.client.id }, data: { isActive: false } });
      for (const path of ['', `/${tickets[0].id}`, '/invalid']) {
        for (const header of [undefined, 'Bearer invalid', token(users.admin, { expiresIn: -1 }),
          token({ id: randomUUID(), role: 'CLIENT' }), token(users.client)]) {
          assert.equal((await request(path, header)).status, 401);
        }
      }
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    // Remove only fixtures owned by this test.
    await prisma.ticket.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
