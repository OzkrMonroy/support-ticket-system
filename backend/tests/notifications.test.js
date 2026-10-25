import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationEvents, queueTicketNotification, renderNotification, handleNotification } from '../src/jobs/notifications.js';
import { publishNotification, notificationQueue, queueOptions } from '../src/jobs/notification-queue.js';
import { createMailTransport } from '../src/jobs/smtp.js';
import { handleAssignment } from '../src/jobs/assignment.js';

const id = '00000000-0000-4000-8000-000000000001';
const ticket = { id, title: '<script>&"\' Título', priority: 'HIGH', status: 'OPEN', createdById: 'creator', assignedToId: 'tech' };
const log = { info() {}, error() {} };
const job = { event: 'TICKET_CREATED', ticketId: id, title: ticket.title, priority: 'HIGH', status: 'OPEN', to: 'recipient@example.test' };

test('all events select creator or assigned technician and publish minimal snapshots', async () => {
  for (const event of notificationEvents) {
    let published;
    const db = { user: { findUnique: async ({ where, select }) => {
      assert.equal(where.id, event === 'TICKET_ASSIGNED' ? 'tech' : 'creator');
      assert.deepEqual(select, { email: true });
      return { email: 'recipient@example.test' };
    } } };
    assert.equal(await queueTicketNotification(db, event, ticket, async (value) => { published = value; }, log), true);
    assert.deepEqual(published, { ...job, event });
    assert.equal(await queueTicketNotification(db, event, ticket, async () => { throw Error('broker secret'); }, log), false);
  }
});

test('four Spanish HTML/text variants escape HTML and omit descriptions', () => {
  const subjects = new Set();
  for (const event of notificationEvents) {
    const status = { TICKET_RESOLVED: 'RESOLVED', TICKET_CLOSED: 'CLOSED' }[event] || 'OPEN';
    const rendered = renderNotification({ ...job, event, status, description: 'PRIVATE' });
    subjects.add(rendered.subject);
    assert.match(rendered.text, /Título:/);
    assert.match(rendered.text, /Prioridad: Alta/);
    assert.ok(rendered.text.includes(`Estado: ${{ OPEN: 'Abierto', RESOLVED: 'Resuelto', CLOSED: 'Cerrado' }[status]}`));
    assert.ok(rendered.text.includes(id));
    assert.ok(rendered.text.includes(ticket.title));
    assert.ok(rendered.html.includes('&lt;script&gt;&amp;&quot;&#39;'));
    assert.ok(!rendered.html.includes('<script>'));
    assert.ok(!JSON.stringify(rendered).includes('PRIVATE'));
  }
  assert.equal(subjects.size, 4);
  assert.throws(() => renderNotification({ ...job, event: 'INVALID' }));
});

test('SMTP configuration enables TLS for 465, STARTTLS for 587, and bounded timeouts', () => {
  const env = { SMTP_USER: 'example', SMTP_APP_PASSWORD: 'test-only', EMAIL_FROM: 'sender@example.test' };
  for (const port of [465, 587]) {
    const options = createMailTransport({ ...env, SMTP_PORT: String(port) }, (value) => value);
    assert.equal(options.host, 'smtp.gmail.com');
    assert.equal(options.secure, port === 465);
    assert.equal(options.requireTLS, true);
    assert.equal(options.socketTimeout, 30000);
    assert.equal(options.disableFileAccess, true);
  }
  assert.throws(() => createMailTransport({}));
});

test('worker acknowledges accepted mail; malformed, transient, terminal and refused sends reject without requeue', async () => {
  for (const scenario of ['success', 'transient', 'terminal', 'refused', 'invalid', 'invalid-fields']) {
    const message = { content: Buffer.from(scenario === 'invalid' ? 'invalid' : JSON.stringify(scenario === 'invalid-fields' ? { ...job, priority: '__proto__' } : job)) };
    const calls = [], logs = [];
    const channel = { ack: (...args) => calls.push(['ack', ...args]), nack: (...args) => calls.push(['nack', ...args]) };
    let sendCalls = 0;
    const transport = { sendMail: async (mail) => {
      sendCalls++;
      assert.equal(mail.to.address, job.to);
      assert.equal(mail.from, 'sender@example.test');
      assert.ok(mail.text && mail.html);
      if (['transient', 'terminal'].includes(scenario)) throw Object.assign(Error('SECRET ADDRESS'), {
        code: scenario === 'transient' ? 'ETIMEDOUT' : 'EAUTH', responseCode: scenario === 'transient' ? 421 : 535,
      });
      return { accepted: scenario === 'refused' ? [] : [job.to] };
    } };
    await handleNotification(channel, message, transport, 'sender@example.test', {
      info: (value) => logs.push(value), error: (value) => logs.push(value),
    });
    assert.equal(sendCalls, ['invalid', 'invalid-fields'].includes(scenario) ? 0 : 1);
    assert.deepEqual(calls, [scenario === 'success' ? ['ack', message] : ['nack', message, false, false]]);
    assert.ok(!logs.join().includes('SECRET'));
    assert.ok(!logs.join().includes(job.to));
  }
  await assert.rejects(handleNotification({}, null, {}, '', log));
});

test('notification publisher confirms persistent messages in a dedicated durable queue', async () => {
  assert.equal(queueOptions.durable, true);
  for (const fail of [false, true]) {
    let closed = false;
    const publish = publishNotification(job, async (confirm) => {
      assert.equal(confirm, true);
      return { connection: { close: async () => { closed = true; } }, channel: {
        sendToQueue(queue, content, options, callback) {
          assert.equal(queue, notificationQueue);
          assert.deepEqual(JSON.parse(content), job);
          assert.equal(options.persistent, true);
          callback(fail ? Error('broker') : null);
        },
      } };
    });
    if (fail) await assert.rejects(publish);
    else await publish;
    assert.equal(closed, true);
  }
});

test('assignment notifies only the successful conditional write; publication failure preserves acknowledgement', async () => {
  for (const outcome of ['assigned', 'duplicate', 'lost-race', 'publish-failed']) {
    let notified = 0, acknowledged = 0;
    const db = { ticket: {
      findUnique: async () => ({ ...ticket, deletedAt: null, assignedToId: outcome === 'duplicate' ? 'tech' : null }),
      updateMany: async () => ({ count: outcome === 'lost-race' ? 0 : 1 }),
    }, user: { findMany: async () => [{ id: 'tech', _count: { assignedTickets: 0 } }] } };
    await handleAssignment({ ack: () => { acknowledged++; }, nack: () => assert.fail('Unexpected rejection') },
      { content: Buffer.from(JSON.stringify({ ticketId: id })) }, db, log, async (_, event, snapshot) => {
        notified++;
        assert.equal(event, 'TICKET_ASSIGNED');
        assert.equal(snapshot.assignedToId, 'tech');
        return outcome !== 'publish-failed';
      });
    assert.equal(notified, ['assigned', 'publish-failed'].includes(outcome) ? 1 : 0);
    assert.equal(acknowledged, 1);
  }
});
