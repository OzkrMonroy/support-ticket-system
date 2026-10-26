import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import amqp from 'amqplib';

test('ticket updates enforce workflow, visibility, and atomic validation', async (t) => {
  const prisma = new PrismaClient();
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();
  const notificationQueue = `hu12-${randomUUID()}`;
  await channel.assertQueue(notificationQueue, { durable: true, arguments: { 'x-queue-type': 'classic' } });
  const secret = 'ticket-updates-test-secret-only';
  const ids = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32107', JWT_SECRET: secret, NOTIFICATION_QUEUE: notificationQueue },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const token = (user, options = {}) => `Bearer ${jwt.sign(
    { id: user.id, role: user.role }, secret, { expiresIn: '15m', ...options },
  )}`;
  const request = async (id, body, authorization) => {
    const response = await fetch(`http://localhost:32107/api/tickets/${id}`, {
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
    const ticket = await prisma.ticket.create({ data: {
      title: 'Original', description: 'Original description', priority: 'LOW',
      createdById: users.client.id, assignedToId: users.technician.id,
    } });
    const where = { id: ticket.id };
    const stored = () => prisma.ticket.findUniqueOrThrow({ where });
    const reset = async (status) => {
      await prisma.asyncJob.deleteMany({ where: { ticketId: ticket.id } });
      return prisma.ticket.update({ where, data: {
        status, title: ticket.title, description: ticket.description, priority: ticket.priority,
      } });
    };
    const check = async (user, body, expected, id = ticket.id) => {
      const before = await stored();
      const result = await request(id, body, token(user));
      assert.equal(result.status, expected, JSON.stringify({ role: user.role, body, result }));
      const after = await stored();
      const message = await channel.get(notificationQueue, { noAck: true });
      if (expected === 200 && ['RESOLVED', 'CLOSED'].includes(body.status)) {
        assert.ok(message);
        const envelope = JSON.parse(message.content);
        const job = (await prisma.asyncJob.findUniqueOrThrow({ where: { id: envelope.jobId } })).payload;
        assert.equal(job.event, `TICKET_${body.status}`);
        assert.equal(job.ticketId, ticket.id);
        assert.equal(job.to, users.client.email);
        assert.equal(job.status, body.status);
      } else assert.equal(message, false);
      assert.equal(await channel.get(notificationQueue), false);
      if (expected !== 200) assert.deepEqual(after, before);
      else {
        for (const field of ['id', 'createdById', 'assignedToId', 'createdAt']) {
          assert.deepEqual(after[field], before[field]);
        }
        const { createdBy, assignedTo, ...scalars } = result.body;
        assert.deepEqual(scalars, JSON.parse(JSON.stringify(after)));
        for (const related of [createdBy, assignedTo]) {
          if (related) assert.deepEqual(Object.keys(related).sort(), ['email', 'id', 'name', 'role']);
        }
        assert.ok(after.updatedAt >= before.updatedAt);
      }
      return result;
    };
    const states = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const allowed = {
      client: { RESOLVED: ['CLOSED'] },
      technician: { OPEN: ['IN_PROGRESS'], IN_PROGRESS: ['RESOLVED'] },
      admin: { OPEN: ['IN_PROGRESS', 'CLOSED'], IN_PROGRESS: ['RESOLVED', 'CLOSED'], RESOLVED: ['CLOSED'] },
    };
    await t.test('all role/status combinations reject jumps, same-state updates, and reopening', async () => {
      for (const key of ['client', 'technician', 'admin']) {
        for (const from of states) {
          for (const to of states) {
            await reset(from);
            await check(users[key], { status: to }, allowed[key][from]?.includes(to) ? 200 : 403);
          }
        }
      }
    });
    await t.test('client close errors are specific without changing permissions or records', async () => {
      for (const state of ['OPEN', 'IN_PROGRESS', 'CLOSED']) {
        await reset(state);
        for (const body of [{ status: 'CLOSED' }, { title: 'Changed', status: 'CLOSED' }]) {
          assert.deepEqual(await check(users.client, body, 403), {
            status: 403, body: { message: 'Clients can only close resolved tickets.' },
          });
        }
        assert.deepEqual(await check(users.otherClient, { status: 'CLOSED' }, 404), {
          status: 404, body: { message: 'Ticket not found.' },
        });
      }
      await reset('RESOLVED');
      assert.deepEqual(await check(users.client, { title: 'Changed', status: 'CLOSED' }, 403), {
        status: 403, body: { message: 'Ticket update is not permitted.' },
      });
      assert.equal((await check(users.client, { status: 'CLOSED' }, 200)).body.status, 'CLOSED');
    });
    await t.test('content and mixed requests use the starting state and persist trimmed partial input', async () => {
      for (const key of ['client', 'technician', 'admin']) {
        for (const state of states) {
          await reset(state);
          const permitted = key === 'admin' ? state !== 'CLOSED' : key === 'client' && state === 'OPEN';
          const result = await check(users[key], { title: ' Changed ', description: ' Updated ', priority: 'HIGH' }, permitted ? 200 : 403);
          if (permitted) {
            assert.equal(result.body.title, 'Changed');
            assert.equal(result.body.description, 'Updated');
            assert.equal(result.body.priority, 'HIGH');
          }
          await reset(state);
          await check(users[key], { title: 'Changed', status: 'CLOSED' }, key === 'admin' && state !== 'CLOSED' ? 200 : 403);
        }
      }
      for (const body of [{ title: 'Title only' }, { description: 'Description only' },
        { priority: 'LOW' }, { priority: 'MEDIUM' }, { priority: 'HIGH' }]) {
        await reset('OPEN');
        const result = await check(users.client, body, 200);
        for (const [field, value] of Object.entries(body)) assert.equal(result.body[field], value);
      }
      await reset('OPEN');
      await check(users.admin, { title: 'Changed', status: 'RESOLVED' }, 403);
      await check(users.admin, { title: 'Changed', status: 'IN_PROGRESS' }, 200);
    });
    await t.test('invisible, missing, and unassigned technician tickets return 404', async () => {
      await reset('OPEN');
      for (const user of [users.otherClient, users.otherTechnician]) {
        assert.deepEqual(await check(user, { title: 'Changed' }, 404), {
          status: 404, body: { message: 'Ticket not found.' },
        });
      }
      for (const user of [users.admin, users.client, users.technician]) {
        await check(user, { status: 'CLOSED' }, 404, randomUUID());
      }
      await prisma.ticket.update({ where, data: { assignedToId: null } });
      await check(users.technician, { status: 'IN_PROGRESS' }, 404);
      assert.equal((await check(users.admin, { title: 'Unassigned' }, 200)).body.assignedTo, null);
    });
    await t.test('invalid input and immutable fields leave the entire record unchanged', async () => {
      const invalid = [{}, [], null, { title: 'a'.repeat(201) }, { description: 'a'.repeat(5001) }];
      for (const field of ['title', 'description', 'priority', 'status']) {
        for (const value of [null, 42, [], {}, '', '   ']) invalid.push({ [field]: value });
      }
      invalid.push({ priority: 'URGENT' }, { status: 'INVALID' });
      for (const field of ['id', 'createdById', 'assignedToId', 'createdAt', 'updatedAt', 'extra']) {
        invalid.push({ title: 'Changed', [field]: randomUUID() });
      }
      for (const body of invalid) await check(users.admin, body, 400);
      assert.deepEqual((await check(users.admin, { title: 'Changed' }, 400, 'invalid')).body, {
        message: 'Validation failed.', errors: { id: 'Ticket ID must be a valid UUID.' },
      });
    });
    await t.test('authentication precedes validation and uses current account state/role', async () => {
      await reset('OPEN');
      const before = await stored();
      await prisma.user.update({ where: { id: users.otherClient.id }, data: { isActive: false } });
      for (const authorization of [undefined, 'Bearer invalid', token(users.client, { expiresIn: -1 }),
        token({ id: randomUUID(), role: 'ADMIN' }), token(users.otherClient)]) {
        assert.equal((await request('invalid', {}, authorization)).status, 401);
      }
      const stale = token(users.admin);
      await prisma.user.update({ where: { id: users.admin.id }, data: { role: 'CLIENT' } });
      assert.equal((await request(ticket.id, { title: 'Changed' }, stale)).status, 404);
      await prisma.user.update({ where: { id: users.client.id }, data: { role: 'TECHNICIAN' } });
      assert.equal((await request(ticket.id, { title: 'Changed' }, token(users.client))).status, 404);
      assert.deepEqual(await stored(), before);
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
    await channel.deleteQueue(notificationQueue);
    await connection.close();
  }
});
