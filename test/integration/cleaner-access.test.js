const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { getAgent, resetDb, closePool } = require('../helpers/harness');
const {
  seedUser, seedProperty, seedBooking, seedCleaner, linkCleanerToProperty, loginAs,
} = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { assignCleanerForCheckout, reconcileCleaningJobs } = require('../../src/services/cleaner-assignment');

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

// --- the manager's cleaning calendar -------------------------------------

/**
 * What the manager's calendar can see.
 *
 * It previously drew one marker from pending jobs keyed by day-of-month —
 * a job on the 19th of August marked the 19th of every month — and knew
 * nothing about availability at all, so a cleaner setting their days
 * changed nothing anybody could see.
 */

test('the cleaning calendar reports who is free, per date', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  // Tuesdays only.
  await pool.query(
    `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
     VALUES ($1, 2, '09:00', '17:00')`, [cleaner.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-10&to=2026-08-12').expect(200);

  assert.deepEqual(res.body.days['2026-08-10'].available, [], 'Monday is not theirs');
  assert.equal(res.body.days['2026-08-11'].available.length, 1, 'Tuesday is');
  assert.deepEqual(res.body.days['2026-08-12'].available, [], 'Wednesday is not');
});

test('a checkout with nobody attached is reported as unmet', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({ property, smoobu_id: 5150, check_in: '2026-08-08', check_out: '2026-08-11' });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-11&to=2026-08-11').expect(200);

  const day = res.body.days['2026-08-11'];
  assert.equal(day.checkouts.length, 1);
  assert.equal(day.unmet.length, 1, 'every checkout needs a cleaner or its nights get blocked');
});

test('a blocked night is not a checkout and needs nobody', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({
    property, smoobu_id: 5151, check_in: '2026-08-10', check_out: '2026-08-11',
    platform: 'Blocked channel auto',
  });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-11&to=2026-08-11').expect(200);
  assert.equal(res.body.days['2026-08-11'].unmet.length, 0, 'nobody slept there');
});

test('a cleaner who has since gone unavailable shows as a clash, not as covered', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2026-08-11', '10:00', '13:00', 'confirmed')`,
    [property.id, cleaner.id]
  );
  await pool.query(
    `INSERT INTO cleaner_availability_overrides (cleaner_id, date, available)
     VALUES ($1, '2026-08-11', 0)`, [cleaner.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-11&to=2026-08-11').expect(200);

  const job = res.body.days['2026-08-11'].jobs[0];
  assert.equal(job.cleaner_available, false,
    'assigned is not the same as still willing, and nothing else says so');
});

test('a cleaner session cannot read the cleaning calendar', async () => {
  // It names every cleaner and where they work.
  const { agent } = await cleanerSession('+27821119999');
  await agent.get('/api/cleaners/calendar?from=2026-08-11&to=2026-08-11').expect(403);
});

// --- sending somebody on a day, booking or no booking --------------------

/**
 * A cleaning job used to mean one thing.
 *
 * Only assignment created them, and assignment runs off a checkout, so
 * there was no way to send somebody in to prepare for an arrival or for a
 * deep clean in a quiet week — the work hung off a booking, and without
 * one there was nothing to hang it on. It belongs to the property.
 */

const { recentForCleaner, recent, notify } = require('../../src/services/notify');
const { inDays, daysAgo, weekdayOf } = require('../helpers/dates');
/**
 * A day that is still ahead, whenever this runs.
 *
 * These tests used to post 2026-08-10, which was today when they were
 * written. The assign route refuses a date in the past — "That day has
 * already passed" — so at midnight four of them started failing with a
 * 400 and nothing about the code had changed. A test that only passes on
 * the day it was written is a test with an expiry date on it.
 */
const soon = (days = 1) =>
new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);



test('a cleaner can be sent on a day with no booking at all', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id,
    cleaning_date: inDays(3), reason: 'other', note: 'Deep clean',
  }).expect(201);

  assert.equal(res.body.booking_id, null, 'attached to the property, not a stay');
  assert.equal(res.body.reason, 'other');
  assert.equal(res.body.note, 'Deep clean');
});

test('a preparation is timed to finish before the guests arrive', async () => {
  // The end is what is fixed, not the start. Working that out in the
  // browser as well is how the two would drift.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await pool.query(
    `UPDATE properties SET check_in_time = '15:00', cleaning_hours_required = 2.5 WHERE id = $1`,
    [property.id]
  );
  const cleaner = await seedCleaner();

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id,
    cleaning_date: inDays(3), reason: 'checkin',
  }).expect(201);

  assert.equal(res.body.start_time, '12:30');
  assert.equal(res.body.end_time, '15:00');
});

test('a turnover starts when the guests leave', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await pool.query(
    `UPDATE properties SET check_out_time = '11:00', cleaning_hours_required = 2 WHERE id = $1`,
    [property.id]
  );
  const cleaner = await seedCleaner();

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id,
    cleaning_date: inDays(3), reason: 'checkout',
  }).expect(201);

  assert.equal(res.body.start_time, '11:00');
  assert.equal(res.body.end_time, '13:00');
});

test('a property with no times set falls back rather than to midnight', async () => {
  // Number('') is 0, so an unset column would read as 00:00.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await pool.query(`UPDATE properties SET check_out_time = '' WHERE id = $1`, [property.id]);
  const cleaner = await seedCleaner();

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id,
    cleaning_date: inDays(3), reason: 'checkout',
  }).expect(201);

  assert.equal(res.body.start_time, '10:00', 'not 00:00');
});

test('somebody who is not free can still be asked, and is asked rather than told', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  await linkCleanerToProperty(cleaner, property);
  // No weekly schedule at all, so no day is theirs.

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id, cleaning_date: inDays(3),
  }).expect(201);

  const feed = await recentForCleaner(cleaner.id);
  assert.match(feed[0].title, /Can you cover/, 'asked, not told');
  assert.match(feed[0].body, /decline it if you cannot/);
});

test('somebody who is free is told, not asked', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234568' });
  await linkCleanerToProperty(cleaner, property);
  // Free on the day we are about to ask about. That is the fact this
  // test rests on; a hard-coded Saturday was that fact with a date
  // attached, and once the date passed any replacement would have made
  // the test pass while checking nothing.
  const when = inDays(3);
  await pool.query(
    `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
     VALUES ($1, $2, '08:00', '18:00')`,
    [cleaner.id, weekdayOf(when)]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id, cleaning_date: when,
  }).expect(201);

  const feed = await recentForCleaner(cleaner.id);
  // Told, not asked — and said the way somebody would say it, rather than
  // "You are going to X on 2026-08-22", which is a sentence assembled
  // from columns.
  assert.match(feed[0].title, /^Clean /);
  assert.ok(!/Can you cover/.test(feed[0].title));
});

test('the calendar lists who is not free, so there is somebody to ask', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-22&to=2026-08-22').expect(200);

  const day = res.body.days['2026-08-22'];
  assert.equal(day.available.length, 0);
  assert.equal(day.unavailable.length, 1, 'being short of a cleaner is when you need this most');
  assert.ok(day.unavailable[0].reason, 'and why');
});

// --- one job, not several -------------------------------------------------

test('asking the same person for the same day twice is refused', async () => {
  // It produced two identical rows, one confirmed and one pending, and
  // the cleaner saw the same shift listed twice.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();

  const agent = await getAgent();
  await loginAs(agent, owner);
  const body = {
    cleaner_id: cleaner.id, property_id: property.id, cleaning_date: soon(),
  };
  await agent.post('/api/cleaners/jobs/assign').send(body).expect(201);
  const second = await agent.post('/api/cleaners/jobs/assign').send(body).expect(409);
  assert.match(second.body.error, /already down/i);

  const { rows } = await pool.query(
    'SELECT count(*)::int n FROM cleaning_jobs WHERE property_id = $1 AND cleaning_date = $2',
    [property.id, soon()]
  );
  assert.equal(rows[0].n, 1);
});

test('a job with nobody on it is filled rather than duplicated', async () => {
  // ON DELETE SET NULL leaves these behind when a cleaner is removed.
  // Creating a second row beside the empty one leaves the gap on screen
  // looking like more work than there is.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, NULL, $2, '10:00', '12:30', 'pending')`,
    [property.id, soon()]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id, cleaning_date: soon(),
  }).expect(201);

  const { rows } = await pool.query(
    'SELECT cleaner_id FROM cleaning_jobs WHERE property_id = $1 AND cleaning_date = $2',
    [property.id, soon()]
  );
  assert.equal(rows.length, 1, 'the hole was filled, not doubled');
  assert.equal(rows[0].cleaner_id, cleaner.id);
});

test('a second, different cleaner on the same day is still allowed', async () => {
  // Two people on one property in a day is a real thing — a big turnover,
  // or a preparation after a clean. Only the exact repeat is a mistake.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const one = await seedCleaner();
  const two = await seedCleaner();

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: one.id, property_id: property.id, cleaning_date: soon(),
  }).expect(201);
  await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: two.id, property_id: property.id, cleaning_date: soon(), reason: 'checkin',
  }).expect(201);

  const { rows } = await pool.query(
    'SELECT count(*)::int n FROM cleaning_jobs WHERE property_id = $1 AND cleaning_date = $2',
    [property.id, soon()]
  );
  assert.equal(rows[0].n, 2);
});

test('a declined job does not block asking somebody again', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2026-08-10', '10:00', '12:30', 'declined')`,
    [property.id, cleaner.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post('/api/cleaners/jobs/assign').send({
    cleaner_id: cleaner.id, property_id: property.id, cleaning_date: soon(),
  }).expect(201);
});

// --- the checklist, and when it closes a job -----------------------------

/**
 * The count comes before the sign-off.
 *
 * There was a second endpoint for this — POST /jobs/:jobId/ready — which
 * checked exactly this and was called by nothing, while /finish closed
 * the job with no check at all. The gate now lives where the job actually
 * ends.
 */

async function seedItem(propertyId, name, bookingId = null) {
  const { rows } = await pool.query(
    `INSERT INTO inventory_checklists (property_id, item_name, category, expected_quantity, booking_id)
     VALUES ($1, $2, 'General', 1, $3) RETURNING id`,
    [propertyId, name, bookingId]
  );
  return rows[0].id;
}

async function startedJob(property, cleaner, bookingId = null) {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `INSERT INTO cleaning_jobs
       (property_id, cleaner_id, booking_id, cleaning_date, start_time, end_time, status, started_at)
     VALUES ($1, $2, $3, $4, '10:00', '12:30', 'in_progress', NOW()) RETURNING id`,
    [property.id, cleaner.id, bookingId, today]
  );
  return rows[0].id;
}

test('a job with an uncounted checklist cannot be finished', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [bcrypt.hashSync('1234', 4), cleaner.id]);
  await seedItem(property.id, 'Bath towels');
  const jobId = await startedJob(property, cleaner);

  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone: '+27821234567', pin: '1234' }).expect(200);

  const res = await agent.post(`/api/cleaner-portal/jobs/${jobId}/finish`).expect(409);
  assert.match(res.body.error, /checklist/i);
  assert.equal(res.body.checklist_outstanding, 1);
});

test('once counted, the same job finishes', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234568' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [bcrypt.hashSync('1234', 4), cleaner.id]);
  const itemId = await seedItem(property.id, 'Bath towels');
  const jobId = await startedJob(property, cleaner);

  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone: '+27821234568', pin: '1234' }).expect(200);
  await agent.post('/api/cleaner-portal/inventory/check').send({
    cleaning_job_id: jobId,
    items: [{ checklist_item_id: itemId, actual_quantity: 6, status: 'ok' }],
  }).expect(200);

  await agent.post(`/api/cleaner-portal/jobs/${jobId}/finish`).expect(200);
});

test('a property with no checklist finishes with nothing to count', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234569' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [bcrypt.hashSync('1234', 4), cleaner.id]);
  const jobId = await startedJob(property, cleaner);

  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone: '+27821234569', pin: '1234' }).expect(200);
  await agent.post(`/api/cleaner-portal/jobs/${jobId}/finish`).expect(200);
});

test('an item asked for on one stay reaches that clean and no other', async () => {
  // The property list is right for towels. It is wrong for "the cot is
  // out for this family", which is true of one booking and nonsense on
  // every other.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234570' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [bcrypt.hashSync('1234', 4), cleaner.id]);

  await seedItem(property.id, 'Bath towels');
  await seedItem(property.id, 'Cot', 55501);
  const thisStay = await startedJob(property, cleaner, 55501);
  const otherStay = await startedJob(property, cleaner, 55502);

  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone: '+27821234570', pin: '1234' }).expect(200);

  const mine = await agent.get(`/api/cleaner-portal/jobs/${thisStay}/checklist`).expect(200);
  assert.deepEqual(mine.body.map((i) => i.item_name).sort(), ['Bath towels', 'Cot']);

  const theirs = await agent.get(`/api/cleaner-portal/jobs/${otherStay}/checklist`).expect(200);
  assert.deepEqual(theirs.body.map((i) => i.item_name), ['Bath towels'],
    'somebody else\'s cot is not their problem');
});

test('a stay-only item also blocks finishing that clean', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234571' });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [bcrypt.hashSync('1234', 4), cleaner.id]);
  await seedItem(property.id, 'Cot', 55503);
  const jobId = await startedJob(property, cleaner, 55503);

  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone: '+27821234571', pin: '1234' }).expect(200);
  await agent.post(`/api/cleaner-portal/jobs/${jobId}/finish`).expect(409);
});

test('the cleaning calendar survives a range containing an arrival', async () => {
  // Regression: the check-in loop was written above the helper it calls,
  // so the endpoint threw a temporal-dead-zone ReferenceError — but only
  // for ranges that actually contained a check-in. A single-day query
  // passed and the whole month 500'd, taking every calendar marker with
  // it. Nothing in the suite covered a realistic range.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await seedBooking({ property, smoobu_id: 66601, check_in: '2026-08-12', check_out: '2026-08-15' });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-01&to=2026-08-31').expect(200);
  assert.equal(res.body.days['2026-08-12'].checkins.length, 1);
  assert.equal(res.body.days['2026-08-15'].checkouts.length, 1);
});

// --- the manager's own eyes, and their order of preference ---------------

test('the status endpoint answers for every property in scope', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/properties/cleaning-status').expect(200);
  const row = res.body.find((r) => r.id === property.id);
  assert.equal(row.status, 'dirty', 'nothing on record means nothing is known');
  assert.ok(Array.isArray(row.blocks));
});

test('a manager marking it clean changes the answer', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post(`/api/properties/${property.id}/mark-clean`).send({}).expect(200);

  const res = await agent.get('/api/properties/cleaning-status').expect(200);
  assert.equal(res.body.find((r) => r.id === property.id).status, 'ready');
});

test('and marking it dirty overrules a clean that happened', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status, completed_at)
     VALUES ($1, $2, $3, '10:00', '12:30', 'completed', NOW())`,
    [property.id, cleaner.id, new Date().toISOString().slice(0, 10)]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.post(`/api/properties/${property.id}/mark-clean`).send({ dirty: true }).expect(200);

  const res = await agent.get('/api/properties/cleaning-status').expect(200);
  assert.equal(res.body.find((r) => r.id === property.id).status, 'dirty');
});

test('the preferred cleaner is the one who gets the job', async () => {
  // Assignment has always taken the first free person off a list. Until
  // the order was the manager's, which of two available cleaners got the
  // work was whatever the database returned.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const first = await seedCleaner({ name: 'Aaa' });
  const second = await seedCleaner({ name: 'Zzz' });
  await linkCleanerToProperty(first, property);
  await linkCleanerToProperty(second, property);

  const checkout = '2026-08-14'; // a Friday
  for (const c of [first, second]) {
    await pool.query(
      `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
       VALUES ($1, 5, '08:00', '18:00')`, [c.id]
    );
  }

  const agent = await getAgent();
  await loginAs(agent, owner);
  // Zzz preferred, despite sorting last by name.
  await agent.put(`/api/properties/${property.id}/cleaner-order`)
    .send({ cleaner_ids: [second.id, first.id] }).expect(200);

  const booking = await seedBooking({
    property, smoobu_id: 7301, check_in: '2026-08-10', check_out: checkout,
  });
  await assignCleanerForCheckout(booking, null);

  const { rows } = await pool.query(
    'SELECT cleaner_id FROM cleaning_jobs WHERE property_id = $1', [property.id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cleaner_id, second.id, 'the manager\'s first choice');
});

test('a block cannot be lifted when nothing recorded what to cancel', async () => {
  // Every block written before the reservation id was kept. Saying so
  // beats a button that silently does nothing.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { rows } = await pool.query(
    `INSERT INTO blocked_dates (property_id, date, reason) VALUES ($1, '2026-09-01', 'old') RETURNING id`,
    [property.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.delete(`/api/properties/${property.id}/block/${rows[0].id}`).expect(409);
  assert.match(res.body.error, /Smoobu/);
});

// --- a message you can act on, and clear --------------------------------

test('the unstaffed message carries what a button needs', async () => {
  // The prose says "block the nights until then" and contained the
  // property and the dates only as words. A message that tells you to do
  // something and cannot do it is worse than one that says nothing.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, name: 'Sea View' });
  const booking = await seedBooking({
    property, smoobu_id: 8801, check_in: '2026-08-10', check_out: '2026-08-14',
  });
  // Nobody linked, so nobody can go.
  await assignCleanerForCheckout(booking, null);

  const feed = await recent({});
  const told = feed.find((n) => n.event === 'job_unstaffed');
  assert.ok(told);
  assert.equal(told.meta.action, 'block');
  assert.equal(told.meta.property_id, property.id);
  assert.equal(told.meta.from, '2026-08-14');
});

test('a cleared message leaves the feed', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await notify({ event: 'issue_reported', title: 'Shower dripping', propertyId: property.id });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const before = await agent.get('/api/notifications').expect(200);
  assert.equal(before.body.notifications.length, 1);

  await agent.delete(`/api/notifications/${before.body.notifications[0].id}`).expect(200);

  const after = await agent.get('/api/notifications').expect(200);
  assert.equal(after.body.notifications.length, 0, 'gone, not greyer');
});

test('clearing the read ones leaves the unread alone', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await notify({ event: 'issue_reported', title: 'One', propertyId: property.id });
  await notify({ event: 'issue_reported', title: 'Two', propertyId: property.id });

  const agent = await getAgent();
  await loginAs(agent, owner);
  const all = await agent.get('/api/notifications').expect(200);
  await agent.post(`/api/notifications/${all.body.notifications[0].id}/read`).expect(200);

  const cleared = await agent.post('/api/notifications/clear-read').expect(200);
  assert.equal(cleared.body.cleared, 1);

  const left = await agent.get('/api/notifications').expect(200);
  assert.equal(left.body.notifications.length, 1);
  assert.equal(left.body.unread, 1);
});

test('a cleaner session cannot clear the owner\'s messages', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await notify({ event: 'issue_reported', title: 'Theirs', propertyId: property.id });
  const { agent } = await cleanerSession('+27821117777');
  await agent.delete('/api/notifications/1').expect(403);
});

// --- rows with nobody on them -------------------------------------------

/**
 * One deleted cleaner, three contradictory symptoms.
 *
 * cleaning_jobs.cleaner_id is ON DELETE SET NULL, so removing somebody
 * turned their jobs into rows nobody is doing. The day sheet called it "a
 * visit scheduled with nobody on it", the home board read it as "No
 * cleaner" for a checkout that *was* covered, and needs-attention listed
 * it a third time. All from one row that should not have survived.
 */

test('removing a cleaner clears their upcoming work', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, '10:00', '12:30', 'confirmed')`,
    [property.id, cleaner.id, soon]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.delete(`/api/cleaners/${cleaner.id}`).expect(200);
  assert.equal(res.body.jobs_cleared, 1);

  const { rows } = await pool.query('SELECT * FROM cleaning_jobs');
  assert.equal(rows.length, 0, 'no row left pretending somebody is going');
});

test('but work they already did is kept', async () => {
  // Losing the record that a property was cleaned, because the person who
  // cleaned it has left, is worse than a dangling name.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status, completed_at)
     VALUES ($1, $2, $3, '10:00', '12:30', 'completed', NOW())`,
    [property.id, cleaner.id, daysAgo(30)]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  await agent.delete(`/api/cleaners/${cleaner.id}`).expect(200);

  const { rows } = await pool.query('SELECT * FROM cleaning_jobs');
  assert.equal(rows.length, 1, 'the clean happened; that stays true');
  assert.equal(rows[0].cleaner_id, null);
});

test('an orphaned row is cleared even with no booking behind it', async () => {
  // These were invisible to the reconciler, which only looked at jobs
  // with a booking_id — and a deleted cleaner leaves rows with none.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, NULL, $2, '10:00', '12:30', 'pending')`,
    [property.id, soon]
  );

  const out = await reconcileCleaningJobs();
  assert.equal(out.removed.length, 1);
  const { rows } = await pool.query('SELECT * FROM cleaning_jobs');
  assert.equal(rows.length, 0);
});

test('a deliberate visit with no booking is left alone', async () => {
  // Somebody sent for a deep clean has no booking either. The difference
  // is that a person is going.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status, reason)
     VALUES ($1, $2, $3, '10:00', '12:30', 'confirmed', 'other')`,
    [property.id, cleaner.id, soon]
  );

  await reconcileCleaningJobs();
  const { rows } = await pool.query('SELECT * FROM cleaning_jobs');
  assert.equal(rows.length, 1, 'a deep clean is not an orphan');
});

// --- free means actually free -------------------------------------------

test('somebody already cleaning elsewhere that day is not free', async () => {
  // The count on the calendar said "1 cleaner free" for a day the only
  // cleaner was already booked at the other property. Assignment would
  // have refused them — it checks for an existing job — so the grid was
  // promising somebody the app would not send.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const a = await seedProperty({ owner, name: 'Hill Top Lodge' });
  const b = await seedProperty({ owner, name: 'The loft' });
  const cleaner = await seedCleaner({ name: 'Francesca' });
  await linkCleanerToProperty(cleaner, a);
  await linkCleanerToProperty(cleaner, b);
  // Available every day.
  for (let d = 0; d < 7; d++) {
    await pool.query(
      `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, '08:00', '18:00')`, [cleaner.id, d]
    );
  }
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2026-08-10', '10:00', '12:30', 'confirmed')`,
    [a.id, cleaner.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-10&to=2026-08-10').expect(200);

  const day = res.body.days['2026-08-10'];
  assert.deepEqual(day.available, [], 'she is at the other property');
  assert.equal(day.unavailable.length, 1);
  assert.match(day.unavailable[0].reason, /already at Hill Top Lodge/);
});

test('a declined job does not make somebody busy', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  for (let d = 0; d < 7; d++) {
    await pool.query(
      `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, '08:00', '18:00')`, [cleaner.id, d]
    );
  }
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2026-08-10', '10:00', '12:30', 'declined')`,
    [property.id, cleaner.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/cleaners/calendar?from=2026-08-10&to=2026-08-10').expect(200);
  assert.equal(res.body.days['2026-08-10'].available.length, 1, 'saying no frees the day');
});

test('one cleaner\'s calendar separates their pattern from their answer', async () => {
  // The schedule says Mondays. The calendar says not this Monday. The old
  // grid on the Cleaners page drew only the first and would have shown a
  // green tick on a day already refused.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner();
  await pool.query(
    `INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time)
     VALUES ($1, 1, '08:00', '18:00')`, [cleaner.id]
  );
  // 2026-08-17 is a Monday they have said no to.
  await pool.query(
    `INSERT INTO cleaner_availability_overrides (cleaner_id, date, available)
     VALUES ($1, '2026-08-17', 0)`, [cleaner.id]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get(`/api/cleaners/${cleaner.id}/calendar?from=2026-08-10&to=2026-08-24`).expect(200);

  assert.deepEqual(res.body.schedule.map((r) => r.day_of_week), [1], 'usually Mondays');
  assert.equal(res.body.days['2026-08-10'].state, 'free', 'a Monday they kept');
  assert.equal(res.body.days['2026-08-17'].state, 'off', 'a Monday they gave back');
});
