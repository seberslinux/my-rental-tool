const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, daysAgo } = require('../helpers/dates');

/**
 * Where a booking notification takes you.
 *
 * The point of a notification over a message is that it lands you where
 * you can act on it. "New booking — Hill Top Lodge" linked to `/`, so
 * it opened the app at Home and left you to go and find the thing it
 * had just told you about.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret';

function event(action, { id = 8101, apartmentId, arrival, departure }) {
  return {
    action,
    data: {
      id, type: 'reservation', arrival, departure,
      'created-at': daysAgo(5), 'guest-name': 'Dana Petersen', price: 9000,
      adults: 2, channel: { name: 'Booking.com' }, apartment: { id: apartmentId },
    },
  };
}

const noticeFor = (ev) => pool.query(
  'SELECT * FROM notifications WHERE event = $1 ORDER BY id DESC LIMIT 1', [ev]
).then((r) => r.rows[0]);

async function setup() {
  const user = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: user, name: 'Hill Top Lodge' });
  return { app: await getApp(), property };
}

test('a new booking links to that booking', async () => {
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('newReservation', { apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24) }))
    .expect(200);

  assert.equal((await noticeFor('booking_created')).link, '/booking/8101');
});

test('the link carries Smoobu\'s id, not the local row id', async () => {
  // cleaning_jobs and inventory_checklists both key on the Smoobu id
  // for the same reason: the sync deletes and re-inserts bookings, so a
  // local id does not survive one.
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('newReservation', { id: 8102, apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24) }))
    .expect(200);

  const row = await pool.query('SELECT id, smoobu_id FROM bookings WHERE smoobu_id = 8102');
  assert.notEqual(row.rows[0].id, 8102, 'the two ids differ, so this test means something');
  assert.equal((await noticeFor('booking_created')).link, '/booking/8102');
});

test('a changed booking links to it too', async () => {
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('newReservation', { apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24) }))
    .expect(200);
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('modifyReservation', { apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(26) }))
    .expect(200);

  assert.equal((await noticeFor('booking_changed')).link, '/booking/8101');
});

test('a cancelled booking links Home, because the sheet cannot be drawn', async () => {
  // The calendar filters cancelled stays out, so a link to one would
  // open the app on a sheet with nothing behind it.
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('newReservation', { apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24) }))
    .expect(200);
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('cancelReservation', { apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24) }))
    .expect(200);

  assert.equal((await noticeFor('booking_cancelled')).link, '/');
});

test('the push payload carries the link the notification was given', async () => {
  // The service worker reads data.link and navigates to it. A link that
  // stops at the notifications table never reaches a phone.
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(event('newReservation', { apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24) }))
    .expect(200);

  const notice = await noticeFor('booking_created');
  assert.equal(notice.link, '/booking/8101');
  assert.match(notice.title, /New booking/);
});
