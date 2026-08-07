const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, resetDb, closePool, WEBHOOK_SECRET } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

// Smoobu doesn't sign webhook payloads — the only control we have is a
// long random secret embedded in the URL path. These tests exercise that
// gate + the state machine behind /webhook/:secret.
//
// The webhook handler upserts on smoobu_id, so replays must be idempotent
// and modifications must update in place. Cancellations flip the status
// column rather than deleting the row.

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const goodUrl = () => `/webhook/${WEBHOOK_SECRET}`;

// A Smoobu-shaped "newReservation" event payload for `apartment`.
function newReservationEvent(apartment, overrides = {}) {
  return {
    action: 'newReservation',
    data: {
      id: overrides.id ?? 999001,
      apartment: { id: apartment.smoobu_id },
      'guest-name': overrides['guest-name'] ?? 'Alice Doe',
      arrival: overrides.arrival ?? '2025-06-10',
      departure: overrides.departure ?? '2025-06-13',
      channel: { name: overrides.channel ?? 'Airbnb' },
      price: overrides.price ?? 3000,
      adults: overrides.adults ?? 2,
      ...overrides,
    },
  };
}

// --- secret gate ----------------------------------------------------------

test('wrong secret → 401, no DB write', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  await request(app)
    .post('/webhook/definitely-not-the-secret')
    .send(newReservationEvent(property))
    .expect(401);

  const rows = await pool.query('SELECT count(*)::int FROM bookings');
  assert.equal(rows.rows[0].count, 0);
});

test('empty secret path → 404 (no route match)', async () => {
  const app = await getApp();
  // /webhook/ (empty :secret param) doesn't match the /:secret pattern.
  await request(app).post('/webhook/').expect(404);
});

// --- newReservation -------------------------------------------------------

test('newReservation for a known property inserts a booking', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const res = await request(app)
    .post(goodUrl())
    .send(newReservationEvent(property, { id: 12345, 'guest-name': 'Alice' }))
    .expect(200);

  const row = await pool.query(
    'SELECT * FROM bookings WHERE smoobu_id = $1',
    [12345]
  );
  assert.equal(row.rowCount, 1, `expected 1 row; response body: ${JSON.stringify(res.body)}`);
  assert.equal(row.rows[0].property_id, property.id);
  assert.equal(row.rows[0].guest_name, 'Alice');
  assert.equal(row.rows[0].status, 'confirmed');
});

test('newReservation for an unknown apartment → 200, no write', async () => {
  // The handler returns 200 with `action: "unknown property"` so Smoobu
  // doesn't retry. This test pins that behaviour and ensures no phantom row.
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  await seedProperty({ owner, smoobu_id: 111 });

  const res = await request(app)
    .post(goodUrl())
    .send(newReservationEvent({ smoobu_id: 999 })) // no matching property
    .expect(200);

  assert.equal(res.body.action, 'unknown property');
  const count = await pool.query('SELECT count(*)::int FROM bookings');
  assert.equal(count.rows[0].count, 0);
});

test('newReservation is idempotent — replaying the same payload produces one row', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const payload = newReservationEvent(property, { id: 55555 });

  await request(app).post(goodUrl()).send(payload).expect(200);
  await request(app).post(goodUrl()).send(payload).expect(200);
  await request(app).post(goodUrl()).send(payload).expect(200);

  const rows = await pool.query(
    'SELECT count(*)::int FROM bookings WHERE smoobu_id = $1',
    [55555]
  );
  assert.equal(rows.rows[0].count, 1);
});

test('newReservation replay with empty guest_name PRESERVES the original name', async () => {
  // Regression guard. Webhook route uses:
  //   guest_name = CASE WHEN EXCLUDED.guest_name = '' THEN bookings.guest_name ELSE EXCLUDED.guest_name END
  // so a follow-up webhook missing the guest name (which Smoobu sometimes
  // sends on channel-specific events) doesn't wipe it.
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  await request(app)
    .post(goodUrl())
    .send(newReservationEvent(property, { id: 66, 'guest-name': 'Original' }))
    .expect(200);

  await request(app)
    .post(goodUrl())
    .send(newReservationEvent(property, { id: 66, 'guest-name': '' }))
    .expect(200);

  const row = await pool.query('SELECT guest_name FROM bookings WHERE smoobu_id = $1', [66]);
  assert.equal(row.rows[0].guest_name, 'Original');
});

test('newReservation stores commission-included from Smoobu payload', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  await request(app)
    .post(goodUrl())
    .send({
      action: 'newReservation',
      data: {
        id: 8888,
        apartment: { id: property.smoobu_id },
        'guest-name': 'Commission Test',
        arrival: '2025-06-10',
        departure: '2025-06-13',
        channel: { name: 'Booking.com' },
        price: 5000,
        adults: 2,
        'commission-included': 750,
      },
    })
    .expect(200);

  const row = await pool.query('SELECT commission FROM bookings WHERE smoobu_id = $1', [8888]);
  assert.equal(Number(row.rows[0].commission), 750);
});

test('newReservation stores children separately from adults', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  await request(app)
    .post(goodUrl())
    .send({
      action: 'newReservation',
      data: {
        id: 7777,
        apartment: { id: property.smoobu_id },
        'guest-name': 'Family Booking',
        arrival: '2025-06-10',
        departure: '2025-06-13',
        price: 5000,
        adults: 2,
        children: 2,
      },
    })
    .expect(200);

  const row = await pool.query(
    'SELECT num_guests, children FROM bookings WHERE smoobu_id = $1', [7777]);
  assert.equal(row.rows[0].num_guests, 2);
  assert.equal(row.rows[0].children, 2, 'a party of four must not be recorded as two');
});

test('modifyReservation updates children too', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({ property, smoobu_id: 7778, num_guests: 2 });

  await request(app)
    .post(goodUrl())
    .send({
      action: 'modifyReservation',
      data: {
        id: 7778,
        apartment: { id: property.smoobu_id },
        'guest-name': 'Family Booking',
        arrival: '2025-06-10',
        departure: '2025-06-13',
        price: 5000,
        adults: 3,
        children: 1,
      },
    })
    .expect(200);

  const row = await pool.query(
    'SELECT num_guests, children FROM bookings WHERE smoobu_id = $1', [7778]);
  assert.equal(row.rows[0].num_guests, 3);
  assert.equal(row.rows[0].children, 1);
});

// --- modifyReservation ----------------------------------------------------

test('modifyReservation updates the row in place — no duplicate', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({
    property,
    smoobu_id: 42,
    guest_name: 'Original Name',
    check_in: '2025-06-10',
    check_out: '2025-06-13',
    total_price: 3000,
    num_guests: 2,
  });

  await request(app)
    .post(goodUrl())
    .send({
      action: 'modifyReservation',
      data: {
        id: 42,
        apartment: { id: property.smoobu_id },
        'guest-name': 'Modified Name',
        arrival: '2025-06-11',
        departure: '2025-06-15',
        price: 4500,
        adults: 4,
      },
    })
    .expect(200);

  const rows = await pool.query('SELECT * FROM bookings WHERE smoobu_id = $1', [42]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].guest_name, 'Modified Name');
  // pg returns `date` columns as JS Date; normalise to YYYY-MM-DD for comparison.
  const checkIn = new Date(rows.rows[0].check_in).toISOString().slice(0, 10);
  const checkOut = new Date(rows.rows[0].check_out).toISOString().slice(0, 10);
  assert.equal(checkIn, '2025-06-11');
  assert.equal(checkOut, '2025-06-15');
  assert.equal(Number(rows.rows[0].total_price), 4500);
  assert.equal(rows.rows[0].num_guests, 4);
});

// --- cancelReservation ----------------------------------------------------

test('cancelReservation flips status to "cancelled" — row NOT deleted', async () => {
  // Critical invariant: cancellations must never delete rows because
  // analytics/finances tests depend on cancelled-booking history.
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({ property, smoobu_id: 77, status: 'confirmed' });

  await request(app)
    .post(goodUrl())
    .send({
      action: 'cancelReservation',
      data: { id: 77, apartment: { id: property.smoobu_id } },
    })
    .expect(200);

  const rows = await pool.query('SELECT * FROM bookings WHERE smoobu_id = $1', [77]);
  assert.equal(rows.rowCount, 1, 'booking row should still exist after cancel');
  assert.equal(rows.rows[0].status, 'cancelled');
});

test('cancelReservation for a booking that does not exist → 200, no crash', async () => {
  const app = await getApp();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  await request(app)
    .post(goodUrl())
    .send({
      action: 'cancelReservation',
      data: { id: 999, apartment: { id: property.smoobu_id } },
    })
    .expect(200);
});

// --- cross-property isolation --------------------------------------------

test('webhook writes only affect the matched apartment — user A\'s bookings untouched', async () => {
  // The webhook has no user context (Smoobu isn't scoped to a user), but a
  // payload for apartment B must never leak a row against apartment A.
  const app = await getApp();
  const alice = await seedUser({ role: 'admin' });
  const bob = await seedUser({ role: 'admin' });
  const aliceProp = await seedProperty({ owner: alice, smoobu_id: 101 });
  const bobProp = await seedProperty({ owner: bob, smoobu_id: 202 });

  await request(app)
    .post(goodUrl())
    .send(newReservationEvent(bobProp, { id: 333 }))
    .expect(200);

  // Booking landed on Bob's property.
  const bobRows = await pool.query('SELECT * FROM bookings WHERE property_id = $1', [bobProp.id]);
  assert.equal(bobRows.rowCount, 1);

  // Alice's property has nothing.
  const aliceRows = await pool.query('SELECT count(*)::int FROM bookings WHERE property_id = $1', [aliceProp.id]);
  assert.equal(aliceRows.rows[0].count, 0);
});
