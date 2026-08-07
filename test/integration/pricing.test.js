const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking } = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const { runPricingEngine } = require('../../src/services/pricing');
const { pool } = require('../../src/db/database');

/**
 * Dynamic pricing engine correctness.
 *
 * runPricingEngine walks every property and, for each date in the next 30
 * days, computes a price then POSTs it to Smoobu via setRates. Rules
 * (in order — last one wins):
 *
 *   1. Skip booked or blocked dates entirely.
 *   2. Weekend (Fri/Sat)      → base × 1.30
 *   3. Last-minute (≤5d out)  → base × 0.85   (overrides weekend)
 *   4. Gap fill (1–2 night gap between bookings) → base × 0.75
 *
 * Every rate is rounded and passed to smoobu.setRates. mock-smoobu records
 * every call in `mockSmoobu.calls.setRates`, so these tests inspect that
 * array instead of asserting on DB state.
 *
 * The mock is set up with a fake API key in the harness, so Smoobu is
 * never actually hit.
 */

test.before(() => getApp());
test.beforeEach(async () => {
  await resetDb();
  mockSmoobu.reset();
});
test.after(() => closePool());

function todayPlus(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Given `date` (YYYY-MM-DD), return the call for that date or throw.
function callFor(date) {
  const c = mockSmoobu.calls.setRates.find((call) => call.from === date);
  if (!c) throw new Error(`no setRates call for ${date} (had: ${mockSmoobu.calls.setRates.map((x) => x.from).join(',')})`);
  return c;
}

// --- shape ---------------------------------------------------------------

test('runPricingEngine: walks all properties with base_price > 0 and pushes 31 rates each', async () => {
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, name: 'A', smoobu_id: 100, base_price: 1000 });
  await seedProperty({ owner: admin, name: 'B', smoobu_id: 200, base_price: 800 });
  // Zero-price property — must be skipped.
  await seedProperty({ owner: admin, name: 'Zero', smoobu_id: 300, base_price: 0 });

  await runPricingEngine();

  // 31 dates each (today .. today+30 inclusive) — check we hit both real ones.
  const forA = mockSmoobu.calls.setRates.filter((c) => c.apartmentId === 100);
  const forB = mockSmoobu.calls.setRates.filter((c) => c.apartmentId === 200);
  const forZero = mockSmoobu.calls.setRates.filter((c) => c.apartmentId === 300);
  assert.equal(forA.length, 31);
  assert.equal(forB.length, 31);
  assert.equal(forZero.length, 0, 'property with base_price=0 must not have rates pushed');
});

// --- pricing rules ------------------------------------------------------

test('rule: weekday far from today → price == base_price (no adjustment)', async () => {
  // Pick a Tuesday 20 days out — well past the last-minute window, not a
  // weekend, no gaps. Should be the plain base price.
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 42, base_price: 1000 });

  await runPricingEngine();

  const target = pickDate({ minDaysOut: 10, maxDaysOut: 25, weekdays: [1, 2, 3, 4] });
  const call = callFor(target);
  assert.equal(call.price, 1000);
});

test('rule: Friday or Saturday far from today → base × 1.30', async () => {
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 43, base_price: 1000 });

  await runPricingEngine();

  const target = pickDate({ minDaysOut: 10, maxDaysOut: 25, weekdays: [5, 6] });
  const call = callFor(target);
  assert.equal(call.price, 1300);
});

test('rule: within 5 days → base × 0.85 (overrides weekend surcharge)', async () => {
  // NB: the route computes `daysFromNow` via wall-clock subtraction and
  // Math.round, so the exact boundary (day 0 vs day 6) depends on time
  // of day. Days 2–4 are unambiguously inside [0,5] regardless of when
  // the test runs, so we assert only on those.
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 44, base_price: 1000 });

  await runPricingEngine();

  for (const d of [2, 3, 4]) {
    const dateStr = todayPlus(d);
    const call = mockSmoobu.calls.setRates.find((c) => c.from === dateStr && c.apartmentId === 44);
    assert.ok(call, `no rate set for ${dateStr}`);
    assert.equal(call.price, 850, `day +${d} should be 850 (last-minute), was ${call.price}`);
  }
});

test('rule: 1–2 night gap between bookings → base × 0.75', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 45, base_price: 1000 });

  // First booking: 10..13 (arrives day+10, leaves day+13)
  // Gap of 2 nights: day+13 and day+14 (available for last-minute-fill pricing)
  // Second booking: 15..18
  await seedBooking({
    property, smoobu_id: 1001,
    check_in: todayPlus(10), check_out: todayPlus(13),
  });
  await seedBooking({
    property, smoobu_id: 1002,
    check_in: todayPlus(15), check_out: todayPlus(18),
  });

  await runPricingEngine();

  // The gap nights must be priced at 0.75 * base, regardless of weekend.
  for (const d of [13, 14]) {
    const dateStr = todayPlus(d);
    const call = mockSmoobu.calls.setRates.find((c) => c.from === dateStr && c.apartmentId === 45);
    assert.ok(call, `no rate for gap night ${dateStr}`);
    assert.equal(call.price, 750, `gap night ${dateStr} should be 750, was ${call.price}`);
  }
});

test('rule: booked dates are skipped (no setRates call at all)', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 46, base_price: 1000 });
  await seedBooking({
    property, smoobu_id: 2001,
    check_in: todayPlus(10), check_out: todayPlus(13), // occupies day+10, +11, +12
  });

  await runPricingEngine();

  for (const d of [10, 11, 12]) {
    const dateStr = todayPlus(d);
    const call = mockSmoobu.calls.setRates.find((c) => c.from === dateStr && c.apartmentId === 46);
    assert.equal(call, undefined, `booked date ${dateStr} must NOT have a rate pushed`);
  }
});

test('rule: blocked dates are skipped', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 47, base_price: 1000 });
  const blocked = todayPlus(15);
  await pool.query(
    `INSERT INTO blocked_dates (property_id, date, reason) VALUES ($1, $2, 'test-block')`,
    [property.id, blocked]
  );

  await runPricingEngine();

  const call = mockSmoobu.calls.setRates.find((c) => c.from === blocked && c.apartmentId === 47);
  assert.equal(call, undefined, `blocked date ${blocked} must NOT have a rate pushed`);
});

// --- rounding + isolation -----------------------------------------------

test('prices are rounded to whole numbers', async () => {
  // Base 999 × 1.3 = 1298.7 → 1299. Base 999 × 0.85 = 849.15 → 849.
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 48, base_price: 999 });

  await runPricingEngine();

  for (const call of mockSmoobu.calls.setRates) {
    assert.equal(Number.isInteger(call.price), true, `${call.from} price ${call.price} not integer`);
  }
});

test('a failure on one date does not stop pricing for the rest of the property', async () => {
  // Regression guard: the per-date setRates call is wrapped in try/catch so
  // a Smoobu blip on Tuesday doesn't prevent pricing Wednesday.
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 49, base_price: 1000 });

  const smoobu = require('../../src/services/smoobu');
  const origSet = smoobu.setRates;
  let n = 0;
  smoobu.setRates = async (aptId, from, to, price) => {
    n++;
    if (n === 5) throw new Error('Smoobu 502');
    mockSmoobu.calls.setRates.push({ apartmentId: aptId, from, to, price });
    return { ok: true };
  };

  try {
    await runPricingEngine();
    // 31 attempts overall; one threw, so 30 recorded.
    assert.equal(n, 31, 'the loop must attempt all 31 dates');
    assert.equal(mockSmoobu.calls.setRates.length, 30);
  } finally {
    smoobu.setRates = origSet;
  }
});

// --- helpers -------------------------------------------------------------

// Pick the first date in [today+minDaysOut, today+maxDaysOut] whose
// dayOfWeek is in `weekdays`. Throws if none.
function pickDate({ minDaysOut, maxDaysOut, weekdays }) {
  for (let d = minDaysOut; d <= maxDaysOut; d++) {
    const iso = todayPlus(d);
    const dow = new Date(iso + 'T00:00:00').getDay();
    if (weekdays.includes(dow)) return iso;
  }
  throw new Error(`no matching date in [${minDaysOut},${maxDaysOut}] for weekdays ${weekdays}`);
}
