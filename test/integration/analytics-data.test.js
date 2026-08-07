const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * GET /api/analytics/data — end-to-end accuracy tests.
 *
 * Seeds known bookings in Postgres, hits the endpoint via supertest,
 * and asserts the response numbers match hand-computed values. Catches
 * SQL bugs, join bugs, scoping leaks, filter bugs, and any regression in
 * the extracted aggregators when called against real DB state.
 *
 * All fixtures use ZAR + display_currency=ZAR to skip the exchange-rate
 * service's HTTP calls (bulkConvert short-circuits when currency matches).
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// --- auth wall + scoping --------------------------------------------------

test('unauthenticated GET /api/analytics/data → 401', async () => {
  const app = await getApp();
  const request = require('supertest');
  await request(app).get('/api/analytics/data').expect(401);
});

test('scoping: user B sees zero rows from user A\'s bookings', async () => {
  const alice = await seedUser({ role: 'property_manager' });
  const bob = await seedUser({ role: 'property_manager' });
  const aliceProp = await seedProperty({ owner: alice, name: 'Alice Villa' });
  const bobProp = await seedProperty({ owner: bob, name: 'Bob Cottage' });
  await seedBooking({ property: aliceProp, total_price: 5000, length_of_stay: 5 });
  await seedBooking({ property: bobProp, total_price: 3000, length_of_stay: 3 });

  const agent = await getAgent();
  await loginAs(agent, bob);

  const res = await agent.get('/api/analytics/data').expect(200);
  assert.equal(res.body.summary.total_revenue, 3000, 'Bob should see only his 3000 booking');
  assert.equal(res.body.summary.total_bookings, 1);
  // revenue_by_property should only contain Bob's property.
  assert.deepEqual(
    res.body.revenue_by_property.map((r) => r.property),
    ['Bob Cottage']
  );
});

// --- happy-path fixture accuracy -----------------------------------------

test('summary totals equal hand-computed sums over seeded bookings', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // 3 bookings: R3000 (3n), R5000 (5n), R7000 (7n) = R15000 / 15 nights / 3 bookings.
  await seedBooking({ property, check_in: '2025-06-01', check_out: '2025-06-04', total_price: 3000, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property, check_in: '2025-06-10', check_out: '2025-06-15', total_price: 5000, length_of_stay: 5, platform: 'Direct booking' });
  await seedBooking({ property, check_in: '2025-06-20', check_out: '2025-06-27', total_price: 7000, length_of_stay: 7, platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  assert.equal(body.summary.total_revenue, 15000);
  assert.equal(body.summary.total_bookings, 3);
  assert.equal(body.summary.total_nights, 15);
  // Direct bookings → 0 deductions, so net == gross.
  assert.equal(body.summary.total_deductions, 0);
  assert.equal(body.summary.net_revenue, 15000);
});

test('revenue_timeline aggregates each month correctly', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({ property, check_in: '2025-06-05', check_out: '2025-06-08', total_price: 3000, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property, check_in: '2025-06-20', check_out: '2025-06-25', total_price: 5000, length_of_stay: 5, platform: 'Direct booking' });
  await seedBooking({ property, check_in: '2025-07-10', check_out: '2025-07-12', total_price: 2000, length_of_stay: 2, platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  const byMonth = Object.fromEntries(body.revenue_timeline.map((r) => [r.month, r]));
  assert.equal(byMonth['2025-06'].total, 8000);
  assert.equal(byMonth['2025-06'].bookings, 2);
  assert.equal(byMonth['2025-06'].nights, 8);
  assert.equal(byMonth['2025-07'].total, 2000);
  assert.equal(byMonth['2025-07'].bookings, 1);
  assert.equal(byMonth['2025-07'].nights, 2);
});

test('revenue_by_property splits per property with correct totals', async () => {
  const admin = await seedUser({ role: 'admin' });
  const villa = await seedProperty({ owner: admin, name: 'Sea Villa' });
  const cottage = await seedProperty({ owner: admin, name: 'Mountain Cottage' });

  await seedBooking({ property: villa, total_price: 6000, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property: villa, total_price: 4000, length_of_stay: 4, platform: 'Direct booking' });
  await seedBooking({ property: cottage, total_price: 2500, length_of_stay: 5, platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  const byName = Object.fromEntries(body.revenue_by_property.map((r) => [r.property, r]));
  assert.equal(byName['Sea Villa'].total, 10000);
  assert.equal(byName['Sea Villa'].bookings, 2);
  assert.equal(byName['Sea Villa'].nights, 7);
  assert.equal(byName['Mountain Cottage'].total, 2500);
  assert.equal(byName['Mountain Cottage'].bookings, 1);
  assert.equal(byName['Mountain Cottage'].nights, 5);
});

test('cross-facet invariant: sum(by month) == sum(by property) == portfolio total', async () => {
  // The same invariant proved on hand-fixtures in unit tests must also hold
  // at the endpoint layer. Guards against SQL/aggregator drift.
  const admin = await seedUser({ role: 'admin' });
  const villa = await seedProperty({ owner: admin, name: 'A' });
  const cottage = await seedProperty({ owner: admin, name: 'B' });

  await seedBooking({ property: villa, check_in: '2025-06-10', check_out: '2025-06-13', total_price: 3000, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property: villa, check_in: '2025-07-01', check_out: '2025-07-05', total_price: 5000, length_of_stay: 4, platform: 'Direct booking' });
  await seedBooking({ property: cottage, check_in: '2025-06-15', check_out: '2025-06-18', total_price: 2500, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property: cottage, check_in: '2025-08-01', check_out: '2025-08-05', total_price: 4500, length_of_stay: 4, platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  const sumBy = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);
  const portfolio = body.summary.total_revenue;
  const byMonth = sumBy(body.revenue_timeline, 'total');
  const byProperty = sumBy(body.revenue_by_property, 'total');

  assert.equal(byMonth, portfolio, `by-month sum ${byMonth} != portfolio ${portfolio}`);
  assert.equal(byProperty, portfolio, `by-property sum ${byProperty} != portfolio ${portfolio}`);
  assert.equal(portfolio, 15000, 'hand-computed total');
});

// --- filtering ------------------------------------------------------------

test('cancelled bookings excluded from summary totals', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({ property, total_price: 3000, length_of_stay: 3, status: 'confirmed', platform: 'Direct booking' });
  await seedBooking({ property, total_price: 5000, length_of_stay: 5, status: 'cancelled', platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  assert.equal(body.summary.total_revenue, 3000);
  assert.equal(body.summary.total_bookings, 1);
});

test('blocked-platform bookings excluded from summary totals', async () => {
  // "Blocked channel" (and "Blocked channel auto") are calendar blocks, not
  // real revenue — the SQL WHERE clause filters them out.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({ property, total_price: 3000, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property, total_price: 999, length_of_stay: 3, platform: 'Blocked channel' });
  await seedBooking({ property, total_price: 999, length_of_stay: 3, platform: 'Blocked channel auto' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  assert.equal(body.summary.total_revenue, 3000);
  assert.equal(body.summary.total_bookings, 1);
});

test('date filter: from/to restricts to bookings whose check_in falls inside', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({ property, check_in: '2025-05-01', check_out: '2025-05-04', total_price: 3000, length_of_stay: 3, platform: 'Direct booking' });
  await seedBooking({ property, check_in: '2025-06-10', check_out: '2025-06-15', total_price: 5000, length_of_stay: 5, platform: 'Direct booking' });
  await seedBooking({ property, check_in: '2025-07-20', check_out: '2025-07-25', total_price: 7000, length_of_stay: 5, platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data?from=2025-06&to=2025-06-30').expect(200);

  assert.equal(body.summary.total_revenue, 5000, 'only the June booking should count');
  assert.equal(body.summary.total_bookings, 1);
});

// --- deductions -----------------------------------------------------------

test('total_deductions computed from per-platform property rates', async () => {
  const admin = await seedUser({ role: 'admin' });
  // Property with Airbnb commission 15%, bank 2%, VAT 15% on comm+bank.
  const property = await seedProperty({ owner: admin });
  await pool.query(
    `UPDATE properties SET commission_airbnb = 15, bank_charge_airbnb = 2, vat_airbnb = 15 WHERE id = $1`,
    [property.id]
  );

  // R1000 booking on Airbnb.
  //   commission = 1000 × 15% = 150
  //   bank       = 1000 × 2%  = 20
  //   vat        = (150 + 20) × 15% = 25.5
  //   total_deductions = 195.5
  await seedBooking({ property, total_price: 1000, length_of_stay: 1, platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  assert.equal(body.summary.total_revenue, 1000);
  assert.equal(body.summary.total_deductions, 195.5);
  assert.equal(body.summary.net_revenue, 1000 - 195.5);
});

test('Direct bookings contribute 0 deductions even if rates are configured', async () => {
  // Regression guard: even with rates set on the property, a Direct booking
  // must never subtract from its own revenue.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await pool.query(
    `UPDATE properties SET commission_airbnb = 15, bank_charge_airbnb = 2, vat_airbnb = 15,
                            commission_booking = 12, bank_charge_booking = 2 WHERE id = $1`,
    [property.id]
  );
  await seedBooking({ property, total_price: 1000, length_of_stay: 1, platform: 'Direct booking' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/analytics/data').expect(200);

  assert.equal(body.summary.total_deductions, 0);
  assert.equal(body.summary.net_revenue, 1000);
});
