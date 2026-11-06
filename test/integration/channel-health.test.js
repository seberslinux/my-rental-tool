const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const { pool } = require('../../src/db/database');
const { runHealthCheck } = require('../../src/services/health-check');
const { addDays } = require('../../src/services/dashboard-calc');
const { todayISO } = require('../helpers/dates');

/**
 * The daily check, end to end.
 *
 * The judgement itself is pinned in test/health-check.test.js. What is
 * here is the wiring that decides whether anybody ever sees it: that
 * the answer is stored, that the card reads the stored answer rather
 * than calling Smoobu, that red reaches a phone and amber does not, and
 * that a listing nobody has checked is not drawn as healthy.
 */

test.before(() => getApp());
test.beforeEach(async () => {
  await resetDb();
  mockSmoobu.reset();
});
test.after(() => closePool());

/** Rates from today for `n` nights at `price`, as Smoobu would answer. */
function priced(n, price) {
  const out = {};
  const today = todayISO();
  for (let i = 0; i <= n; i++) out[addDays(today, i)] = { price };
  return out;
}

async function setup({ floor = 1500, rates = priced(365, 3000) } = {}) {
  const user = await seedUser({ role: 'property_manager' });
  const property = await seedProperty({ owner: user, name: 'Hill Top Lodge' });
  await pool.query('UPDATE properties SET price_floor = $1 WHERE id = $2', [floor, property.id]);
  mockSmoobu.setDailyRates({ [property.smoobu_id]: rates });
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, user, property };
}

const alerts = () => pool.query(
  "SELECT * FROM notifications WHERE event = 'channel_health_red' ORDER BY id"
).then((r) => r.rows);

// --- the answer is written down ------------------------------------------

test('a run stores one row per property and the card reads it', async () => {
  const { agent, property } = await setup();
  await runHealthCheck({ announce: false });

  const { rows } = await pool.query('SELECT * FROM channel_health');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].property_id, property.id);

  const res = await agent.get('/api/health/channels').expect(200);
  assert.equal(res.body.status, 'green');
  assert.equal(res.body.results[0].property, 'Hill Top Lodge');
});

test('a second run replaces the first rather than piling up', async () => {
  // One row per property, overwritten. A log of every morning for two
  // flats is a table nobody reads growing forever.
  await setup();
  await runHealthCheck({ announce: false });
  await runHealthCheck({ announce: false });
  const { rows } = await pool.query('SELECT * FROM channel_health');
  assert.equal(rows.length, 1);
});

test('reading the card calls Smoobu not at all', async () => {
  const { agent } = await setup();
  await runHealthCheck({ announce: false });

  // Any getRates from here on throws. A card that recomputed on read
  // would be blank on every bad Smoobu day.
  mockSmoobu.makeFail(new Error('should not be called'), 'getRates');
  const res = await agent.get('/api/health/channels').expect(200);
  assert.equal(res.body.status, 'green');
});

test('a listing nobody has checked is absent, not green', async () => {
  const { agent } = await setup();
  const res = await agent.get('/api/health/channels').expect(200);
  assert.deepEqual(res.body.results, []);
  assert.equal(res.body.ran_at, null);
});

// --- who hears about it --------------------------------------------------

test('a red listing reaches a phone', async () => {
  // Thirty days of horizon — the loft's actual failure.
  await setup({ rates: priced(30, 3000) });
  const { status } = await runHealthCheck();
  assert.equal(status, 'red');

  const sent = await alerts();
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /only on sale for 30 more days/);
});

test('amber stays on the dashboard and does not interrupt', async () => {
  // Worth looking at this morning. Not worth a phone buzzing, because
  // a daily amber is how the channel gets muted before the red arrives.
  await setup({ rates: priced(330, 3000) });
  const { status } = await runHealthCheck();
  assert.equal(status, 'amber');
  assert.equal((await alerts()).length, 0);
});

test('a healthy morning tells nobody anything', async () => {
  await setup();
  await runHealthCheck();
  assert.equal((await alerts()).length, 0);
});

test('pressing Check now does not send alerts', async () => {
  // Somebody watching the screen does not need to be told by phone
  // what is in front of them.
  const { agent } = await setup({ rates: priced(30, 3000) });
  const res = await agent.post('/api/health/channels/run').expect(200);
  assert.equal(res.body.status, 'red');
  assert.equal((await alerts()).length, 0);
});

// --- failure is not health ----------------------------------------------

test('a Smoobu failure is recorded as red against that property', async () => {
  await setup();
  mockSmoobu.makeFail(new Error('401 Unauthorized'), 'getRates');

  const { status } = await runHealthCheck({ announce: false });
  assert.equal(status, 'red');

  const { rows } = await pool.query('SELECT * FROM channel_health');
  assert.equal(rows[0].status, 'red');
  const report = typeof rows[0].report === 'string' ? JSON.parse(rows[0].report) : rows[0].report;
  assert.match(report.findings[0].detail, /401 Unauthorized/);
});

test('one property failing does not cost the other its check', async () => {
  const user = await seedUser({ role: 'admin' });
  const good = await seedProperty({ owner: user, name: 'Hill Top Lodge', smoobu_id: 2500823 });
  const bad = await seedProperty({ owner: user, name: 'The loft', smoobu_id: 2297844 });
  await pool.query('UPDATE properties SET price_floor = 1500');
  mockSmoobu.setDailyRates({ [good.smoobu_id]: priced(365, 3000) });

  // The loft has no fixture, so it answers {} — no price for tonight,
  // which is its own red rather than a silence.
  await runHealthCheck({ announce: false });

  const { rows } = await pool.query('SELECT property_id, status FROM channel_health ORDER BY property_id');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.property_id === good.id).status, 'green');
  assert.equal(rows.find((r) => r.property_id === bad.id).status, 'red');
});

// --- who may look --------------------------------------------------------

test('signed out, the card says nothing', async () => {
  const app = await getApp();
  await request(app).get('/api/health/channels').expect(401);
  await request(app).post('/api/health/channels/run').expect(401);
});

test('a manager sees only the listings they have', async () => {
  const { agent } = await setup();
  const other = await seedUser({ role: 'admin' });
  const hidden = await seedProperty({ owner: other, name: 'Somebody else' });
  mockSmoobu.setDailyRates({ [hidden.smoobu_id]: priced(365, 3000) });

  await runHealthCheck({ announce: false });

  const res = await agent.get('/api/health/channels').expect(200);
  assert.equal(res.body.results.length, 1);
  assert.equal(res.body.results[0].property, 'Hill Top Lodge');
});
