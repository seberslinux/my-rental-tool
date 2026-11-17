const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { todayISO, inDays, daysAgo } = require('../helpers/dates');
const { runAutoPricing } = require('../../src/services/dynamic-pricing');

/**
 * Automatic pricing end to end, with Smoobu replaced by a recorder.
 *
 * Four competitors asking R3,000 a night all-in (R2,220 in our rate, once
 * our 20.5% markup and the R330 a night of cleaning our own quotes show
 * are taken off), our nights at R2,000, some of them booked. On night 20
 * every competitor is full; on the others one is.
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
  await pool.query('UPDATE properties SET guest_markup_airbnb = 20.5 WHERE id = $1', [lodge.id]);
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
  // Our R2,000 shows on Airbnb at R2,740 a night: R2,410 with the 20.5%
  // markup, and R330 a night of a R660 cleaning fee over two nights.
  assert.deepEqual(body.conversion, { markup: 20.5, cleaning: 660, stay: 2, competitors_cleaning: null, competitors_measured: 0 });
  assert.equal(night(19).market, 6000, 'two nights at R3,000 all-in: the stay as a guest pays it');
  assert.equal(night(19).market_rate, 2220, 'the rate that makes our two nights cost the same: (6000 − 660) / 2 / 1.205');
  const bal = night(19).recommended.balanced;
  assert.ok(Math.abs(bal.total - (bal.rate * 1.205 * 2 + 660)) <= 20, 'each recommendation carries the stay total it makes');
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

test("each month keeps its own floor", async () => {
  const { admin, lodge } = await setup();
  const agent = await getAgent();
  await loginAs(agent, admin);
  const month = Number(inDays(1).slice(5, 7));
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`)
    .send({ mode: 'occupancy', floor: 1200, floors: { [month]: 2200 }, max_step: 50, horizon: DAYS }).expect(200);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`)
    .send({ mode: 'occupancy', floor: 1200, floors: { [month]: 2200 }, ceiling: 2100 }).expect(400, /above every floor/);
  await agent.put(`/api/properties/${lodge.id}/auto-pricing`)
    .send({ mode: 'occupancy', floors: { [month]: 2200 } }).expect(400, /every month/);

  const r = recorder();
  await runAutoPricing({ today, setRates: r.setRates, notifyImpl: noNotes });
  const sent = r.calls.flatMap((c) => c.dates.map((d) => ({ d, price: c.price })));
  const inMonth = sent.filter((x) => Number(x.d.slice(5, 7)) === month);
  assert.ok(inMonth.length > 0);
  assert.ok(inMonth.every((x) => x.price >= 2200), 'this month never under its own floor');
  assert.ok(sent.filter((x) => Number(x.d.slice(5, 7)) !== month).every((x) => x.price >= 1200), 'the rest under the general one');

  const { body } = await agent.get(`/api/properties/${lodge.id}/auto-pricing`).expect(200);
  assert.deepEqual(body.settings.floors, { [month]: 2200 });
});

test("the stay total competes: each competitor's own cleaning fee, our typical stay", async () => {
  const { admin, lodge } = await setup();
  // Our typical stay is three nights.
  for (const [id, ago] of [[880101, 60], [880102, 40]]) {
    await pool.query(
      `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status,
                             num_guests, length_of_stay, price_per_night, currency, lead_time_days, created_at)
       VALUES ($1, $2, 'Past Guest', $3, $4, 'Airbnb', 6000, 'confirmed', 2, 3, 2000, 'ZAR', 10, $3)`,
      [id, lodge.id, daysAgo(ago), daysAgo(ago - 3)]
    );
  }
  // Peer 1 charges R0 cleaning, peers 2–4 R1,200; ours R660.
  const ids = (await pool.query(`SELECT id, name FROM peer_listings WHERE property_id = $1 ORDER BY id`, [lodge.id])).rows;
  for (const l of ids) {
    const fee = l.name === 'Our lodge' ? 660 : l.name === 'Peer 1' ? 0 : 1200;
    await pool.query(
      `INSERT INTO peer_cleaning_fees (listing_id, check_in, nights, total_first, total_second, total_both, fee) VALUES ($1, $2, 2, 1, 1, 1, $3)`,
      [l.id, inDays(10), fee]
    );
  }
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get(`/api/properties/${lodge.id}/auto-pricing`).expect(200);
  assert.equal(body.conversion.stay, 3, 'the median of our stays: 2, 3 and 3 nights');
  assert.equal(body.conversion.competitors_cleaning, 900, 'average of R0, R1,200, R1,200 and R1,200');
  assert.equal(body.conversion.competitors_measured, 4);
  // Each quotes R6,000 for two nights. For three: R9,000 with no cleaning,
  // (6000 − 1200) / 2 × 3 + 1200 = R8,400 with R1,200 cleaning.
  const night = body.nights.find((n) => n.date === inDays(19));
  assert.equal(night.market, 8400, 'the median three-night stay at the competitors');
  assert.equal(night.market_rate, 2140, 'the rate that makes ours cost the same: (8400 − 660) / 3 / 1.205');
  assert.equal(night.ours_total, Math.round((2000 * 1.205 * 3 + 660) / 10) * 10, 'and what ours costs at today\'s rate');

  const page = await agent.get('/api/peers').expect(200);
  const p = page.body.properties[0];
  assert.deepEqual(p.cleaning, { average: 900, measured: 4, without: 1 });
  assert.equal(p.listings.find((l) => l.name === 'Peer 1').cleaning_fee, 0);
  assert.equal(p.listings.find((l) => l.name === 'Peer 2').cleaning_fee, 1200);
});

test('cleaning fees are measured once a week from three quotes and kept', async () => {
  await setup();
  const { measureCleaningFees } = require('../../src/services/peer-cleaning');
  const asked = [];
  // Every listing: R2,500 a night plus a R700 cleaning fee per stay.
  const fetchQuote = async (id, checkIn, checkOut) => {
    asked.push([id, checkIn, checkOut]);
    const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
    return { nightly: 2500 + 700 / nights, total: 2500 * nights + 700 };
  };
  const r = await measureCleaningFees({ fetchQuote, today, pauseMs: 0 });
  assert.equal(r.due, 5);
  assert.equal(r.measured, 3, 'Peer 1 is full every night and ours has no calendar here');
  assert.deepEqual(r.results.filter((x) => x.fee == null).map((x) => x.note), ['no open stretch to quote', 'no open stretch to quote']);
  assert.equal(asked.length, 9, 'three quotes each');
  const rows = await pool.query('SELECT fee, nights, total_first, total_second, total_both FROM peer_cleaning_fees');
  assert.ok(rows.rows.every((x) => Number(x.fee) === 700 && x.nights === 2 && Number(x.total_both) === 10700));
  const again = await measureCleaningFees({ fetchQuote, today, pauseMs: 0 });
  assert.equal(again.measured, 0, 'not again within the week');
  assert.equal(again.due, 2, 'only the two still without a fee are tried again');
});
