const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { inDays } = require('../helpers/dates');
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

// --- setting a nightly rate by hand --------------------------------------

test('a nightly rate is sent to Smoobu before it is stored', async () => {
  // Smoobu takes a rate per date and adds each channel's percentage on
  // top, so one figure a night is the whole input. Storing it first would
  // put a price on the calendar that no guest can book.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });
  await pool.query('UPDATE properties SET base_price = 80 WHERE id = $1', [property.id]);

  const agent = await getAgent();
  await loginAs(agent, owner);
  const when = inDays(5);

  await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from: when, to: when, price: 2400 }).expect(200);

  const call = mockSmoobu.calls.setRatesForDates.find((c) => c.dates.includes(when));
  assert.ok(call, 'Smoobu was told');
  assert.equal(call.price, 2400);

  const { rows } = await pool.query(
    'SELECT price FROM daily_rates WHERE property_id = $1 AND date = $2', [property.id, when]
  );
  assert.equal(Math.round(rows[0].price), 2400, 'and our copy follows');
});

test('a rate below the Smoobu minimum is refused', async () => {
  // base_price is Smoobu's floor. An extra zero missed off is the
  // expensive direction, and this is the one number Smoobu already has
  // an opinion about.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });
  await pool.query('UPDATE properties SET base_price = 1600 WHERE id = $1', [property.id]);

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from: inDays(5), to: inDays(5), price: 160 }).expect(400);
  assert.match(res.body.error, /minimum/);
});

test('a range sets every night in it', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from: inDays(3), to: inDays(5), price: 3100 }).expect(200);

  assert.equal(res.body.nights, 3);
  const { rows } = await pool.query(
    'SELECT count(*)::int n FROM daily_rates WHERE property_id = $1 AND price = 3100', [property.id]
  );
  assert.equal(rows[0].n, 3);
});

test('a range leaves a booked night alone', async () => {
  // Dragging across a month must not rewrite the middle of somebody's
  // stay. The guest paid what they paid, and the count on screen should
  // be the nights that actually changed.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });
  const from = inDays(3);
  const mid = inDays(4);
  const to = inDays(6);

  await seedBooking({
    property, smoobu_id: 88231, check_in: mid, check_out: inDays(5), status: 'confirmed',
  });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from, to, price: 3100 }).expect(200);

  assert.equal(res.body.skipped, 1, 'the booked night was left out');
  assert.equal(res.body.nights, 3, 'the other four minus the booked one');

  const call = mockSmoobu.calls.setRatesForDates.at(-1);
  assert.ok(!call.dates.includes(mid), 'Smoobu was never asked to change it');

  const { rows } = await pool.query(
    'SELECT price FROM daily_rates WHERE property_id = $1 AND date = $2', [property.id, mid]
  );
  assert.equal(rows.length, 0, 'and nothing was stored for it either');
});

test('a range that is entirely booked is refused, not silently ignored', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });
  await seedBooking({
    property, smoobu_id: 88232, check_in: inDays(3), check_out: inDays(6), status: 'confirmed',
  });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from: inDays(3), to: inDays(5), price: 3100 }).expect(400);
  assert.match(res.body.error, /already booked/);
});

// --- minimum stay ---------------------------------------------------------

test('a minimum stay is sent alongside the rate', async () => {
  // Confirmed against Smoobu rather than assumed: a real write moved
  // 2027-03-28 from 4 nights to 3 and back. Every dry probe reached date
  // validation first and could not tell an honoured field from an
  // ignored one.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const when = inDays(4);
  await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from: when, to: when, price: 3800, min_stay: 3 }).expect(200);

  const call = mockSmoobu.calls.setRatesForDates.at(-1);
  assert.equal(call.minStay, 3, 'Smoobu was told the restriction');

  const { rows } = await pool.query(
    'SELECT min_stay FROM daily_rates WHERE property_id = $1 AND date = $2', [property.id, when]
  );
  assert.equal(rows[0].min_stay, 3, 'and our copy follows');
});

test('leaving the minimum out does not rewrite the one already there', async () => {
  // A default sent on every save would quietly clear a restriction
  // somebody set deliberately.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });
  const when = inDays(4);
  await pool.query(
    `INSERT INTO daily_rates (property_id, date, price, min_stay) VALUES ($1, $2, 2000, 5)`,
    [property.id, when]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.put(`/api/properties/${property.id}/rates`)
    .send({ from: when, to: when, price: 3800 }).expect(200);

  const call = mockSmoobu.calls.setRatesForDates.at(-1);
  assert.equal(call.minStay, null, 'Smoobu was not asked to change it');

  const { rows } = await pool.query(
    'SELECT price, min_stay FROM daily_rates WHERE property_id = $1 AND date = $2', [property.id, when]
  );
  assert.equal(Math.round(rows[0].price), 3800, 'the price moved');
  assert.equal(rows[0].min_stay, 5, 'the minimum did not');
});

test('a nonsense minimum stay is refused', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });

  const agent = await getAgent();
  await loginAs(agent, owner);
  for (const bad of [0, -2, 1.5, 400]) {
    const res = await agent.put(`/api/properties/${property.id}/rates`)
      .send({ from: inDays(4), to: inDays(4), price: 3800, min_stay: bad }).expect(400);
    assert.match(res.body.error, /minimum stay/i, `rejected ${bad}`);
  }
});

// --- the rate plan --------------------------------------------------------

test('a plan is saved, previewed, and only applied when asked', async () => {
  // Preview and apply share one function, so the list you approve is the
  // list that gets sent. Computing them separately is how somebody
  // agrees to one thing and gets another.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });

  const agent = await getAgent();
  await loginAs(agent, owner);

  // Every category, because the window may well fall inside a school
  // term — it does today, Bavaria's Summer Break runs to mid-September —
  // and a category with no rule is deliberately skipped.
  await agent.put(`/api/properties/${property.id}/rate-plan`).send({
    plan: {
      long_weekend: { price: 4200, min_stay: 3 },
      public_holiday: { price: 3800, min_stay: 2 },
      school_holiday: { price: 3600, min_stay: 5 },
      weekday: { price: 2400, min_stay: 2 },
      weekend: { price: 3200, min_stay: 2 },
    },
  }).expect(200);

  const saved = await agent.get(`/api/properties/${property.id}/rate-plan`).expect(200);
  assert.equal(saved.body.plan.weekend.price, 3200);

  const from = inDays(2);
  const to = inDays(9);
  const preview = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from, to }).expect(200);

  assert.ok(preview.body.nights >= 7, 'every night in the window');
  assert.ok(preview.body.rows.every((r) => r.new_price > 0), 'every night got a price');
  assert.equal(mockSmoobu.calls.setRatesForDates.length, 0, 'a preview sends nothing');

  const applied = await agent.post(`/api/properties/${property.id}/rate-plan/apply`)
    .send({ from, to }).expect(200);
  assert.equal(applied.body.applied, preview.body.changing, 'exactly what was previewed');
  assert.ok(mockSmoobu.calls.setRatesForDates.length > 0, 'and now it is sent');
});

test('applying twice does nothing the second time', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.put(`/api/properties/${property.id}/rate-plan`)
    .send({ plan: { weekday: { price: 2400 }, weekend: { price: 3200 } } }).expect(200);

  const from = inDays(2);
  const to = inDays(6);
  await agent.post(`/api/properties/${property.id}/rate-plan/apply`).send({ from, to }).expect(200);
  const calls = mockSmoobu.calls.setRatesForDates.length;

  const second = await agent.post(`/api/properties/${property.id}/rate-plan/apply`)
    .send({ from, to }).expect(200);
  assert.equal(second.body.applied, 0, 'nothing left to change');
  assert.equal(mockSmoobu.calls.setRatesForDates.length, calls, 'and Smoobu was not troubled again');
});

test('a plan never touches a booked night', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });
  const from = inDays(2);
  const mid = inDays(3);
  await seedBooking({
    property, smoobu_id: 77410, check_in: mid, check_out: inDays(4), status: 'confirmed',
  });

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.put(`/api/properties/${property.id}/rate-plan`)
    .send({ plan: { weekday: { price: 2400 }, weekend: { price: 3200 } } }).expect(200);

  const preview = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from, to: inDays(6) }).expect(200);
  assert.ok(!preview.body.rows.some((r) => r.date === mid), 'the guest paid what they paid');
});

test('a blank price removes that category rather than pricing it at zero', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, smoobu_id: 100 });

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.put(`/api/properties/${property.id}/rate-plan`)
    .send({ plan: { weekday: { price: 2400 }, weekend: { price: 3200 } } }).expect(200);
  await agent.put(`/api/properties/${property.id}/rate-plan`)
    .send({ plan: { weekday: { price: 2400 }, weekend: { price: '' } } }).expect(200);

  const saved = await agent.get(`/api/properties/${property.id}/rate-plan`).expect(200);
  assert.equal(saved.body.plan.weekend, undefined, 'weekends are left alone now');
  assert.equal(saved.body.plan.weekday.price, 2400);
});
