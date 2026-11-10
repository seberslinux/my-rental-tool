const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, todayISO } = require('../helpers/dates');

/**
 * The home page, end to end, as the review found it.
 *
 * The property picker was drawn and never sent; "still to sell" counted
 * thirty nights from bookings loaded three weeks out; and nothing on the
 * page could be put away, so a leak somebody had read sat at the top
 * every morning beside a finding they had decided to live with.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

async function setup() {
  const user = await seedUser({ role: 'property_manager' });
  const lodge = await seedProperty({ owner: user, name: 'Hill Top Lodge' });
  const loft = await seedProperty({ owner: user, name: 'The loft' });
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, user, lodge, loft };
}

const issue = (property, title) => pool.query(
  `INSERT INTO maintenance_issues (property_id, title, reported_date) VALUES ($1, $2, $3) RETURNING id`,
  [property.id, title, todayISO()]
).then((r) => r.rows[0].id);

// --- the property picker ---------------------------------------------------

test('choosing a property narrows the whole page to it', async () => {
  const { agent, lodge, loft } = await setup();
  await seedBooking({ property: loft, check_in: inDays(3), check_out: inDays(6) });

  const all = (await agent.get('/api/dashboard/today').expect(200)).body;
  const justLodge = (await agent.get(`/api/dashboard/today?property_id=${lodge.id}`).expect(200)).body;

  assert.equal(all.properties.length, 2);
  assert.equal(justLodge.properties.length, 1);
  assert.equal(justLodge.properties[0].name, 'Hill Top Lodge');
  assert.equal(justLodge.money.capacity_30, 30, 'one property, thirty nights');
  assert.equal(justLodge.money.open_nights_30, 30, "the loft's booking is not the lodge's");
});

test('a property outside your scope is not reachable by asking for it', async () => {
  const { agent } = await setup();
  const stranger = await seedUser({ role: 'property_manager' });
  const theirs = await seedProperty({ owner: stranger, name: 'Somebody else' });

  const res = await agent.get(`/api/dashboard/today?property_id=${theirs.id}`).expect(200);
  assert.deepEqual(res.body.needs, []);
  assert.equal(res.body.properties, undefined, 'nothing about it at all');
});

// --- still to sell --------------------------------------------------------

test('an arrival in the fourth week is counted', async () => {
  // Bookings were loaded three weeks out against a thirty-day window, so
  // this one simply did not exist as far as the money was concerned.
  const { agent, lodge } = await setup();
  await seedBooking({ property: lodge, check_in: inDays(25), check_out: inDays(28), total_price: 9000 });

  const { money } = (await agent.get(`/api/dashboard/today?property_id=${lodge.id}`).expect(200)).body;
  assert.equal(money.open_nights_30, 27, '30 less the 3 sold');
  assert.equal(money.booked_revenue_30, 9000);
});

// --- putting things away --------------------------------------------------

test('an issue put away is off the front page and still open', async () => {
  const { agent, lodge } = await setup();
  const id = await issue(lodge, 'Leak at kitchen sink');

  let { needs } = (await agent.get('/api/dashboard/today').expect(200)).body;
  assert.ok(needs.find((n) => n.key === `issue:${id}`));

  await agent.post('/api/dashboard/dismiss').send({ key: `issue:${id}` }).expect(200);
  ({ needs } = (await agent.get('/api/dashboard/today').expect(200)).body);
  assert.equal(needs.find((n) => n.key === `issue:${id}`), undefined);

  const { rows } = await pool.query('SELECT status FROM maintenance_issues WHERE id = $1', [id]);
  assert.equal(rows[0].status, 'open', 'put away is not fixed');
});

test('it can be brought back', async () => {
  const { agent, lodge } = await setup();
  const id = await issue(lodge, 'Leak at kitchen sink');
  await agent.post('/api/dashboard/dismiss').send({ key: `issue:${id}` }).expect(200);
  await agent.delete('/api/dashboard/dismiss').send({ key: `issue:${id}` }).expect(200);

  const { needs } = (await agent.get('/api/dashboard/today').expect(200)).body;
  assert.ok(needs.find((n) => n.key === `issue:${id}`));
});

test('a clean nobody is doing cannot be put away', async () => {
  const { agent, lodge } = await setup();
  await agent.post('/api/dashboard/dismiss')
    .send({ key: `unstaffed:${lodge.id}:${inDays(2)}` }).expect(400);
});

test("somebody else's issue cannot be put away", async () => {
  const { agent } = await setup();
  const stranger = await seedUser({ role: 'property_manager' });
  const theirs = await seedProperty({ owner: stranger, name: 'Somebody else' });
  const id = await issue(theirs, 'Their leak');

  await agent.post('/api/dashboard/dismiss').send({ key: `issue:${id}` }).expect(403);
  const { rows } = await pool.query('SELECT * FROM dismissed_needs');
  assert.equal(rows.length, 0);
});

test('signed out, nothing is put away', async () => {
  const app = await getApp();
  await request(app).post('/api/dashboard/dismiss').send({ key: 'issue:1' }).expect(401);
});

// --- the morning check ------------------------------------------------------

test("a red somebody has put away is not sent to their phone again", async () => {
  const { lodge } = await setup();
  // The finding the check will make: Airbnb set below what its fee needs.
  await pool.query(
    `UPDATE properties SET guest_markup_airbnb = 15, commission_airbnb = 18, price_floor = 1500,
                           airbnb_url = 'x' WHERE id = $1`,
    [lodge.id]
  );
  await pool.query(
    `INSERT INTO dismissed_needs (key, severity) VALUES ($1, 'red')`,
    [`health:${lodge.id}:markup_short_airbnb`]
  );
  const { runHealthCheck } = require('../../src/services/health-check');
  await runHealthCheck();

  const { rows } = await pool.query(
    "SELECT * FROM notifications WHERE event = 'channel_health_red' AND property_id = $1", [lodge.id]
  );
  const aboutAirbnb = rows.filter((r) => /Airbnb pays out under your base/.test(r.title + r.body));
  assert.equal(aboutAirbnb.length, 0);
});

test('the card is told which findings have been put away', async () => {
  const { agent, lodge } = await setup();
  await pool.query(
    `UPDATE properties SET guest_markup_airbnb = 15, commission_airbnb = 18, price_floor = 1500,
                           airbnb_url = 'x' WHERE id = $1`,
    [lodge.id]
  );
  const { runHealthCheck } = require('../../src/services/health-check');
  await runHealthCheck({ announce: false });
  await agent.post('/api/dashboard/dismiss')
    .send({ key: `health:${lodge.id}:markup_short_airbnb`, severity: 'red' }).expect(200);

  const res = await agent.get('/api/health/channels').expect(200);
  const finding = res.body.results.find((r) => r.property_id === lodge.id)
    .findings.find((f) => f.key === 'markup_short_airbnb');
  assert.equal(finding.dismissed, true);
});
