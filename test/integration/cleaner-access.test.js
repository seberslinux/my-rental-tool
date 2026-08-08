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
