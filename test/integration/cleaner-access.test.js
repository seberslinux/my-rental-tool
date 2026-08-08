const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { getAgent, resetDb, closePool } = require('../helpers/harness');
const {
  seedUser, seedProperty, seedBooking, seedCleaner, linkCleanerToProperty, loginAs,
} = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * What a cleaner session may reach.
 *
 * requireAuth admits cleaner PIN sessions, and everything under /api sat
 * behind requireAuth alone. A session opened with a 4-digit PIN could
 * therefore read the owner's business: revenue KPIs, the full analytics
 * breakdown, guest names and what they paid, and the other cleaners' pay
 * rates. All returned 200.
 *
 * Property scoping was not a defence. It narrowed those answers to the
 * cleaner's own properties, which is exactly the revenue they should
 * never see.
 *
 * These tests exist because the next manager route added will be closed
 * to cleaners only if the rule is enforced in one place and asserted
 * here.
 */

async function cleanerSession(phone = '+27821234567', pin = '1234') {
  const cleaner = await seedCleaner({ phone });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [
    bcrypt.hashSync(pin, 4), cleaner.id,
  ]);
  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone, pin }).expect(200);
  return { cleaner, agent };
}

test.before(async () => { await resetDb(); });
test.after(async () => { await closePool(); });

// --- the owner's business is not the cleaner's --------------------------

test('a cleaner cannot read revenue, bookings, analytics or other cleaners', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({
    property, check_in: '2026-08-01', check_out: '2026-08-05',
    total_price: 25000, guest_name: 'Private Guest',
  });

  const { cleaner, agent } = await cleanerSession();
  // Linked to the property — scoping would have let this through.
  await linkCleanerToProperty(cleaner, property);

  const closed = [
    '/api/dashboard/kpis',
    '/api/dashboard/stats',
    '/api/bookings',
    '/api/analytics/data',
    '/api/cleaners',
    '/api/properties',
    '/api/finances/summary',
    '/api/users',
  ];

  for (const path of closed) {
    const res = await agent.get(path);
    assert.equal(res.status, 403, `${path} must be closed to a cleaner`);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('25000'), `${path} leaked revenue`);
    assert.ok(!body.includes('Private Guest'), `${path} leaked a guest name`);
  }
});

test('writes are refused too, not just reads', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { agent } = await cleanerSession();

  const res = await agent.put(`/api/properties/${property.id}`).send({ name: 'Renamed' });
  assert.equal(res.status, 403);

  const still = await getAgent();
  await loginAs(still, owner);
  const check = await still.get('/api/properties').expect(200);
  assert.notEqual(check.body[0].name, 'Renamed', 'nothing was written');
});

// --- but the portal itself must still work ------------------------------

test('the cleaner portal is still reachable', async () => {
  // A gate that locks the cleaner out of their own jobs would be no
  // better than the hole it replaces.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await cleanerSession();
  await linkCleanerToProperty(cleaner, property);

  const me = await agent.get('/api/cleaner-portal/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.id, cleaner.id);

  const jobs = await agent.get('/api/cleaner-portal/jobs');
  assert.equal(jobs.status, 200);
});

test('signing out still works from a cleaner session', async () => {
  await resetDb();
  const { agent } = await cleanerSession();
  const res = await agent.post('/api/auth/logout');
  assert.ok(res.status < 400, `logout should not be blocked, got ${res.status}`);
});

// --- the manager keeps full access --------------------------------------

test('the gate does not touch a manager session', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({
    property, check_in: '2026-08-01', check_out: '2026-08-05', total_price: 25000,
  });

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.get('/api/dashboard/kpis').expect(200);
  await agent.get('/api/bookings').expect(200);
  await agent.get('/api/cleaners').expect(200);
});

test('a path merely starting with the allowed prefix is not enough', async () => {
  // "/cleaner-portalx" must not pass as "/cleaner-portal".
  await resetDb();
  const { agent } = await cleanerSession();
  const res = await agent.get('/api/cleaner-portalx/secrets');
  assert.equal(res.status, 403);
});

// --- checklists belong to the manager -----------------------------------

test('a cleaner cannot create or edit inventory checklists', async () => {
  // The cleaner performs the check; the manager decides what is on the
  // list. /api/inventory is a manager route and stays closed, so this is
  // enforced by the same allow-list as everything else rather than by a
  // rule somebody has to remember when adding the next endpoint.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await cleanerSession();
  await linkCleanerToProperty(cleaner, property);

  const create = await agent.post('/api/inventory')
    .send({ property_id: property.id, item_name: 'Snuck in', expected_quantity: 1 });
  assert.equal(create.status, 403);

  const list = await agent.get('/api/inventory');
  assert.equal(list.status, 403);

  // But reading the list for a job, and recording a check, still work —
  // that is the cleaner's actual job.
  const read = await agent.get(`/api/cleaner-portal/inventory/${property.id}`);
  assert.equal(read.status, 200);
});

// --- one session, one identity ------------------------------------------

/**
 * The person who is both a manager and a cleaner.
 *
 * The restriction above used to read `cleanerId && !req.user`, so holding
 * both logins at once switched it off entirely. Signing in on the phone
 * tab while already signed into the main app produced a session that was
 * both: /api/auth/me answered with the manager, the browser drew the
 * manager's app, and revenue came back 200 to somebody who had just typed
 * a 4-digit PIN.
 *
 * The rule is that a session carries one identity. Each sign-in ends the
 * other, in both directions, and getting into the main app means going
 * back to the login screen.
 */

test('signing in as a cleaner ends a manager session', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821110001' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [
    bcrypt.hashSync('1234', 4), cleaner.id,
  ]);
  await linkCleanerToProperty(cleaner, property);

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.get('/api/dashboard/kpis').expect(200);

  await agent.post('/api/auth/cleaner-login')
    .send({ phone: '+27821110001', pin: '1234' }).expect(200);

  const me = await agent.get('/api/auth/me').expect(200);
  assert.equal(me.body.role, 'cleaner',
    'the browser decides which app to draw from this — it must not say admin');

  for (const path of ['/api/dashboard/kpis', '/api/analytics/data', '/api/bookings', '/api/cleaners']) {
    await agent.get(path).expect(403);
  }
  // And the cleaner can still do their own job.
  await agent.get('/api/cleaner-portal/me').expect(200);
});

test('signing into the main app ends a cleaner session', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821110002' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [
    bcrypt.hashSync('1234', 4), cleaner.id,
  ]);

  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login')
    .send({ phone: '+27821110002', pin: '1234' }).expect(200);
  await agent.get('/api/dashboard/kpis').expect(403);

  // The login screen is the only way back in, and it is a clean swap.
  await loginAs(agent, owner);
  await agent.get('/api/dashboard/kpis').expect(200);
  // No cleaner identity left behind.
  await agent.get('/api/cleaner-portal/me').expect(403);
});

test('a Passport user whose role is cleaner is restricted too', async () => {
  // The client hands this role the cleaner's app, so the API has to
  // agree — otherwise the same data is one Google sign-in away.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  await seedProperty({ owner });
  const staff = await seedUser({ role: 'cleaner' });

  const agent = await getAgent();
  await loginAs(agent, staff);
  await agent.get('/api/dashboard/kpis').expect(403);
  await agent.get('/api/analytics/data').expect(403);
});
