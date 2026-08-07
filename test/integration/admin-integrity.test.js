const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, seedCleaner, linkCleanerToProperty, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const request = require('supertest');

/**
 * GET /api/admin/integrity — admin-only health check that surfaces DB
 * rule violations. Zero enforcement, all reporting.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// --- auth gate ------------------------------------------------------------

test('unauthenticated → 401', async () => {
  const app = await getApp();
  await request(app).get('/api/admin/integrity').expect(401);
});

test('non-admin (property_manager) → 403', async () => {
  const user = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, user);
  await agent.get('/api/admin/integrity').expect(403);
});

test('admin → 200', async () => {
  const admin = await seedUser({ role: 'admin' });
  const agent = await getAgent();
  await loginAs(agent, admin);
  await agent.get('/api/admin/integrity').expect(200);
});

// --- clean state ---------------------------------------------------------

test('clean DB → ok:true, all counts 0, all lists empty', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' });
  await seedBooking({ property, smoobu_id: 2, check_in: '2025-06-13', check_out: '2025-06-16' }); // back-to-back OK

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/admin/integrity').expect(200);

  assert.equal(body.ok, true);
  assert.deepEqual(body.counts, {
    overlapping_bookings: 0,
    invalid_dates: 0,
    cleaner_double_bookings: 0,
  });
  assert.deepEqual(body.overlapping_bookings, []);
  assert.deepEqual(body.invalid_dates, []);
  assert.deepEqual(body.cleaner_double_bookings, []);
});

// --- reports violations --------------------------------------------------

test('overlapping bookings are surfaced with both smoobu_ids', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 100, check_in: '2025-06-10', check_out: '2025-06-14' });
  await seedBooking({ property, smoobu_id: 101, check_in: '2025-06-12', check_out: '2025-06-16' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/admin/integrity').expect(200);

  assert.equal(body.ok, false);
  assert.equal(body.counts.overlapping_bookings, 1);
  const ids = body.overlapping_bookings[0].map((b) => b.smoobu_id).sort();
  assert.deepEqual(ids, [100, 101]);
});

test('invalid-date bookings are surfaced', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  // Zero-night booking currently allowed by the schema.
  await seedBooking({ property, smoobu_id: 200, check_in: '2025-06-15', check_out: '2025-06-15', length_of_stay: 1 });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/admin/integrity').expect(200);

  assert.equal(body.ok, false);
  assert.equal(body.counts.invalid_dates, 1);
  assert.equal(body.invalid_dates[0].smoobu_id, 200);
});

test('cleaner double-booking is surfaced', async () => {
  const admin = await seedUser({ role: 'admin' });
  const propA = await seedProperty({ owner: admin });
  const propB = await seedProperty({ owner: admin });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, propA);
  await linkCleanerToProperty(cleaner, propB);
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2025-06-13', '10:00', '12:30', 'pending'),
            ($3, $2, '2025-06-13', '13:00', '15:30', 'pending')`,
    [propA.id, cleaner.id, propB.id]
  );

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/admin/integrity').expect(200);

  assert.equal(body.ok, false);
  assert.equal(body.counts.cleaner_double_bookings, 1);
  assert.equal(body.cleaner_double_bookings[0].cleaner_id, cleaner.id);
  assert.equal(body.cleaner_double_bookings[0].jobs.length, 2);
});

test('response includes only the fields the API is documented to expose (no raw pg leak)', async () => {
  // Locks the response shape so a future change to the SELECT doesn't
  // accidentally add columns to the payload (e.g. guest_name in a
  // health-check response).
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 300, check_in: '2025-06-10', check_out: '2025-06-14', guest_name: 'Alice' });
  await seedBooking({ property, smoobu_id: 301, check_in: '2025-06-12', check_out: '2025-06-16', guest_name: 'Bob' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/admin/integrity').expect(200);

  const b = body.overlapping_bookings[0][0];
  assert.deepEqual(
    Object.keys(b).sort(),
    ['check_in', 'check_out', 'property_id', 'smoobu_id']
  );
  assert.ok(!('guest_name' in b), 'guest_name must not leak into the integrity payload');
});
