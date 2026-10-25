import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { PrismaClient } from '@prisma/client';
import { assignTicket } from '../src/jobs/assignment.js';
import { queueOptions, publishAssignment } from '../src/jobs/assignment-queue.js';

test('real broker prioritizes queued persistent messages and confirms publisher', async () => {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createConfirmChannel();
  const queue = `hu11-test-${randomUUID()}`;
  try {
    await channel.assertQueue(queue, queueOptions);
    for (const priority of [1, 3, 2]) channel.sendToQueue(queue, Buffer.from('test'), { persistent: true, priority });
    await channel.waitForConfirms();
    for (const priority of [3, 2, 1]) {
      const message = await channel.get(queue, { noAck: false });
      assert.equal(message.properties.priority, priority);
      channel.ack(message);
    }
    // Exercise the real publisher on the isolated queue, without consuming application messages.
    await publishAssignment({ id: randomUUID(), priority: 'HIGH' }, async () => ({
      connection: { close: async () => {} },
      channel: { sendToQueue: (_name, ...args) => channel.sendToQueue(queue, ...args) },
    }));
    const message = await channel.get(queue);
    assert.equal(message.properties.priority, 3);
    channel.ack(message);
  } finally {
    await channel.deleteQueue(queue);
    await connection.close();
  }
});

test('real Prisma assignment is idempotent and preserves status; fixtures rolled back', async () => {
  const prisma = new PrismaClient();
  const rollback = new Error('rollback fixtures');
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: 'HU11 test', email: `${randomUUID()}@example.test`, passwordHash: 'unused', role: 'TECHNICIAN' } });
      const ticket = await tx.ticket.create({ data: { title: 'HU11', description: 'Assignment test', priority: 'HIGH', createdById: user.id } });
      const candidates = await tx.user.findMany({ where: { role: 'TECHNICIAN', isActive: true }, select: { id: true, _count: { select: { assignedTickets: { where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } } } } } }, orderBy: { id: 'asc' } });
      const expected = candidates.reduce((a, b) => b._count.assignedTickets < a._count.assignedTickets ? b : a);
      assert.equal(await assignTicket(tx, ticket.id), 'assigned');
      const after = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      assert.equal(after.assignedToId, expected.id);
      assert.equal(after.status, 'OPEN');
      assert.equal(await assignTicket(tx, ticket.id), 'skipped');
      const deleted = await tx.ticket.create({ data: { title: 'Deleted', description: 'Skip', priority: 'LOW', createdById: user.id, deletedAt: new Date() } });
      assert.equal(await assignTicket(tx, deleted.id), 'skipped');
      assert.equal(await assignTicket(tx, randomUUID()), 'skipped');
      throw rollback;
    }), (error) => error === rollback);
  } finally { await prisma.$disconnect(); }
});

test('HTTP publication failure preserves ticket and reports recoverable ID', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { default: jwt } = await import('jsonwebtoken');
  const prisma = new PrismaClient();
  const user = await prisma.user.create({ data: { name: 'Publish failure', email: `${randomUUID()}@example.test`, passwordHash: 'unused', role: 'CLIENT' } });
  const server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: '32109', JWT_SECRET: 'assignment-test', RABBITMQ_URL: 'amqp://localhost:1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw Error('Server exited'); })]);
    const response = await fetch('http://localhost:32109/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: user.id, role: user.role }, 'assignment-test', { expiresIn: '15m' })}` },
      body: JSON.stringify({ title: 'Broker unavailable', description: 'Keep ticket', priority: 'HIGH' }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: body.ticketId } });
    assert.equal(stored.assignedToId, null);
    assert.equal(stored.status, 'OPEN');
    assert.equal(stored.createdById, user.id);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    const updated = await fetch(`http://localhost:32109/api/tickets/${stored.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: user.id, role: 'ADMIN' }, 'assignment-test', { expiresIn: '15m' })}` },
      body: JSON.stringify({ status: 'CLOSED' }),
    });
    assert.equal(updated.status, 503);
    assert.equal((await updated.json()).ticketId, stored.id);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: stored.id } })).status, 'CLOSED');
  } finally {
    const exited = once(server, 'exit'); server.kill(); await exited;
    await prisma.ticket.deleteMany({ where: { createdById: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
