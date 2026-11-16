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
    fetchCalendar: stub({ 111: year(), 222: year((i) => i > 0), 333: year() }),
    pauseMs: 0,
  });
  const r = await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 222: 4200, 333: 2500 }), pauseMs: 0 });

  const { rows } = await pool.query(
    `SELECT l.name, COUNT(*)::int AS n FROM peer_prices p JOIN peer_listings l ON l.id = p.listing_id GROUP BY l.name`
  );
  const n = Object.fromEntries(rows.map((x) => [x.name, x.n]));
  // Every open stay in the calendar's window: as many weekends as it holds, 8 weekdays.
  const { planQuotes } = require('../../src/services/peer-check');
  const open = planQuotes(new Map(year().map((d) => [d.date, { available: true, minNights: 2 }])), today).length;
  assert.equal(n['Our lodge'], open);
  assert.equal(n.Seaforest, open);
  assert.equal(n["Tal's house"], undefined, 'nothing to quote while Tal is full');
  assert.equal(r.quoted, open * 2);
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

test('the chart has one point per priced listing: occupancy against average asking price', async () => {
  const { admin } = await setup();
  await runPeerCheck({
    fetchCalendar: stub({ 111: year((i) => i < 6), 222: year((i) => i < 27), 333: year((i) => i < 12) }),
    pauseMs: 0,
  });
  // Tal is not priced at all, so has no price to be placed by.
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 333: 2500 }), pauseMs: 0 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers/summary').expect(200);
  const p = body.properties[0];
  const byName = Object.fromEntries(p.points.map((x) => [x.name, x]));
  assert.deepEqual(byName['Our lodge'], { name: 'Our lodge', occupancy: 20, price: 2700, is_own: true, is_benchmark: false, revenue: 0 });
  assert.equal(byName.Seaforest.price, 2500);
  assert.equal(byName["Tal's house"], undefined, 'no quote, no point');
  assert.equal(p.median_price, 2500, 'median of the competitors only');
});

test("prices are quoted in the property's currency for its party size", async () => {
  const { lodge } = await setup();
  await pool.query("UPDATE properties SET base_currency = 'EUR', peer_guests = 12 WHERE id = $1", [lodge.id]);
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  const asked = [];
  await runPeerPrices({
    fetchQuote: async (id, a, b, opts) => { asked.push(opts); return { nightly: 977, total: 6839 }; },
    pauseMs: 0,
  });
  assert.ok(asked.length > 0);
  assert.ok(asked.every((o) => o.currency === 'EUR' && o.adults === 12));
});

test('the comparison says which currency and party size its prices are for', async () => {
  const { admin, lodge } = await setup();
  await pool.query("UPDATE properties SET base_currency = 'EUR', peer_guests = 12 WHERE id = $1", [lodge.id]);
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers').expect(200);
  assert.equal(body.properties[0].currency, 'EUR');
  assert.equal(body.properties[0].guests, 12);
  assert.equal(body.summary[0].currency, 'EUR');
});

// --- the booking analysis ------------------------------------------------------

const { weeklyDigest } = require('../../src/services/peer-analysis');

async function withSales() {
  const ctx = await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 222: 4200, 333: 2500 }), pauseMs: 0 });
  await runPeerCheck({
    fetchCalendar: stub({ 111: year((i) => i === 3), 222: year((i) => i === 9 || i === 10), 333: year((i) => i >= 20 && i < 23) }),
    pauseMs: 0,
  });
  return ctx;
}

test('the analysis adds up what competitors sold, leaving our own sales out', async () => {
  const { admin } = await withSales();
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers/analysis').expect(200);
  const a = body.properties[0];
  assert.equal(a.total.bookings, 2, "Tal's and Seaforest's sales, not ours");
  assert.equal(a.total.nights, 5);
  assert.equal(a.weeks.length, 1);
  assert.equal(a.listings[0].name, 'Seaforest');
  assert.ok(a.months.length >= 1 && a.seasons.length >= 1);
  assert.ok(Array.isArray(a.suggestions));
});

test('a manager sees no analysis for properties that are not theirs', async () => {
  await withSales();
  const manager = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, manager);
  const { body } = await agent.get('/api/peers/analysis').expect(200);
  assert.deepEqual(body.properties, []);
});

test("Monday's summary covers last week's sales and stays quiet on a week with none", async () => {
  await withSales();
  const sent = [];
  // Run it as if it were Monday a week from now: the sales above fall in "last week".
  const nextMonday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return d.toISOString().slice(0, 10); })();
  await weeklyDigest({ today: nextMonday, notifyImpl: async (n) => sent.push(n) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, 'peer_weekly');
  assert.match(sent[0].title, /competitors sold 2 bookings, 5 nights last week/);
  const later = [];
  const inTwoWeeks = new Date(Date.parse(`${nextMonday}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  await weeklyDigest({ today: inTwoWeeks, notifyImpl: async (n) => later.push(n) });
  assert.equal(later.length, 0);
});

// --- the record: history that only grows ----------------------------------------

const { snapshotListings, featureAnalysis } = require('../../src/services/peer-features');

test("a listing's first reading is its baseline; later readings add only what changed", async () => {
  await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  const base = await pool.query('SELECT COUNT(*)::int AS n, bool_and(baseline) AS all_base FROM peer_calendar_changes');
  assert.equal(base.rows[0].n, 360);
  assert.equal(base.rows[0].all_base, true);

  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year((i) => i === 9 || i === 10), 333: year() }), pauseMs: 0 });
  const after = await pool.query('SELECT COUNT(*)::int AS n FROM peer_calendar_changes WHERE NOT baseline');
  assert.equal(after.rows[0].n, 2, 'the two nights Tal sold, nothing else');

  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  const back = await pool.query('SELECT COUNT(*)::int AS n FROM peer_calendar_changes WHERE NOT baseline AND available');
  assert.equal(back.rows[0].n, 2, 'and the two that opened again: the cancellation is in the record too');
});

test('every quote is kept, each with its currency and party size', async () => {
  await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700 }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2900 }), pauseMs: 0 });
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n, COUNT(DISTINCT nightly)::int AS prices, MIN(currency) AS cur, MIN(guests) AS guests FROM peer_price_history");
  const { planQuotes } = require('../../src/services/peer-check');
  const open = planQuotes(new Map(year().map((d) => [d.date, { available: true, minNights: 2 }])), today).length;
  assert.equal(rows[0].n, open * 2, 'two price reads, every open stay each, all kept');
  assert.equal(rows[0].prices, 2);
  assert.equal(rows[0].cur, 'ZAR');
  assert.equal(rows[0].guests, 2);
});

const listingPage = (amenities, extra = {}) => ({
  title: 'Home · 2 bedrooms · 2 beds · 1 bath', property_type: 'Entire home', rating: 4.8, reviews: 40, guests: 4,
  bedrooms: 2, beds: 2, baths: 1, superhost: true, guest_favorite: false, photos: 30,
  category_ratings: { value: 4.7 }, amenities: amenities.map((t) => ({ group: null, title: t })), ...extra,
});

test('listing snapshots are taken once a week each and kept', async () => {
  await setup();
  const pages = { 111: listingPage(['Pool']), 222: listingPage(['Hot tub', 'Pool']), 333: listingPage(['Wifi']) };
  const fetchListing = async (id) => pages[id];
  const first = await snapshotListings({ fetchListing, pauseMs: 0 });
  assert.equal(first.taken, 3);
  const again = await snapshotListings({ fetchListing, pauseMs: 0 });
  assert.equal(again.due, 0, 'nothing is due again within the week');
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM peer_listing_snapshots');
  assert.equal(rows[0].n, 3);
});

test('features are weighed against how the competitors sell, and the gap becomes a shortlist', async () => {
  const { lodge } = await setup();
  const insert = (airbnbId, name) => pool.query(
    'INSERT INTO peer_listings (airbnb_id, name, bedrooms, property_id) VALUES ($1, $2, 2, $3)', [airbnbId, name, lodge.id]);
  await insert('444', 'Sea Song');
  await insert('555', 'Kabelane');
  // The hot-tub listings sell more and ask more; we have no hot tub. Their
  // sales sit beyond the next five weeks, which stay open to be priced.
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year(), 444: year(), 555: year() }), pauseMs: 0 });
  await runPeerCheck({
    fetchCalendar: stub({ 111: year((i) => i < 10), 222: year((i) => i >= 40 && i < 100), 333: year((i) => i < 5), 444: year((i) => i >= 40 && i < 95), 555: year((i) => i < 8) }),
    pauseMs: 0,
  });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 222: 4200, 333: 2500, 444: 4000, 555: 2600 }), pauseMs: 0 });
  const pages = { 111: listingPage(['Pool']), 222: listingPage(['Hot tub']), 333: listingPage(['Pool']), 444: listingPage(['Hot tub', 'Pool']), 555: listingPage([]) };
  await snapshotListings({ fetchListing: async (id) => pages[id], pauseMs: 0 });

  const [a] = await featureAnalysis({});
  const tub = a.features.find((f) => f.name === 'Hot tub');
  assert.equal(tub.you, false);
  assert.equal(tub.with, 2);
  assert.ok(tub.price_premium > 0 && tub.occupancy_gap > 0);
  assert.equal(a.shortlist[0].name, 'Hot tub');
  const tal = a.leaders.find((l) => l.is_benchmark);
  assert.deepEqual(tal.has_and_you_lack, ['Hot tub']);
});

test('the record downloads as CSV, for an admin only', async () => {
  const { admin } = await setup();
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year(), 333: year() }), pauseMs: 0 });
  const agent = await getAgent();
  await loginAs(agent, admin);
  const res = await agent.get('/api/peers/export/calendar').expect(200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text.split('\n')[0], /airbnb_id,name,date,available/);
  assert.equal(res.text.trim().split('\n').length, 361);
  await agent.get('/api/peers/export/nonsense').expect(404);

  const manager = await seedUser({ role: 'property_manager' });
  const other = await getAgent();
  await loginAs(other, manager);
  await other.get('/api/peers/export/calendar').expect(403);
});

test('our own sales come from Smoobu, beside the competitors, week by week', async () => {
  const { admin, lodge } = await withSales();
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status,
                           num_guests, length_of_stay, price_per_night, currency, lead_time_days, created_at)
     VALUES (990001, $1, 'Sam Guest', $2, $3, 'Airbnb', 9000, 'confirmed', 2, 3, 3000, 'ZAR', 20, $4),
            (990002, $1, 'Owner block', $2, $3, 'Blocked channel', 0, 'confirmed', 2, 3, 0, 'ZAR', 0, $4)`,
    [lodge.id, inDays(20), inDays(23), today]
  );
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers/analysis').expect(200);
  const a = body.properties[0];
  assert.equal(a.you.bookings, 1, 'a block is not a sale');
  assert.equal(a.you.revenue, 9000);
  assert.equal(a.weeks[0].you.nights, 3);
  assert.ok(a.weeks[0].sales.some((s) => s.own && s.channel === 'Airbnb'));
  assert.ok(a.listings.some((l) => l.is_own && l.name === 'You'));
  assert.equal(a.total.bookings, 2, 'and the competitors are counted as before');
});

test('the booking export says where each price came from', async () => {
  const { admin } = await withSales();
  const agent = await getAgent();
  await loginAs(agent, admin);
  const res = await agent.get('/api/peers/export/bookings').expect(200);
  const [head, ...lines] = res.text.trim().split('\n');
  assert.match(head, /nightly_quoted,nightly_estimate,price_source/);
  const sources = lines.map((l) => l.split(',').at(head.split(',').indexOf('price_source')));
  assert.ok(sources.every((s) => ['quoted', 'estimated', 'never quoted', 'not a sale'].includes(s)), sources.join('|'));
});

test("each chart point carries the money booked for the next 30 nights, ours from Smoobu", async () => {
  const { admin, lodge } = await setup();
  // Tal's nights were already taken at the first read: never seen as a
  // sale, still money on the books.
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year((i) => i < 4), 333: year() }), pauseMs: 0 });
  await runPeerPrices({ fetchQuote: quoteAt({ 111: 2700, 222: 4200, 333: 2500 }), pauseMs: 0 });
  await runPeerCheck({ fetchCalendar: stub({ 111: year(), 222: year((i) => i < 4), 333: year((i) => i >= 20 && i < 23 || i === 40) }), pauseMs: 0 });
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status,
                           num_guests, length_of_stay, price_per_night, currency, lead_time_days, created_at)
     VALUES (990003, $1, 'Sam Guest', $2, $3, 'Booking.com', 7500, 'confirmed', 2, 3, 2500, 'ZAR', 20, $4),
            (990004, $1, 'Kim Guest', $5, $6, 'Airbnb', 9000, 'confirmed', 2, 3, 3000, 'ZAR', 20, $4)`,
    [lodge.id, inDays(5), inDays(8), today, inDays(28), inDays(31)]
  );
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/peers/summary').expect(200);
  const byName = Object.fromEntries(body.properties[0].points.map((x) => [x.name, x]));
  assert.equal(byName['Our lodge'].revenue, 7500 + 2 * 3000, 'what guests pay for the nights inside the window');
  assert.equal(byName["Tal's house"].revenue, 4 * 4200, 'booked before the watch, still counted');
  assert.equal(byName.Seaforest.revenue, 3 * 2500, 'night 40 is outside the window');
  assert.equal(body.properties[0].revenue_days, 30);
});
