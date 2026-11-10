const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, daysAgo } = require('../helpers/dates');

/**
 * Every event Smoobu actually sends.
 *
 * Taken from production traffic, not from the documentation: over one
 * window Smoobu sent newMessage thirteen times, updateRates four times,
 * newReservation three times and cancelReservation once. It has never
 * sent `modifyReservation`, which is the only name this listened for —
 * so a changed booking fell through to nothing and waited for the
 * periodic sync.
 *
 * The rate and message events carry no apartment on the payload, and
 * the property was looked up before anything branched, so both ended at
 * "Property not found for apartment undefined" and returned 200.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret';

async function setup() {
  const user = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: user, name: 'The loft' });
  return { app: await getApp(), property };
}

const post = (app, body) => request(app).post(`/webhook/${SECRET}`).send(body).expect(200);

function reservation(action, { id = 162785440, apartmentId, arrival, departure, price = 9000 }) {
  return {
    action, user: 971234,
    data: {
      id, 'reference-id': 'HMDP2H28PP', type: 'reservation',
      arrival, departure, 'created-at': daysAgo(2), 'guest-name': 'Dana Petersen',
      price, adults: 2, channel: { name: 'Booking.com' }, apartment: { id: apartmentId },
    },
  };
}

// --- rates, which never reached the database ----------------------------

test('a rate change is applied the moment it arrives', async () => {
  // The exact payload from production: keyed by apartment, then date.
  const { app, property } = await setup();
  const d1 = inDays(18), d2 = inDays(19);

  await post(app, {
    action: 'updateRates', user: 971234,
    data: { [property.smoobu_id]: {
      [d1]: { price: 2200, min_length_of_stay: 2, available: 0 },
      [d2]: { price: 2400, min_length_of_stay: 2, available: 1 },
    } },
  });

  const { rows } = await pool.query(
    'SELECT date, price, min_stay, available FROM daily_rates WHERE property_id = $1 ORDER BY date',
    [property.id]
  );
  assert.equal(rows.length, 2);
  assert.equal(Number(rows[0].price), 2200);
  assert.equal(rows[0].min_stay, 2);
  assert.equal(rows[0].available, 0, 'a closed night stays closed');
  assert.equal(Number(rows[1].price), 2400);
  assert.equal(rows[1].available, 1);
});

test('a repriced night overwrites the old price rather than adding a row', async () => {
  const { app, property } = await setup();
  const date = inDays(18);
  const body = (price) => ({
    action: 'updateRates',
    data: { [property.smoobu_id]: { [date]: { price, min_length_of_stay: 1, available: 1 } } },
  });

  await post(app, body(2200));
  await post(app, body(3100));

  const { rows } = await pool.query('SELECT price FROM daily_rates WHERE property_id = $1', [property.id]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].price), 3100);
});

test('rates for an apartment we do not have are skipped, not fatal', async () => {
  const { app, property } = await setup();
  const date = inDays(18);
  await post(app, {
    action: 'updateRates',
    data: {
      999999: { [date]: { price: 1000 } },
      [property.smoobu_id]: { [date]: { price: 2200 } },
    },
  });

  const { rows } = await pool.query('SELECT property_id, price FROM daily_rates');
  assert.equal(rows.length, 1, 'the one we do have was still written');
  assert.equal(rows[0].property_id, property.id);
});

test('a key that is not a date is not stored', async () => {
  // It would sit in a TEXT column matching no lookup — an entry that
  // exists and does nothing.
  const { app, property } = await setup();
  await post(app, {
    action: 'updateRates',
    data: { [property.smoobu_id]: { 'next Tuesday': { price: 2200 } } },
  });
  const { rows } = await pool.query('SELECT * FROM daily_rates');
  assert.equal(rows.length, 0);
});

// --- a changed booking ---------------------------------------------------

test('updateReservation is picked up, which is the name Smoobu sends', async () => {
  const { app, property } = await setup();
  await post(app, reservation('newReservation', {
    apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24),
  }));

  await post(app, reservation('updateReservation', {
    apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(27), price: 15000,
  }));

  const { rows } = await pool.query('SELECT * FROM bookings WHERE smoobu_id = 162785440');
  assert.equal(rows[0].check_out, inDays(27), 'the new departure landed');
  assert.equal(rows[0].length_of_stay, 7);

  const notes = await pool.query("SELECT * FROM notifications WHERE event = 'booking_changed'");
  assert.equal(notes.rows.length, 1, 'and somebody was told');
});

test('the names this used to guess at still work', async () => {
  // Accepting a name Smoobu does not send costs nothing. Guessing wrong
  // cost every booking change until now.
  const { app, property } = await setup();
  await post(app, reservation('newReservation', {
    apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24),
  }));
  await post(app, reservation('modifyReservation', {
    apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(25),
  }));

  const { rows } = await pool.query('SELECT check_out FROM bookings WHERE smoobu_id = 162785440');
  assert.equal(rows[0].check_out, inDays(25));
});

// --- the quiet ones ------------------------------------------------------

test('a guest message is acknowledged without a property lookup', async () => {
  // Written when nothing read messages, and asserted `handled: false`.
  // Messages are handled now; what this still pins is the bug it was for —
  // a message carries no apartment, and it must not die on the lookup
  // that assumed one. A host's own message is acknowledged and announced
  // to nobody.
  const { app } = await setup();
  const res = await post(app, {
    action: 'newMessage', user: 971234,
    data: { id: 807596893, sender: 'host', booking: { id: 162785440 } },
  });
  assert.equal(res.body.received, true);
  assert.equal(res.body.action, 'newMessage');
  assert.notEqual(res.body.action, 'unknown property');
  const { rows } = await pool.query("SELECT * FROM notifications WHERE event = 'guest_message'");
  assert.equal(rows.length, 0);
});

test('an action nobody handles says so rather than looking successful', async () => {
  const { app, property } = await setup();
  const res = await post(app, reservation('somethingNew', {
    apartmentId: property.smoobu_id, arrival: inDays(20), departure: inDays(24),
  }));
  assert.equal(res.body.handled, false);
  assert.equal(res.body.action, 'somethingNew');
});
