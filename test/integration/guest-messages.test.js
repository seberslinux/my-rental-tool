const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const { pool } = require('../../src/db/database');
const { inDays } = require('../helpers/dates');

/**
 * Reading and answering guests, through Smoobu.
 *
 * Every send here goes to the mock. Nothing in this file can reach a
 * real guest.
 */

test.before(() => getApp());
test.beforeEach(async () => { await resetDb(); mockSmoobu.reset(); });
test.after(() => closePool());

const SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret';
const BOOKING = 900001;

async function setup() {
  const user = await seedUser({ role: 'property_manager' });
  const loft = await seedProperty({ owner: user, name: 'The loft', smoobu_id: 2297844 });
  await seedBooking({
    property: loft, smoobu_id: BOOKING, guest_name: 'Sam Guest',
    check_in: inDays(18), check_out: inDays(20), platform: 'Booking.com',
  });
  mockSmoobu.setMessages({
    [BOOKING]: [
      { id: 11, type: 2, subject: 'Welcome', message: 'Looking forward to having you.', messageHtml: '' },
      { id: 12, type: 1, subject: '', message: '', messageHtml: '<p>Hi! What time can we <b>check in</b>?</p>' },
    ],
  });
  mockSmoobu.setThreads([{
    booking: { id: BOOKING, guest_name: 'Sam Guest' },
    apartment: { id: 2297844, name: 'Scarborough Loft' },
    latest_message: { id: 12, subject: '', text_content: '', html_content: '<p>Hi! What time can we check in?</p>', created_at: '2026-11-10 09:14:00' },
  }]);
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, user, loft };
}

// --- reading ---------------------------------------------------------------

test('the inbox lists the conversation with its latest words', async () => {
  const { agent } = await setup();
  const { body } = await agent.get('/api/messages/threads').expect(200);
  assert.equal(body.threads.length, 1);
  assert.equal(body.threads[0].guest_name, 'Sam Guest');
  assert.equal(body.threads[0].property, 'The loft', 'named the way this app names it');
  assert.equal(body.threads[0].latest.text, 'Hi! What time can we check in?');
  assert.equal(body.threads[0].latest.at, '2026-11-10 09:14:00');
});

test('a conversation reads oldest first, who said what', async () => {
  const { agent } = await setup();
  const { body } = await agent.get(`/api/messages/${BOOKING}`).expect(200);
  assert.deepEqual(body.messages.map((m) => m.from), ['you', 'guest']);
  assert.equal(body.booking.guest_name, 'Sam Guest');
});

test("a guest's HTML is shown as text, never as markup", async () => {
  // The message had only an HTML body. It is the guest's, and it is
  // reduced to words rather than rendered.
  const { agent } = await setup();
  const { body } = await agent.get(`/api/messages/${BOOKING}`).expect(200);
  const fromGuest = body.messages.find((m) => m.from === 'guest');
  assert.equal(fromGuest.text, 'Hi! What time can we check in?');
  assert.ok(!/[<>]/.test(fromGuest.text));
});

test('a script in a message stays inert text', async () => {
  const { agent } = await setup();
  mockSmoobu.setMessages({
    [BOOKING]: [{ id: 20, type: 1, message: '', messageHtml: '<img src=x onerror="alert(1)">Hello<script>steal()</script>' }],
  });
  const { body } = await agent.get(`/api/messages/${BOOKING}`).expect(200);
  assert.ok(!/<|onerror|<script/i.test(body.messages[0].text), body.messages[0].text);
});

// --- unread ----------------------------------------------------------------

async function guestWrote(app, messageId = 12) {
  await request(app).post(`/webhook/${SECRET}`)
    .send({ action: 'newMessage', user: 971234, data: { id: messageId, sender: 'guest', booking: { id: BOOKING } } })
    .expect(200);
}

test('a guest writing makes the conversation unread and tells somebody', async () => {
  const { agent } = await setup();
  await guestWrote(await getApp());

  assert.equal((await agent.get('/api/messages/unread').expect(200)).body.unread, 1);
  const threads = (await agent.get('/api/messages/threads').expect(200)).body.threads;
  assert.equal(threads[0].unread, true);

  const { rows } = await pool.query("SELECT * FROM notifications WHERE event = 'guest_message'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /Sam Guest sent a message/);
  assert.match(rows[0].body, /What time can we check in/, 'the words, not only who');
  assert.equal(rows[0].link, `/messages/${BOOKING}`, 'tapping it opens the conversation');
});

test('opening the conversation reads it', async () => {
  const { agent } = await setup();
  await guestWrote(await getApp());
  await agent.get(`/api/messages/${BOOKING}`).expect(200);
  assert.equal((await agent.get('/api/messages/unread').expect(200)).body.unread, 0);
});

test('a reply from the channel itself also clears it', async () => {
  // Answered from the Airbnb app — the conversation is not waiting on anybody.
  const { agent } = await setup();
  const app = await getApp();
  await guestWrote(app, 12);
  await request(app).post(`/webhook/${SECRET}`)
    .send({ action: 'newMessage', data: { id: 13, sender: 'host', booking: { id: BOOKING } } })
    .expect(200);
  assert.equal((await agent.get('/api/messages/unread').expect(200)).body.unread, 0);
  const { rows } = await pool.query("SELECT * FROM notifications WHERE event = 'guest_message'");
  assert.equal(rows.length, 1, 'only the guest is announced');
});

// --- sending -----------------------------------------------------------------

test('a reply goes to Smoobu on the documented send path, and comes back in the thread', async () => {
  const { agent } = await setup();
  const { body } = await agent.post(`/api/messages/${BOOKING}`)
    .send({ text: 'Any time after 3pm. The key box code is in the guide.' }).expect(200);

  assert.equal(body.sent, true);
  assert.equal(mockSmoobu.calls.sendMessageToGuest.length, 1);
  assert.equal(mockSmoobu.calls.sendMessageToGuest[0].reservationId, BOOKING);
  assert.equal(mockSmoobu.calls.sendGuestMessage.length, 0, 'not the old path the crons use');
  assert.equal(body.messages[body.messages.length - 1].from, 'you');
  assert.match(body.messages[body.messages.length - 1].text, /after 3pm/);
});

test('an empty reply is refused and nothing is sent', async () => {
  const { agent } = await setup();
  await agent.post(`/api/messages/${BOOKING}`).send({ text: '   ' }).expect(400);
  assert.equal(mockSmoobu.calls.sendMessageToGuest.length, 0);
});

test('a reply Smoobu refuses says so, and says it was not sent', async () => {
  const { agent } = await setup();
  mockSmoobu.makeFail(new Error('422'), 'sendMessageToGuest');
  const { body } = await agent.post(`/api/messages/${BOOKING}`).send({ text: 'Hello' }).expect(502);
  assert.match(body.error, /not been sent/);
});

// --- who may -----------------------------------------------------------------

test("somebody else's guest cannot be read or written to", async () => {
  const { agent } = await setup();
  const stranger = await seedUser({ role: 'property_manager' });
  const theirs = await seedProperty({ owner: stranger, name: 'Somebody else' });
  await seedBooking({ property: theirs, smoobu_id: 999001, check_in: inDays(5), check_out: inDays(7) });

  await agent.get('/api/messages/999001').expect(403);
  await agent.post('/api/messages/999001').send({ text: 'Hello' }).expect(403);
  assert.equal(mockSmoobu.calls.sendMessageToGuest.length, 0);
});

test('threads for an apartment outside your scope are not listed', async () => {
  const { agent } = await setup();
  mockSmoobu.setThreads([{
    booking: { id: 5, guest_name: 'Not yours' }, apartment: { id: 77777, name: 'Elsewhere' },
    latest_message: { id: 1, text_content: 'hi', created_at: '2026-11-10 10:00:00' },
  }]);
  const { body } = await agent.get('/api/messages/threads').expect(200);
  assert.equal(body.threads.length, 0);
});

test('signed out, no messages', async () => {
  const app = await getApp();
  await request(app).get('/api/messages/threads').expect(401);
  await request(app).post(`/api/messages/${BOOKING}`).send({ text: 'x' }).expect(401);
});

// --- the real shape ----------------------------------------------------------

test('every reply is in the conversation, in the order it was written', async () => {
  // onlyRelatedToGuest true had left every reply out.
  // The order is the timestamp, which the API sends though its docs do not.
  const { agent } = await setup();
  mockSmoobu.setMessages({
    [BOOKING]: [
      { id: 105, type: 2, message: 'Sorry, we do not allow pets.', htmlMessage: '', createdAt: '2026-11-10 08:05:00' },
      { id: 101, type: 1, message: 'Can we bring a pet?', htmlMessage: '', createdAt: '2026-11-10 08:00:00' },
      { id: 107, type: 2, message: 'There is a small fee per night.', htmlMessage: '', createdAt: '2026-11-10 09:00:00' },
      { id: 104, type: 1, message: 'Is there an extra charge?', htmlMessage: '', createdAt: '2026-11-10 08:30:00' },
    ],
  });
  const { body } = await agent.get(`/api/messages/${BOOKING}`).expect(200);
  assert.deepEqual(body.messages.map((m) => m.from), ['guest', 'you', 'guest', 'you']);
  assert.equal(body.messages[1].at, '2026-11-10 08:05:00');
});

test('a message with no words is kept and flagged, not dropped', async () => {
  // A guest's photo: Smoobu sends it with empty text and no attachment
  // field. Dropping it made the guest look as if they had sent nothing.
  const { agent } = await setup();
  mockSmoobu.setMessages({
    [BOOKING]: [
      { id: 103, type: 1, subject: '', message: '', htmlMessage: '', createdAt: '2026-11-10 08:29:00' },
      { id: 104, type: 1, message: 'Here is a photo of it', htmlMessage: '', createdAt: '2026-11-10 08:30:00' },
    ],
  });
  const { body } = await agent.get(`/api/messages/${BOOKING}`).expect(200);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].empty, true);
  assert.equal(body.messages[1].empty, false);
});

test("Smoobu's real field name for the HTML body is read", async () => {
  // The docs' example says messageHtml; the API sends htmlMessage.
  const { agent } = await setup();
  mockSmoobu.setMessages({
    [BOOKING]: [{ id: 1, type: 1, message: '', htmlMessage: '<p>Only in HTML</p>', createdAt: '2026-11-10 08:00:00' }],
  });
  const { body } = await agent.get(`/api/messages/${BOOKING}`).expect(200);
  assert.equal(body.messages[0].text, 'Only in HTML');
});
