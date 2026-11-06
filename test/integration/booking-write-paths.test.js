const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, daysAgo, todayISO } = require('../helpers/dates');

/**
 * What a booking write actually stores.
 *
 * Four paths wrote bookings and each carried its own column list. The
 * webhook's insert left out `length_of_stay` and `price_per_night`, so
 * a ten-night stay was recorded as one night; its modify branch left
 * them out too, so a stay whose dates moved kept the old count; and
 * neither sync wrote `raw_payload` at all, while reset-and-resync opens
 * with DELETE FROM bookings — so a resync erased every verbatim payload
 * the webhook had stored.
 *
 * These pin the row, not the SQL. A fifth path written tomorrow that
 * forgets a column fails here.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret';

/** Smoobu's newReservation shape, in the kebab-case dialect. */
function reservation({ id = 7001, apartmentId, arrival, departure, price = 28221.12 }) {
  return {
    action: 'newReservation',
    data: {
      id,
      type: 'reservation',
      arrival,
      departure,
      'created-at': daysAgo(30),
      'modified-at': daysAgo(2),
      'guest-name': 'Dana Petersen',
      price,
      adults: 2,
      children: 1,
      language: 'en',
      phone: '+27 82 123 4567',
      'commission-included': 601.64,
      channel: { name: 'Booking.com' },
      apartment: { id: apartmentId },
    },
  };
}

const bookingRow = (smoobuId) =>
  pool.query('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]).then((r) => r.rows[0]);

async function setup() {
  const user = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: user, name: 'Hill Top Lodge' });
  return { app: await getApp(), property };
}

// --- the nights ----------------------------------------------------------

test('a ten-night booking by webhook is stored as ten nights', async () => {
  // It was stored as one. The column default is 1 and the insert never
  // named the column, so every pushed booking was a one-night stay.
  const { app, property } = await setup();
  const arrival = inDays(34), departure = inDays(44);

  await request(app).post(`/webhook/${SECRET}`)
    .send(reservation({ apartmentId: property.smoobu_id, arrival, departure }))
    .expect(200);

  const row = await bookingRow(7001);
  assert.equal(row.length_of_stay, 10);
  assert.equal(Number(row.price_per_night), 2822.11);
});

test('a booking whose dates move has its nights recomputed', async () => {
  // The modify branch updated ten columns and length_of_stay was not
  // among them, so a shortened stay kept the longer count.
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(reservation({ apartmentId: property.smoobu_id, arrival: inDays(34), departure: inDays(44) }))
    .expect(200);

  const shortened = reservation({
    apartmentId: property.smoobu_id, arrival: inDays(34), departure: inDays(38), price: 11288.44,
  });
  shortened.action = 'modifyReservation';
  await request(app).post(`/webhook/${SECRET}`).send(shortened).expect(200);

  const row = await bookingRow(7001);
  assert.equal(row.length_of_stay, 4);
  assert.equal(Number(row.price_per_night), 2822.11);
});

// --- everything Smoobu sent ---------------------------------------------

test('the whole payload is kept, not only the mapped fields', async () => {
  // Smoobu serves a limited window, so a field not captured when the
  // booking arrives cannot be fetched later. raw_payload is the only
  // reason an unmapped field is recoverable at all.
  const { app, property } = await setup();
  const event = reservation({ apartmentId: property.smoobu_id, arrival: inDays(10), departure: inDays(13) });
  event.data['assistant-notice'] = 'a field nothing maps';

  await request(app).post(`/webhook/${SECRET}`).send(event).expect(200);

  const row = await bookingRow(7001);
  const raw = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
  assert.equal(raw['assistant-notice'], 'a field nothing maps',
    'an unmapped field survived');
  assert.equal(raw['commission-included'], 601.64);
});

test('every mapped column is filled, none left at its default', async () => {
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(reservation({ apartmentId: property.smoobu_id, arrival: inDays(34), departure: inDays(44) }))
    .expect(200);

  const row = await bookingRow(7001);
  assert.equal(row.guest_name, 'Dana Petersen');
  assert.equal(row.platform, 'Booking.com');
  assert.equal(Number(row.commission), 601.64);
  assert.equal(row.children, 1);
  assert.equal(row.language, 'en');
  assert.equal(row.guest_country, 'South Africa');
  assert.equal(row.currency, 'ZAR');
  assert.equal(row.lead_time_days, 64, '34 days out, booked 30 days ago');
  assert.ok(row.created_at.startsWith(daysAgo(30)), `created_at was ${row.created_at}`);
  assert.ok(row.modified_at.startsWith(daysAgo(2)), `modified_at was ${row.modified_at}`);
  assert.ok(row.raw_payload, 'raw_payload is not null');
});

// --- what a repeat must not undo ----------------------------------------

test('a modification that omits the guest name does not blank it', async () => {
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(reservation({ apartmentId: property.smoobu_id, arrival: inDays(10), departure: inDays(13) }))
    .expect(200);

  const nameless = reservation({ apartmentId: property.smoobu_id, arrival: inDays(10), departure: inDays(13) });
  nameless.action = 'modifyReservation';
  delete nameless.data['guest-name'];
  await request(app).post(`/webhook/${SECRET}`).send(nameless).expect(200);

  assert.equal((await bookingRow(7001)).guest_name, 'Dana Petersen');
});

test('when the booking was made survives an amendment that omits it', async () => {
  // created_at never changes, and the lead time is measured from it, so
  // an amendment payload without it must not reset either to empty.
  const { app, property } = await setup();
  await request(app).post(`/webhook/${SECRET}`)
    .send(reservation({ apartmentId: property.smoobu_id, arrival: inDays(34), departure: inDays(44) }))
    .expect(200);
  const before = await bookingRow(7001);

  const amended = reservation({ apartmentId: property.smoobu_id, arrival: inDays(34), departure: inDays(40) });
  amended.action = 'modifyReservation';
  delete amended.data['created-at'];
  await request(app).post(`/webhook/${SECRET}`).send(amended).expect(200);

  const after = await bookingRow(7001);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.lead_time_days, before.lead_time_days);
  assert.equal(after.length_of_stay, 6, 'the dates still moved');
});

// --- the backfill --------------------------------------------------------

test('migrations put the nights back on rows already stored wrong', async () => {
  // The rows production already holds: a ten-night stay recorded as one.
  const { property } = await setup();
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out,
       platform, total_price, status, length_of_stay, price_per_night)
     VALUES ($1, $2, 'Old row', $3, $4, 'Booking.com', 28221.12, 'confirmed', 1, 0)`,
    [7777, property.id, todayISO(), inDays(10)]
  );

  await require('../../src/db/migrations').runMigrations();

  const row = await bookingRow(7777);
  assert.equal(row.length_of_stay, 10);
  assert.equal(Number(row.price_per_night), 2822.11);
});
