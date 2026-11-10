const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, todayISO } = require('../helpers/dates');

/**
 * What the Rates page is told about a channel.
 *
 * Two figures from one endpoint, and only one of them is a measurement.
 *
 * The markup divides what the guest paid by what those nights cost
 * *today* — Smoobu keeps one price per date and forgets the previous
 * one — so a reprice after a booking sold bends it. On the Lodge it
 * read +23.9% on a channel set to 20.5%, from bookings that had sold at
 * exactly 20.5% before their nights were repriced.
 *
 * The commission has no base in it: what the guest paid and what the
 * channel kept are two numbers on the same row.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

async function setup() {
  const user = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: user });
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, property };
}

/** A rate for each night of a range, as the sync would have stored it. */
async function rates(propertyId, from, nights, price) {
  for (let i = 0; i < nights; i++) {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    await pool.query(
      `INSERT INTO daily_rates (property_id, date, price) VALUES ($1, $2, $3)
       ON CONFLICT (property_id, date) DO UPDATE SET price = EXCLUDED.price`,
      [propertyId, d.toISOString().slice(0, 10), price]
    );
  }
}

test('the commission is measured even where no rate was ever synced', async () => {
  // The whole point of separating them. daily_rates runs 180 days
  // forward, so windowing the commission to it would throw away most of
  // the evidence for a figure that does not need a rate at all.
  const { agent, property } = await setup();
  await seedBooking({
    property, platform: 'Airbnb', status: 'confirmed',
    check_in: inDays(400), check_out: inDays(403), total_price: 10000,
  });
  await pool.query('UPDATE bookings SET commission = 1500');
  await rates(property.id, todayISO(), 5, 2000);

  const res = await agent.get(`/api/properties/${property.id}/observed-markup`).expect(200);
  assert.equal(res.body.commissions.airbnb.commission, 15);
  assert.equal(res.body.commissions.airbnb.bookings, 1);
});

test('a reprice bends the markup and leaves the commission alone', async () => {
  // Sold at 20.5% on a R2,048.96 night, then the rate was cut to
  // R2,000. The markup reads 23.4%; what Airbnb kept has not moved.
  const { agent, property } = await setup();
  const from = inDays(10);
  await seedBooking({
    property, platform: 'Airbnb', status: 'confirmed',
    check_in: from, check_out: inDays(13), total_price: 7407,
  });
  await pool.query('UPDATE bookings SET commission = 1320');
  await rates(property.id, from, 3, 2000);

  const res = await agent.get(`/api/properties/${property.id}/observed-markup`).expect(200);
  assert.equal(res.body.observed.airbnb.markup, 23.4, 'the markup is bent by the reprice');
  assert.equal(res.body.commissions.airbnb.commission, 17.8, 'what Airbnb kept is not');
});

test('a booking with no commission recorded leaves the channel absent', async () => {
  const { agent, property } = await setup();
  const from = inDays(10);
  await seedBooking({
    property, platform: 'Airbnb', status: 'confirmed',
    check_in: from, check_out: inDays(13), total_price: 7407,
  });
  await rates(property.id, from, 3, 2000);

  const res = await agent.get(`/api/properties/${property.id}/observed-markup`).expect(200);
  assert.equal(res.body.commissions.airbnb, undefined,
    'absent rather than reported as zero');
  assert.ok(res.body.observed.airbnb, 'the markup is still offered as context');
});
