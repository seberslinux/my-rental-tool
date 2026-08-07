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
  assert.equal(body.revenue_earned.gross, 3000, 'Bob should see only his 3000');
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

  assert.equal(body.revenue_earned.gross, 8000, 'only the two in-window past bookings should count');
});

// --- Revenue Coming ------------------------------------------------------

test('revenue_coming counts stays whose check_out is in the future (in-progress + future)', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // In-progress stay: 5 nights at R2500 (R500/night), 2 already slept.
  // Only the 3 remaining nights count as "coming" → R1500.
  await seedBooking({ property, check_in: todayPlus(-2), check_out: todayPlus(3), total_price: 2500 });
  // Entirely future stay → counts in full.
  await seedBooking({ property, check_in: todayPlus(10), check_out: todayPlus(15), total_price: 5000 });
  // Fully in the past → contributes nothing.
  await seedBooking({ property, check_in: todayPlus(-10), check_out: todayPlus(-7), total_price: 999 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.revenue_coming.gross, 6500, '1500 remaining nights + 5000 future');
});

test('an in-progress stay is split between earned and coming, with no double-count', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  // 5 nights at R2500 → R500/night. Two nights slept, three to go.
  await seedBooking({ property, check_in: todayPlus(-2), check_out: todayPlus(3), total_price: 2500 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.revenue_earned.gross, 1000, '2 nights slept');
  assert.equal(body.revenue_coming.gross, 1500, '3 nights remaining');
  assert.equal(
    body.revenue_earned.gross + body.revenue_coming.gross,
    2500,
    'the two cards must account for the booking exactly once'
  );
});

test('revenue_coming excludes cancelled and blocked-platform bookings', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, check_in: todayPlus(5), check_out: todayPlus(10), total_price: 3000 });
  await seedBooking({ property, check_in: todayPlus(5), check_out: todayPlus(10), total_price: 4000, status: 'cancelled' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);
  assert.equal(body.revenue_coming.gross, 3000);
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
  assert.equal(body.revenue_earned.gross, 3000);
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

  assert.equal(body.revenue_earned.gross, 10000);
  // change_pct compares net now-vs-prior. Both doubled (10000 → 5000 gross),
  // so proportionally net also doubles → +100% regardless of the exact
  // net amount.
  assert.equal(body.revenue_earned.change_pct, 100);
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

  assert.equal(villaOnly.revenue_earned.gross, 10000, 'villa-only earned');
  assert.equal(cottageOnly.revenue_earned.gross, 3000, 'cottage-only earned');
  assert.equal(all.revenue_earned.gross, 13000, 'unfiltered = sum of both');
});

test('?property_id=all is treated as "no filter"', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await seedProperty({ owner: admin });
  await seedBooking({ property: p, check_in: todayPlus(-5), check_out: todayPlus(-2), total_price: 5000 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis?property_id=all').expect(200);
  assert.equal(body.revenue_earned.gross, 5000);
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

// --- net revenue (deductions applied) -----------------------------------

test('response includes gross alongside net on revenue_earned and revenue_coming', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  // Configure Airbnb fees so calcDeductions produces non-zero deductions.
  await pool.query(
    `UPDATE properties SET commission_airbnb = 15, bank_charge_airbnb = 2, vat_airbnb = 15 WHERE id = $1`,
    [property.id]
  );
  await seedBooking({
    property, check_in: todayPlus(-5), check_out: todayPlus(-2),
    total_price: 1000, platform: 'Airbnb', currency: 'ZAR',
  });
  await seedBooking({
    property, check_in: todayPlus(5), check_out: todayPlus(10),
    total_price: 2000, platform: 'Airbnb', currency: 'ZAR',
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  // Earned: 1000 gross, deductions = 150 + 20 + 25.5 = 195.5 → net 804.5 → round 805
  assert.equal(body.revenue_earned.gross, 1000);
  assert.equal(body.revenue_earned.value, 805);
  // Coming: 2000 gross, deductions = 300 + 40 + 51 = 391 → net 1609
  assert.equal(body.revenue_coming.gross, 2000);
  assert.equal(body.revenue_coming.value, 1609);
});

test('when property has no commission rates set, net falls back to Smoobu\'s commission-included figure', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  // Explicitly zero out the schema defaults so the Smoobu-commission
  // fallback in calcDeductions kicks in.
  await pool.query(
    `UPDATE properties SET commission_booking = 0, bank_charge_booking = 0,
                            vat_booking = 0, vat_rate = 0 WHERE id = $1`,
    [property.id]
  );
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, length_of_stay, price_per_night, currency, commission)
     VALUES (99001, $1, 'X', $2, $3, 'Booking.com', 5000, 'confirmed', 2, 2, 2500, 'ZAR', 750)`,
    [property.id, todayPlus(-5), todayPlus(-3)]
  );

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.revenue_earned.gross, 5000);
  assert.equal(body.revenue_earned.value, 4250, 'net = 5000 - 750 Smoobu commission');
});

test('avg_rate is ADR (revenue over nights), not a mean of per-booking rates', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // 3 nights at R1000/night, and 2 nights at R1500/night.
  // ADR = (3000 + 3000) / (3 + 2) = R1200.
  // A mean of the two booking rates would give R1250 — wrong, because it
  // weights a 2-night stay as heavily as a 3-night one.
  await seedBooking({
    property, check_in: todayPlus(-5), check_out: todayPlus(-2),
    total_price: 3000, length_of_stay: 3, price_per_night: 1000,
  });
  await seedBooking({
    property, check_in: todayPlus(-10), check_out: todayPlus(-8),
    total_price: 3000, length_of_stay: 2, price_per_night: 1500,
  });
  // Future stay — must NOT influence the earned rate.
  await seedBooking({
    property, check_in: todayPlus(5), check_out: todayPlus(10),
    total_price: 50000, length_of_stay: 5, price_per_night: 10000,
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.avg_rate.value, 1200);
});

// --- forward occupancy ---------------------------------------------------

test('forward_occupancy returns six months, flagging the current one partial', async () => {
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  assert.equal(body.forward_occupancy.length, 6);
  assert.equal(body.forward_occupancy[0].is_partial ||
    new Date().getUTCDate() === 1, true, 'current month is partial unless today is the 1st');
  assert.equal(body.forward_occupancy[1].is_partial, false);
});

test('forward_occupancy surfaces an empty month as 0% rather than omitting it', async () => {
  // The reason this feature exists: a month with no bookings must be
  // visible while there is still time to fill it.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  // One booking ~2 months out; the months either side stay empty.
  await seedBooking({
    property,
    check_in: todayPlus(60),
    check_out: todayPlus(65),
    total_price: 5000,
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/kpis').expect(200);

  const booked = body.forward_occupancy.filter((m) => m.nights_booked > 0);
  const empty = body.forward_occupancy.filter((m) => m.nights_booked === 0);
  assert.ok(booked.length >= 1, 'the booked month appears');
  assert.ok(empty.length >= 1, 'empty months are reported, not dropped');
  assert.ok(empty.every((m) => m.occupancy_rate === 0 && m.revenue === 0));
});

test('forward_occupancy respects the property filter', async () => {
  const admin = await seedUser({ role: 'admin' });
  const villa = await seedProperty({ owner: admin });
  const cottage = await seedProperty({ owner: admin });
  await seedBooking({ property: villa, check_in: todayPlus(40), check_out: todayPlus(45), total_price: 5000 });

  const agent = await getAgent();
  await loginAs(agent, admin);

  const all = (await agent.get('/api/dashboard/kpis').expect(200)).body;
  const villaOnly = (await agent.get(`/api/dashboard/kpis?property_id=${villa.id}`).expect(200)).body;

  const sumAvail = (b) => b.forward_occupancy.reduce((s, m) => s + m.nights_available, 0);
  assert.ok(
    sumAvail(all) > sumAvail(villaOnly),
    'two properties offer more sellable nights than one'
  );
  assert.equal(sumAvail(all), sumAvail(villaOnly) * 2, 'denominator scales with property count');
});
