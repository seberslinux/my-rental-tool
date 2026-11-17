const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { todayISO, inDays } = require('../helpers/dates');
const { runAutoPricing } = require('../../src/services/dynamic-pricing');

/**
 * Automatic pricing end to end, with Smoobu replaced by a recorder.
 *
 * Four competitors asking R3,000 a night (R2,190 in our rate at the 1.37
 * our own listing's quotes measure), our nights at R2,000, one of them
 * booked. On night 20 every competitor is full; on the others one is.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const today = todayISO();
const DAYS = 40;
const weekend = (d) => [5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

async function setup() {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  const listing = (id, name, own) => pool.query(
    `INSERT INTO peer_listings (airbnb_id, name, bedrooms, property_id, is_own) VALUES ($1, $2, 2, $3, $4) RETURNING id`,
    [id, name, lodge.id, own]
  ).then((r) => r.rows[0].id);
  const own = await listing('100', 'Our lodge', true);
  const peers = [];
  for (let i = 1; i <= 4; i++) peers.push(await listing(String(100 + i), `Peer ${i}`, false));

  for (let i = 1; i <= DAYS; i++) {
    const d = inDays(i);
    const kind = weekend(d) ? 'weekend' : 'weekday';
    for (const [n, id] of peers.entries()) {
      const full = i === 20 || n === 0;
      await pool.query(`INSERT INTO peer_calendar (listing_id, date, available, min_nights) VALUES ($1, $2, $3, 2)`, [id, d, !full]);
      await pool.query(`INSERT INTO peer_prices (listing_id, check_in, nights, kind, nightly, total) VALUES ($1, $2, 2, $3, 3000, 6000)`, [id, d, kind]);
    }
    await pool.query(`INSERT INTO peer_prices (listing_id, check_in, nights, kind, nightly, total) VALUES ($1, $2, 2, $3, 2740, 5480)`, [own, d, kind]);
    await pool.query(`INSERT INTO daily_rates (property_id, date, price, min_stay, available) VALUES ($1, $2, 2000, 2, $3)`, [lodge.id, d, i === 5 ? 0 : 1]);
  }
  // A confirmed stay on nights 8 and 9 the rates still show as open.
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status,
                           num_guests, length_of_stay, price_per_night, currency, lead_time_days, created_at)
     VALUES (880001, $1, 'Sam Guest', $2, $3, 'Airbnb', 4000, 'confirmed', 2, 2, 2000, 'ZAR', 8, $4)`,
    [lodge.id, inDays(8), inDays(10), today]
  );
  return { admin, lodge };
}

const recorder = () => {
  const calls = [];
  const setRates = async (property, dates, price) => { calls.push({ dates, price }); };
  return { calls, setRates };
};
const noNotes = async () => {};

test('a property is off until a mode is chosen: nothing is sent', async () => {
  await setup();
  const r = recorder();
  assert.deepEqual(await runAutoPricing({ today, setRates: r.setRates, notifyImpl: noNotes }), []);
  assert.equal(r.calls.length, 0);
});

test('switched on, it prices open nights within the guardrails, logs every change and says so once', async () => {
  const { admin, lodge } = await setup();
  const agent = await getAgent();
  await loginAs(agent, admin);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`).send({ mode: 'balanced', floor: 1800, ceiling: 3000, max_step: 15, horizon: DAYS }).expect(200);

  const r = recorder();
  const notes = [];
  const [result] = await runAutoPricing({ today, setRates: r.setRates, notifyImpl: async (n) => notes.push(n) });
  assert.ok(result.changed > 0);

  const sent = r.calls.flatMap((c) => c.dates.map((d) => ({ d, price: c.price })));
  const byDate = Object.fromEntries(sent.map((x) => [x.d, x.price]));
  for (const i of [5, 8, 9]) assert.equal(byDate[inDays(i)], undefined, `night ${i} is taken and never touched`);
  for (const { price } of sent) assert.ok(price >= 1800 && price <= 2300 && price >= 1700, `${price} within floor, ceiling and 15% of R2,000`);

  const logged = await pool.query('SELECT date, old_price, new_price, mode FROM price_changes WHERE property_id = $1', [lodge.id]);
  assert.equal(logged.rows.length, sent.length);
  assert.ok(logged.rows.every((x) => x.mode === 'balanced' && Number(x.old_price) === 2000));
  const rate = await pool.query('SELECT price FROM daily_rates WHERE property_id = $1 AND date = $2', [lodge.id, sent[0].d]);
  assert.equal(Number(rate.rows[0].price), sent[0].price, 'the calendar shows the new price');

  assert.equal(notes.length, 1);
  assert.equal(notes[0].event, 'prices_updated');
  assert.match(notes[0].title, /Hill Top Lodge: \d+ nights? repriced \(balanced\)/);

  // The next morning, the same market: nothing left to move but the step.
  const again = recorder();
  await runAutoPricing({ today, setRates: again.setRates, notifyImpl: noNotes });
  assert.ok(again.calls.every((c) => c.dates.every((d) => byDate[d] != null)), 'only nights it is still walking towards the target');
});

test('a night the whole market has sold is priced above a quiet one', async () => {
  const { admin, lodge } = await setup();
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get(`/api/properties/${lodge.id}/auto-pricing`).expect(200);
  const night = (i) => body.nights.find((n) => n.date === inDays(i));
  assert.equal(night(20).fullness, 100);
  assert.equal(night(19).fullness, 25);
  for (const m of ['occupancy', 'balanced', 'revenue']) {
    assert.ok(night(20).recommended[m].rate > night(19).recommended[m].rate, m);
  }
  assert.ok(Math.abs(body.factor - 2740 / 2000) < 0.01, 'guest price against our rate, measured from our own quotes');
  assert.equal(body.settings.mode, 'off');
  assert.ok(body.totals.revenue.money >= body.totals.occupancy.money, 'most money earns the most');
  assert.ok(body.totals.occupancy.nights >= body.totals.revenue.nights, 'most nights sells the most');
  assert.equal(night(5), undefined, 'a booked night is not offered for pricing');
});

test('it will not switch on without a floor, nor take a ceiling under it', async () => {
  const { admin, lodge } = await setup();
  const agent = await getAgent();
  await loginAs(agent, admin);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`).send({ mode: 'revenue' }).expect(400);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`).send({ mode: 'revenue', floor: 2000, ceiling: 1500 }).expect(400);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`).send({ mode: 'sideways', floor: 2000 }).expect(400);
});

test('when Smoobu refuses, it stops and says so', async () => {
  const { admin, lodge } = await setup();
  const agent = await getAgent();
  await loginAs(agent, admin);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`).send({ mode: 'revenue', floor: 1500, horizon: DAYS }).expect(200);
  const notes = [];
  const [r] = await runAutoPricing({
    today,
    setRates: async () => { throw new Error('rate limit'); },
    notifyImpl: async (n) => notes.push(n),
  });
  assert.equal(r.changed, 0);
  assert.equal(r.error, 'rate limit');
  assert.equal(notes[0].event, 'prices_failed');
  const logged = await pool.query('SELECT COUNT(*)::int AS n FROM price_changes');
  assert.equal(logged.rows[0].n, 0, 'nothing logged that was not sent');
});
