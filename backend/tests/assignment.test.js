import test from 'node:test';
import assert from 'node:assert/strict';
import { assignTicket, handleAssignment } from '../src/jobs/assignment.js';
import { publishAssignment, priorities, queueOptions } from '../src/jobs/assignment-queue.js';

const id = '00000000-0000-4000-8000-000000000001';
function fixture({ ticket = { deletedAt: null, assignedToId: null, status: 'OPEN' }, technicians = [], count = 1 } = {}) {
  const calls = {};
  return { calls, ticket: {
    findUnique: async (query) => { calls.read = query; return ticket; },
    updateMany: async (query) => { calls.write = query; return { count }; },
  }, user: { findMany: async (query) => { calls.users = query; return technicians; } } };
}
const tech = (id, count) => ({ id, _count: { assignedTickets: count } });
test('assignment selects smallest workload, stable ties, and conditional OPEN write', async () => {
  const db = fixture({ technicians: [tech('a', 3), tech('b', 1), tech('c', 1)] });
  assert.equal(await assignTicket(db, id), 'assigned');
  assert.deepEqual(db.calls.users.where, { role: 'TECHNICIAN', isActive: true });
  assert.deepEqual(db.calls.users.orderBy, { id: 'asc' });
  assert.deepEqual(db.calls.users.select._count.select.assignedTickets.where,
    { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } });
  assert.deepEqual(db.calls.write, { where: { id, deletedAt: null, assignedToId: null, status: 'OPEN' }, data: { assignedToId: 'b' } });
});
test('missing/deleted/assigned/non-OPEN tickets and lost conditional writes are no-ops', async () => {
  const missing = fixture({ ticket: null });
  assert.equal(await assignTicket(missing, id), 'skipped');
  assert.deepEqual(missing.calls.read.where, { id });
  assert.equal(missing.calls.users, undefined);
  assert.equal(await assignTicket(fixture({ technicians: [tech('a', 0)], count: 0 }), id), 'skipped');
  assert.equal(await assignTicket(fixture(), id), 'no-technicians');
});
test('manual ack for business outcomes, bounded rejection for database and malformed messages', async () => {
  const message = { content: Buffer.from(JSON.stringify({ ticketId: id })) };
  const calls = [];
  const channel = { ack: (...args) => calls.push(['ack', ...args]), nack: (...args) => calls.push(['nack', ...args]) };
  const log = { info() {}, error() {} };
  await handleAssignment(channel, message, fixture(), log);
  assert.deepEqual(calls.pop(), ['ack', message]);
  const db = fixture(); db.ticket.findUnique = async () => { throw Error('database'); };
  await handleAssignment(channel, message, db, log);
  assert.deepEqual(calls.pop(), ['nack', message, false, false]);
  const invalid = { content: Buffer.from('invalid') };
  await handleAssignment(channel, invalid, db, log);
  assert.deepEqual(calls.pop(), ['nack', invalid, false, false]);
});
test('publisher sends only ID, persistent priority, waits for confirmation and propagates failures', async () => {
  assert.deepEqual(priorities, { LOW: 1, MEDIUM: 2, HIGH: 3 });
  assert.equal(queueOptions.durable, true);
  let closed = 0;
  for (const fail of [false, true]) {
    const open = async () => ({ connection: { close: async () => { closed++; } }, channel: {
      sendToQueue(queue, body, options, callback) {
        assert.equal(queue, 'ticket-assignment');
        assert.deepEqual(JSON.parse(body), { ticketId: id });
        assert.equal(options.persistent, true); assert.equal(options.priority, 3);
        callback(fail ? Error('broker nack') : null);
      },
    } });
    if (fail) await assert.rejects(publishAssignment({ id, priority: 'HIGH' }, open));
    else await publishAssignment({ id, priority: 'HIGH' }, open);
  }
  assert.equal(closed, 2);
  await assert.rejects(publishAssignment({ id }, async () => { throw Error('connection'); }));
});

test('each skip logs a concise reason and is acknowledged without assigning', async () => {
  const eligible = { deletedAt: null, assignedToId: null, status: 'OPEN' };
  for (const [reason, ticket, count] of [
    ['not-found', null, 1],
    ['soft-deleted', { ...eligible, deletedAt: new Date(), assignedToId: 'a' }, 1],
    ['already-assigned', { ...eligible, assignedToId: 'a' }, 1],
    ['not-open', { ...eligible, status: 'CLOSED' }, 1],
    ['eligibility-changed', eligible, 0],
  ]) {
    const db = fixture({ ticket, technicians: [tech('a', 0)], count });
    const message = { content: Buffer.from(JSON.stringify({ ticketId: id })) };
    const logs = [];
    const acknowledgements = [];
    await handleAssignment({ ack: (value) => acknowledgements.push(value),
      nack: () => assert.fail('Expected acknowledgement') }, message, db,
    { info: (value) => logs.push(value), error: () => assert.fail('Unexpected failure') });
    assert.deepEqual(logs, [`Ticket assignment ${id}: skipped (${reason})`]);
    assert.deepEqual(acknowledgements, [message]);
    if (reason !== 'eligibility-changed') {
      assert.equal(db.calls.users, undefined);
      assert.equal(db.calls.write, undefined);
    }
  }
});
