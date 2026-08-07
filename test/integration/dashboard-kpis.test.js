const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const request = require('supertest');

/**
 * GET /api/dashboard/kpis — currency-corrected server-side KPIs.
 *
 * Replaces the client-side computation that had two bugs:
 *   1. Revenue "Last 30 days" was unbounded — future bookings inflated it.
 *   2. Sums used raw `total_price`, silently mixing currencies.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// Helpers ----------------------------------------------------------------

function todayPlus(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// --- auth wall + scoping -------------------------------------------------

test('unauthenticated → 401', async () => {
  const app = await getApp();
  await request(app).get('/api/dashboard/kpis').expect(401);
});

test('user with zero accessible properties → all zeros, no error', async () => {
  const user = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, user);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);
  assert.equal(body.revenue_earned.value, 0);
  assert.equal(body.revenue_coming.value, 0);
  assert.equal(body.avg_rate.value, 0);
  assert.equal(body.occupancy.value, 0);
});

test('scoping: user B only sees their own bookings\' revenue', async () => {
  const alice = await seedUser({ role: 'property_manager' });
  const bob = await seedUser({ role: 'property_manager' });
  const aliceProp = await seedProperty({ owner: alice });
  const bobProp = await seedProperty({ owner: bob });
  await seedBooking({ property: aliceProp, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 10000 });
  await seedBooking({ property: bobProp, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 3000 });

  const agent = await getAgent();
  await loginAs(agent, bob);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);
  assert.equal(body.revenue_earned.value, 3000, 'Bob should see only his 3000');
});

// --- Revenue Earned ------------------------------------------------------

test('revenue_earned counts stays that completed in the last 30 days', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // Completed 5 days ago → INCLUDED.
  await seedBooking({ property, check_in: todayPlus(-8), check_out: todayPlus(-5), total_price: 3000 });
  // Completed 20 days ago → INCLUDED.
  await seedBooking({ property, check_in: todayPlus(-25), check_out: todayPlus(-20), total_price: 5000 });
  // Completed 45 days ago → EXCLUDED (outside 30-day window).
  await seedBooking({ property, check_in: todayPlus(-50), check_out: todayPlus(-45), total_price: 9999 });
  // Future stay → EXCLUDED (goes into revenue_coming).
  await seedBooking({ property, check_in: todayPlus(10), check_out: todayPlus(13), total_price: 4000 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.revenue_earned.value, 8000, 'only the two in-window past bookings should count');
});

// --- Revenue Coming ------------------------------------------------------

test('revenue_coming counts stays whose check_out is in the future (in-progress + future)', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // Currently in house (arrived, hasn't left) → coming.
  await seedBooking({ property, check_in: todayPlus(-2), check_out: todayPlus(3), total_price: 2500 });
  // Future stay → coming.
  await seedBooking({ property, check_in: todayPlus(10), check_out: todayPlus(15), total_price: 5000 });
  // Fully in the past → NOT coming.
  await seedBooking({ property, check_in: todayPlus(-10), check_out: todayPlus(-7), total_price: 999 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.revenue_coming.value, 7500);
});

test('revenue_coming excludes cancelled and blocked-platform bookings', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, check_in: todayPlus(5), check_out: todayPlus(10), total_price: 3000 });
  await seedBooking({ property, check_in: todayPlus(5), check_out: todayPlus(10), total_price: 4000, status: 'cancelled' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);
  assert.equal(body.revenue_coming.value, 3000);
});

// --- Currency correctness — the whole reason this endpoint exists -------

test('revenue_earned uses converted_total_price (mixed currencies handled)', async () => {
  // A stay booked in ZAR: 3000. Same total goes through as-is when display
  // currency is ZAR (bulkConvert short-circuits on same-currency).
  // This test asserts the endpoint returns the ZAR total intact — proving
  // it went through the currency conversion codepath, not the raw sum.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({
    property,
    check_in: todayPlus(-5),
    check_out: todayPlus(-2),
    total_price: 3000,
    currency: 'ZAR',
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);
  assert.equal(body.revenue_earned.value, 3000);
  assert.equal(body.display_currency, 'ZAR');
});

// --- change_pct + prior_value --------------------------------------------

test('revenue_earned includes change_pct vs the prior 30 days', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // Last 30 days: R10 000 earned.
  await seedBooking({ property, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 10000 });
  // Prior 30 days (30..60 ago): R5 000 earned.
  await seedBooking({ property, check_in: todayPlus(-45), check_out: todayPlus(-42), total_price: 5000 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.revenue_earned.value, 10000);
  assert.equal(body.revenue_earned.prior_value, 5000);
  assert.equal(body.revenue_earned.change_pct, 100); // doubled → +100%
});

test('change_pct is 0 when prior_value is 0 (avoid divide-by-zero)', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 3000 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);
  assert.equal(body.revenue_earned.prior_value, 0);
  assert.equal(body.revenue_earned.change_pct, 0);
});

// --- avg_rate ------------------------------------------------------------

// --- property_id filter (regression: was ignored, always returned portfolio) ---

test('?property_id= filter returns only the requested property\'s revenue', async () => {
  const admin = await seedUser({ role: 'admin' });
  const villa = await seedProperty({ owner: admin, name: 'Villa' });
  const cottage = await seedProperty({ owner: admin, name: 'Cottage' });

  await seedBooking({ property: villa, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 10000 });
  await seedBooking({ property: cottage, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 3000 });

  const agent = await getAgent();
  await loginAs(agent, admin);

  const villaOnly = (await agent.get(`/api/dashboard/kpis?property_id=${villa.id}`).expect(200)).body;
  const cottageOnly = (await agent.get(`/api/dashboard/kpis?property_id=${cottage.id}`).expect(200)).body;
  const all = (await agent.get('/api/dashboard/kpis').expect(200)).body;

  assert.equal(villaOnly.revenue_earned.value, 10000, 'villa-only earned');
  assert.equal(cottageOnly.revenue_earned.value, 3000, 'cottage-only earned');
  assert.equal(all.revenue_earned.value, 13000, 'unfiltered = sum of both');
});

test('?property_id=all is treated as "no filter"', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await seedProperty({ owner: admin });
  await seedBooking({ property: p, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 5000 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis?property_id=all').expect(200);
  assert.equal(body.revenue_earned.value, 5000);
});

test('filter honours scoping: non-admin cannot request another user\'s property', async () => {
  const alice = await seedUser({ role: 'property_manager' });
  const bob = await seedUser({ role: 'property_manager' });
  const aliceProp = await seedProperty({ owner: alice });
  await seedBooking({ property: aliceProp, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 10000 });

  const agent = await getAgent();
  await loginAs(agent, bob);
  // Bob explicitly requests alice's property → scoping intersects to empty.
  const { body } = await agent.get(`/api/dashboard/kpis?property_id=${aliceProp.id}`).expect(200);
  assert.equal(body.revenue_earned.value, 0, 'must not leak alice\'s revenue');
  assert.equal(body.revenue_coming.value, 0);
});

test('avg_rate is the mean nightly rate of earned stays', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // Two earned stays: R1000/night and R1500/night → avg R1250.
  await seedBooking({
    property, check_in: todayPlus(-5), check_out: todayPlus(-2),
    total_price: 3000, length_of_stay: 3, price_per_night: 1000,
  });
  await seedBooking({
    property, check_in: todayPlus(-10), check_out: todayPlus(-8),
    total_price: 3000, length_of_stay: 2, price_per_night: 1500,
  });
  // Future stay — must NOT influence the earned average.
  await seedBooking({
    property, check_in: todayPlus(5), check_out: todayPlus(10),
    total_price: 50000, length_of_stay: 5, price_per_night: 10000,
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.avg_rate.value, 1250);
});
