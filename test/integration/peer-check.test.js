const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { todayISO, inDays } = require('../helpers/dates');
const { runPeerCheck } = require('../../src/services/peer-check');

/**
 * The competitor check end to end, with Airbnb replaced by a stub.
 *
 * Nothing in this file reaches Airbnb: every run is given its own
 * `fetchCalendar`, and the one that is not would fail the setup step
 * long before it sent anything.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const today = todayISO();
const night = (i) => (i === 0 ? today : inDays(i));
const year = (taken = () => false) =>
  Array.from({ length: 120 }, (_, i) => ({ date: night(i), available: !taken(i), minNights: 2 }));

async function setup() {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  const insert = (airbnbId, name, extra = {}) => pool.query(
    `INSERT INTO peer_listings (airbnb_id, name, bedrooms, property_id, is_own, is_benchmark)
     VALUES ($1, $2, 2, $3, $4, $5) RETURNING *`,
    [airbnbId, name, lodge.id, Boolean(extra.own), Boolean(extra.benchmark)]
  ).then((r) => r.rows[0]);
  const own = await insert('111', 'Our lodge', { own: true });
  const tal = await insert('222', "Tal's house", { benchmark: true });
  const other = await insert('333', 'Seaforest');
  return { admin, lodge, own, tal, other };
}

const stub = (calendars) => async (id) => {
  if (!calendars[id]) throw new Error(`no calendar for ${id}`);
  return calendars[id];
};

test('the first run records the calendars and reports nothing', async () => {
  await setup();
  const r = await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  assert.equal(r.ok, 3);
  assert.equal(r.found.length, 0);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM peer_calendar');
  assert.equal(rows[0].n, 360);
  const notes = await pool.query("SELECT 1 FROM notifications WHERE event = 'peer_booked'");
  assert.equal(notes.rows.length, 0);
});

test('a competitor selling a weekend is recorded and announced once', async () => {
  await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  await runPeerCheck({
    fetchCalendar: stub({
      111: year((i) => i === 3),                // our own sale: not announced
      222: year((i) => i === 9 || i === 10),     // Tal sells two nights
      333: year((i) => i >= 30 && i < 70),       // a host block
    }),
    pauseMs: 0,
  });

  const stays = await pool.query(
    `SELECT l.name, s.kind, s.nights, to_char(s.check_in, 'YYYY-MM-DD') AS check_in
       FROM peer_stays s JOIN peer_listings l ON l.id = s.listing_id ORDER BY l.name`
  );
  const tal = stays.rows.find((s) => s.name === "Tal's house");
  assert.equal(tal.kind, 'booking');
  assert.equal(tal.nights, 2);
  assert.equal(tal.check_in, inDays(9));
  assert.equal(stays.rows.find((s) => s.name === 'Seaforest').kind, 'block');

  const notes = await pool.query("SELECT title, body, link FROM notifications WHERE event = 'peer_booked'");
  assert.equal(notes.rows.length, 1);
  assert.match(notes.rows[0].title, /Tal's house just got booked/);
  assert.equal(notes.rows[0].link, '/peers');
});

test('a sale whose nights open again is marked as cancelled, not deleted', async () => {
  await setup();
  const base = { 111: year(), 333: year() };
  await runPeerCheck({ fetchCalendar: stub({ ...base, 222: year() }), pauseMs: 0 });
  await runPeerCheck({ fetchCalendar: stub({ ...base, 222: year((i) => i === 9 || i === 10) }), pauseMs: 0 });
  await runPeerCheck({ fetchCalendar: stub({ ...base, 222: year() }), pauseMs: 0 });

  const { rows } = await pool.query('SELECT reversed_at FROM peer_stays');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].reversed_at);
});

test('one listing failing does not stop the rest', async () => {
  await setup();
  const r = await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year() }), pauseMs: 0 });
  assert.equal(r.ok, 2);
  assert.equal(r.failed, 1);
  const run = await pool.query('SELECT error FROM peer_runs ORDER BY id DESC LIMIT 1');
  assert.match(run.rows[0].error, /Seaforest/);
  const alarm = await pool.query("SELECT 1 FROM notifications WHERE event = 'peer_check_failed'");
  assert.equal(alarm.rows.length, 0);
});

test('when nothing can be read it says so, once a day', async () => {
  await setup();
  const broken = async () => { throw new Error('Airbnb calendar: PersistedQueryNotFound'); };
  await runPeerCheck({ fetchCalendar: broken, pauseMs: 0 });
  await runPeerCheck({ fetchCalendar: broken, pauseMs: 0 });
  const { rows } = await pool.query("SELECT body FROM notifications WHERE event = 'peer_check_failed'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /PersistedQueryNotFound/);
});

test('the comparison puts us, the benchmark and the peer median side by side', async () => {
  const { admin } = await setup();
  await runPeerCheck({
    fetchCalendar: stub({ 111: year((i) => i < 10), 222: year((i) => i < 60), 333: year((i) => i < 5) }),
    pauseMs: 0,
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const res = await agent.get('/api/peers').expect(200);
  const p = res.body.properties[0];
  assert.equal(p.name, 'Hill Top Lodge');
  assert.equal(p.months.length, 6);
  assert.equal(p.own.name, 'Our lodge');
  assert.equal(p.benchmark.name, "Tal's house");
  assert.ok(p.benchmark.months[0] > p.own.months[0], 'Tal has sold more of this month than we have');
  assert.equal(p.listings.length, 3);
  assert.equal(p.listings.find((l) => l.name === 'Seaforest').open_30, 25);
  assert.ok(res.body.last_run);
});

test('a manager sees only the competitors of their own properties', async () => {
  await setup();
  const manager = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, manager);
  const res = await agent.get('/api/peers').expect(200);
  assert.deepEqual(res.body.properties, []);
});

test('only an admin can start a run by hand', async () => {
  await setup();
  const manager = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, manager);
  await agent.post('/api/peers/run').expect(403);
});

test('the agreed competitor set attaches itself to the properties by name', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  const loft = await seedProperty({ owner: admin, name: 'The loft' });
  const { runMigrations } = require('../../src/db/migrations');
  await runMigrations();

  const { rows } = await pool.query('SELECT airbnb_id, property_id, is_own, is_benchmark FROM peer_listings');
  const tal = rows.find((r) => r.airbnb_id === '1273593055077595534');
  assert.equal(tal.property_id, lodge.id);
  assert.equal(tal.is_benchmark, true);
  assert.equal(rows.find((r) => r.airbnb_id === '46742610').property_id, loft.id);
  assert.equal(rows.filter((r) => r.is_own).length, 2);
});

// --- prices -----------------------------------------------------------------

const { runPeerPrices } = require('../../src/services/peer-check');

const quoteAt = (rates) => async (id) => (rates[id] ? { nightly: rates[id], total: rates[id] * 2 } : null);

test('the daily price run quotes every open planned stay and only those', async () => {
  await setup();
  await runPeerCheck({
    fetchCalendar: stub({ 111: year(), 222: year((i) => i > 0 && i < 70), 333: year() }),
    pauseMs: 0,
  });
  const r = await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 222: 4200, 333: 2500 }), pauseMs: 0 });

  const { rows } = await pool.query(
    `SELECT l.name, COUNT(*)::int AS n FROM peer_prices p JOIN peer_listings l ON l.id = p.listing_id GROUP BY l.name`
  );
  const n = Object.fromEntries(rows.map((x) => [x.name, x.n]));
  assert.equal(n['Our lodge'], 16);
  assert.equal(n.Seaforest, 16);
  assert.equal(n["Tal's house"], undefined, 'nothing to quote while Tal is full');
  assert.equal(r.quoted, 32);
});

test('a sale carries the price it was last on sale for', async () => {
  await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 222: 4200 }), pauseMs: 0 });

  const { rows: [fri] } = await pool.query(
    `SELECT (check_in - CURRENT_DATE)::int AS i FROM peer_prices p JOIN peer_listings l ON l.id = p.listing_id
      WHERE l.airbnb_id = '222' AND kind = 'weekend' ORDER BY check_in LIMIT 1`
  );
  await runPeerCheck({
    fetchCalendar: stub({ 111: year(), 222: year((i) => i === fri.i || i === fri.i + 1), 333: year() }),
    pauseMs: 0,
  });

  const stay = await pool.query('SELECT nightly FROM peer_stays');
  assert.equal(stay.rows[0].nightly, 4200);
  const note = await pool.query("SELECT body FROM notifications WHERE event = 'peer_booked'");
  assert.match(note.rows[0].body, /about R4 200 a night/);
});

test('the comparison shows asking prices, and a sold stay as sold', async () => {
  const { admin } = await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 222: 4200, 333: 2500 }), pauseMs: 0 });

  // Tal sells the first planned weekend after it was priced.
  const { rows: [fri] } = await pool.query(
    `SELECT (check_in - CURRENT_DATE)::int AS i FROM peer_prices WHERE kind = 'weekend' ORDER BY check_in LIMIT 1`
  );
  await runPeerCheck({
    fetchCalendar: stub({ 111: year(), 222: year((i) => i === fri.i || i === fri.i + 1), 333: year() }),
    pauseMs: 0,
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers').expect(200);
  const p = body.properties[0];
  assert.equal(p.prices.weekends.length, 8);
  assert.deepEqual(p.own.weekend[0], { nightly: 2700, open: true });
  assert.equal(p.benchmark.weekend[0].open, false, 'sold since it was priced');
  assert.equal(p.benchmark.weekend[1].nightly, 4200);
  // Median of the competitors still on sale: Seaforest alone on the
  // first weekend, Seaforest and Tal after.
  assert.equal(p.prices.weekend_median[0], 2500);
  assert.equal(p.prices.weekend_median[1], 3350);
});

test('only an admin can start a price read by hand', async () => {
  await setup();
  const manager = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, manager);
  await agent.post('/api/peers/prices').expect(403);
});

test('a date never quoted because it was already taken shows as sold, not blank', async () => {
  const { admin } = await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year((i) => i > 0 && i < 70), 333: year() }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 333: 2500 }), pauseMs: 0 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers').expect(200);
  assert.deepEqual(body.properties[0].benchmark.weekend[0], { nightly: null, open: false });
});

// --- summary ----------------------------------------------------------------

test('the summary gives occupancy for us, the median and the benchmark over 30 and 90 days', async () => {
  const { admin } = await setup();
  // Of the next 30 nights: we have 6 taken, Tal 27, Seaforest 12.
  await runPeerCheck({
    fetchCalendar: stub({ 111: year((i) => i < 6), 222: year((i) => i < 27), 333: year((i) => i < 12) }),
    pauseMs: 0,
  });
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers/summary').expect(200);

  const p = body.properties[0];
  assert.equal(p.name, 'Hill Top Lodge');
  assert.equal(p.benchmark_name, "Tal's house");
  const d30 = p.windows.find((w) => w.days === 30);
  assert.equal(d30.own, 20);
  assert.equal(d30.benchmark, 90);
  assert.equal(d30.median, 65, 'median of Tal (90) and Seaforest (40)');
  const d90 = p.windows.find((w) => w.days === 90);
  assert.equal(d90.own, 7);
  assert.ok(body.read_at);

  // The Competitors page carries the same summary.
  const full = await agent.get('/api/peers').expect(200);
  assert.deepEqual(full.body.summary, body.properties);
});

test('the summary is empty before anything has been read', async () => {
  const { admin } = await setup();
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers/summary').expect(200);
  assert.deepEqual(body.properties, []);
  assert.equal(body.read_at, null);
});

test("a manager's summary covers only their own properties", async () => {
  await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  const manager = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, manager);
  const { body } = await agent.get('/api/peers/summary').expect(200);
  assert.deepEqual(body.properties, []);
});
