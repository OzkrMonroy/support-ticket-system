import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import amqp from 'amqplib';
import { queueOptions as assignmentOptions } from '../src/jobs/assignment-queue.js';

test('ticket creation persists valid input and enforces access and validation', async (t) => {
  const prisma = new PrismaClient();
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();
  const notificationQueue = `hu12-${randomUUID()}`;
  const assignmentQueue = `hu12-assignment-${randomUUID()}`;
  await channel.assertQueue(assignmentQueue, assignmentOptions);
  await channel.assertQueue(notificationQueue, { durable: true, arguments: { 'x-queue-type': 'classic' } });
  const secret = 'tickets-test-secret-only';
  const ids = [];
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32105', JWT_SECRET: secret, NOTIFICATION_QUEUE: notificationQueue, ASSIGNMENT_QUEUE: assignmentQueue },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const token = (user, options = {}) => `Bearer ${jwt.sign(
    { id: user.id, role: user.role }, secret, { expiresIn: '15m', ...options },
  )}`;
  const valid = { title: ' Email issue ', description: ' Cannot log in. ', priority: 'HIGH' };
  const request = async (body, authorization) => {
    const response = await fetch('http://localhost:32105/api/tickets', {
      method: 'POST', headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      }, body: JSON.stringify(body),
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
    for (const role of ['CLIENT', 'ADMIN', 'TECHNICIAN']) {
      const user = await prisma.user.create({ data: {
        name: 'Ticket Test', email: `${randomUUID()}@example.test`, passwordHash: 'unused', role,
      } });
      ids.push(user.id);
      users[role] = user;
    }
    const where = { createdById: { in: ids } };
    await t.test('clients and administrators create persisted tickets for every priority', async () => {
      for (const role of ['CLIENT', 'ADMIN']) {
        for (const priority of ['LOW', 'MEDIUM', 'HIGH']) {
          const result = await request({ ...valid, priority }, token(users[role]));
          assert.equal(result.status, 201);
          const notification = await channel.get(notificationQueue, { noAck: true });
          assert.ok(notification);
          const job = JSON.parse(notification.content);
          assert.equal(job.event, 'TICKET_CREATED');
          assert.equal(job.ticketId, result.body.id);
          assert.equal(job.to, users[role].email);
          assert.equal(job.description, undefined);
          assert.equal(await channel.get(notificationQueue), false);
          const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: result.body.id } });
          assert.deepEqual(result.body, JSON.parse(JSON.stringify(stored)));
          assert.deepEqual(Object.keys(result.body).sort(), [
            'id', 'title', 'description', 'priority', 'status', 'createdById', 'assignedToId', 'createdAt', 'updatedAt', 'deletedAt',
          ].sort());
          assert.equal(stored.title, 'Email issue');
          assert.equal(stored.description, 'Cannot log in.');
          assert.equal(stored.priority, priority);
          assert.equal(stored.createdById, users[role].id);
          assert.equal(stored.status, 'OPEN');
          assert.equal(stored.assignedToId, null);
          assert.equal(stored.deletedAt, null);
          assert.equal(result.body.deletedAt, null);
          assert.ok(Number.isFinite(Date.parse(result.body.createdAt)));
          assert.ok(Number.isFinite(Date.parse(result.body.updatedAt)));
        }
      }
    });
    await t.test('authentication and current role checks precede validation', async () => {
      const before = await prisma.ticket.count({ where });
      for (const header of [undefined, 'Bearer invalid', token(users.CLIENT, { expiresIn: -1 }),
        token({ id: randomUUID(), role: 'CLIENT' })]) {
        assert.equal((await request({}, header)).status, 401);
      }
      assert.equal((await request({}, token(users.TECHNICIAN))).status, 403);
      await prisma.user.update({ where: { id: users.TECHNICIAN.id }, data: { role: 'CLIENT' } });
      assert.equal((await request(valid, token(users.TECHNICIAN))).status, 201);
      await prisma.user.update({ where: { id: users.CLIENT.id }, data: { role: 'TECHNICIAN' } });
      assert.equal((await request(valid, token(users.CLIENT))).status, 403);
      await prisma.user.update({ where: { id: users.CLIENT.id }, data: { role: 'CLIENT', isActive: false } });
      assert.equal((await request(valid, token(users.CLIENT))).status, 401);
      assert.equal(await prisma.ticket.count({ where }), before + 1);
    });
    await t.test('invalid input and server-controlled fields never create tickets', async () => {
      while (await channel.get(notificationQueue, { noAck: true })) {}
      const before = await prisma.ticket.count({ where });
      assert.deepEqual(await request(null, token(users.ADMIN)), {
        status: 400, body: { message: 'Invalid JSON body.' },
      });
      const invalid = [[], {}, { ...valid, title: 'a'.repeat(201) },
        { ...valid, description: 'a'.repeat(5001) }, { ...valid, priority: 'URGENT' }];
      for (const field of ['title', 'description', 'priority']) {
        for (const value of [undefined, null, 42, [], {}, '', '   ']) {
          invalid.push({ ...valid, [field]: value });
        }
      }
      for (const field of ['id', 'createdById', 'assignedToId', 'status', 'createdAt', 'updatedAt', 'deletedAt', 'extra']) {
        invalid.push({ ...valid, [field]: field === 'status' ? 'CLOSED' : randomUUID() });
      }
      for (const body of invalid) {
        const result = await request(body, token(users.ADMIN));
        assert.equal(result.status, 400);
        assert.equal(result.body.message, 'Validation failed.');
        assert.equal(typeof result.body.errors, 'object');
      }
      assert.deepEqual((await request({ ...valid, title: ' ' }, token(users.ADMIN))).body, {
        message: 'Validation failed.', errors: { title: 'Title is required.' },
      });
      assert.equal(await prisma.ticket.count({ where }), before);
      assert.equal(await channel.get(notificationQueue), false);
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
    await channel.deleteQueue(notificationQueue);
    await channel.deleteQueue(assignmentQueue);
    await connection.close();
  }
});
