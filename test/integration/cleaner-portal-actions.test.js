const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedCleaner, seedBooking, linkCleanerToProperty } = require('../helpers/seed');

/** YYYY-MM-DD, n days ahead — used to land outside the cleaning window. */
function futureDate(n) {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const { pool } = require('../../src/db/database');

/**
 * What a cleaner can do from their own app.
 *
 * The portal had endpoints for availability, checklists and maintenance
 * but no way to accept a job, decline one, record when the work actually
 * happened, or ask for supplies — the last of those refused a PIN session
 * outright. These cover the three that were added.
 */

async function signedInCleaner(phone = '+27821234567') {
  const cleaner = await seedCleaner({ phone });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [
    bcrypt.hashSync('1234', 4), cleaner.id,
  ]);
  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone, pin: '1234' }).expect(200);
  return { cleaner, agent };
}

async function seedJob(cleaner, property, overrides = {}) {
  const { rows } = await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      property.id, cleaner.id,
      overrides.cleaning_date || futureDate(0),
      overrides.start_time || '10:00',
      overrides.end_time || '12:30',
      overrides.status || 'pending',
    ]
  );
  return rows[0];
}

test.before(async () => { await resetDb(); });
test.after(async () => { await closePool(); });

// --- accepting and declining --------------------------------------------

test('a cleaner can accept a job', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);
  const job = await seedJob(cleaner, property);

  await agent.put(`/api/cleaner-portal/jobs/${job.id}/status`)
    .send({ status: 'confirmed' }).expect(200);

  const { rows } = await pool.query('SELECT status FROM cleaning_jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].status, 'confirmed');
});

test('a cleaner can decline a job', async () => {
  // Without this the only way to say no was silence, and a job left at
  // pending is indistinguishable from one nobody has read — so an owner
  // never knows to reassign it.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property);

  await agent.put(`/api/cleaner-portal/jobs/${job.id}/status`)
    .send({ status: 'declined' }).expect(200);

  const { rows } = await pool.query('SELECT status FROM cleaning_jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].status, 'declined');
});

test('a cleaner cannot touch a job that is not theirs', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const other = await seedCleaner({ phone: '+27829999999' });
  const job = await seedJob(other, property);
  const { agent } = await signedInCleaner();

  const res = await agent.put(`/api/cleaner-portal/jobs/${job.id}/status`)
    .send({ status: 'declined' });
  assert.equal(res.status, 404);

  const { rows } = await pool.query('SELECT status FROM cleaning_jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].status, 'pending', 'untouched');
});

// --- checking in and out -------------------------------------------------

test('starting a job records the time and marks it in progress', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property, { status: 'confirmed' });

  const res = await agent.post(`/api/cleaner-portal/jobs/${job.id}/start`).expect(200);
  assert.ok(res.body.started_at, 'a start time comes back');

  const { rows } = await pool.query('SELECT status, started_at FROM cleaning_jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].status, 'in_progress');
  assert.ok(rows[0].started_at);
});

test('tapping start twice does not move the start time', async () => {
  // A double tap on a slow connection must not cost the cleaner the
  // minutes they have already worked.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property);

  const first = await agent.post(`/api/cleaner-portal/jobs/${job.id}/start`).expect(200);
  const second = await agent.post(`/api/cleaner-portal/jobs/${job.id}/start`).expect(200);
  assert.equal(
    new Date(second.body.started_at).getTime(),
    new Date(first.body.started_at).getTime()
  );
  assert.equal(second.body.already, true);
});

test('finishing records the time and completes the job', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property);

  await agent.post(`/api/cleaner-portal/jobs/${job.id}/start`).expect(200);
  const res = await agent.post(`/api/cleaner-portal/jobs/${job.id}/finish`).expect(200);
  assert.ok(res.body.completed_at);

  const { rows } = await pool.query(
    'SELECT status, started_at, completed_at FROM cleaning_jobs WHERE id = $1', [job.id]
  );
  assert.equal(rows[0].status, 'completed');
  assert.ok(rows[0].completed_at >= rows[0].started_at, 'finished no earlier than started');
});

test('finishing without starting back-fills the start from the scheduled time', async () => {
  // A cleaner who forgot to tap on arrival must still be able to record
  // that the property is done. Losing the finish time to enforce an
  // order would help nobody.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property, { start_time: '00:00' });

  const res = await agent.post(`/api/cleaner-portal/jobs/${job.id}/finish`).expect(200);
  assert.ok(res.body.started_at, 'a start time was filled in');
  assert.ok(res.body.completed_at);

  const { rows } = await pool.query('SELECT status FROM cleaning_jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].status, 'completed');
});

test('a stranger cannot start somebody else\'s job', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const other = await seedCleaner({ phone: '+27829999999' });
  const job = await seedJob(other, property);
  const { agent } = await signedInCleaner();

  const res = await agent.post(`/api/cleaner-portal/jobs/${job.id}/start`);
  assert.equal(res.status, 404);
});

// --- supplies ------------------------------------------------------------

test('a cleaner can ask for supplies, and the request is visible', async () => {
  // This used to be refused outright: "Shopping list not available for
  // PIN-auth cleaners", because added_by is a foreign key to users.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);

  await agent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Bin liners', notes: 'Large' })
    .expect(201);

  // The list joined users inline, which would have hidden this row.
  const list = await agent.get('/api/cleaner-portal/shopping-list').expect(200);
  const item = list.body.find((i) => i.item_name === 'Bin liners');
  assert.ok(item, 'the request is on the list');
  assert.equal(item.added_by_name, cleaner.name, 'attributed to the cleaner');
});

test('a cleaner cannot request against a property they do not work at', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const mine = await seedProperty({ owner });
  const theirs = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, mine);

  const res = await agent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: theirs.id, item_name: 'Snooping' });
  assert.equal(res.status, 403);
});

// --- availability --------------------------------------------------------

test('a cleaner can set the days they work', async () => {
  await resetDb();
  const { cleaner, agent } = await signedInCleaner();

  await agent.put('/api/cleaner-portal/availability')
    .send({ schedule: [
      { day_of_week: 1, start_time: '08:00', end_time: '16:00' },
      { day_of_week: 5, start_time: '09:00', end_time: '13:00' },
    ] })
    .expect(200);

  const { rows } = await pool.query(
    'SELECT day_of_week, start_time FROM cleaner_availability WHERE cleaner_id = $1 ORDER BY day_of_week',
    [cleaner.id]
  );
  assert.deepEqual(rows.map((r) => r.day_of_week), [1, 5]);
  assert.equal(rows[0].start_time, '08:00');
});

// --- the window on start and finish -------------------------------------

test('a clean cannot be started before its day', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  // Two weeks out — comfortably not today, whatever timezone the CI box is in.
  const job = await seedJob(cleaner, property, { cleaning_date: futureDate(14) });

  const res = await agent.post(`/api/cleaner-portal/jobs/${job.id}/start`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /on the day/i);

  const { rows } = await pool.query('SELECT started_at FROM cleaning_jobs WHERE id = $1', [job.id]);
  assert.equal(rows[0].started_at, null, 'nothing was recorded');
});

test('a clean cannot be finished before its day either', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property, { cleaning_date: futureDate(14) });

  const res = await agent.post(`/api/cleaner-portal/jobs/${job.id}/finish`);
  assert.equal(res.status, 409);
});

test('a clean already under way can still be finished', async () => {
  // The window is checked after the already-started branch on purpose:
  // a job begun legitimately must stay reportable even once the window
  // has shut, or a cleaner working past midnight loses their finish.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  const job = await seedJob(cleaner, property, { cleaning_date: futureDate(14) });

  await pool.query("UPDATE cleaning_jobs SET started_at = NOW(), status = 'in_progress' WHERE id = $1", [job.id]);
  await agent.post(`/api/cleaner-portal/jobs/${job.id}/finish`).expect(200);
});

// --- what the calendar is fed --------------------------------------------

test('bookings come back for the cleaner\'s properties, with no money in them', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);
  await seedBooking({
    property, check_in: futureDate(2), check_out: futureDate(5),
    total_price: 25000, guest_name: 'Siba Daki', num_guests: 2,
  });

  const res = await agent.get('/api/cleaner-portal/bookings').expect(200);
  assert.equal(res.body.length, 1);
  const b = res.body[0];
  assert.equal(b.guest_name, 'Siba Daki', 'the cleaner is told who is coming');
  assert.equal(b.num_guests, 2);

  // Money is not selected at all, so it cannot leak through a later
  // change to the front end.
  const serialised = JSON.stringify(b);
  assert.ok(!serialised.includes('25000'), 'no price');
  for (const field of ['total_price', 'commission', 'price_per_night', 'currency']) {
    assert.equal(b[field], undefined, `${field} must not be sent`);
  }
});

test('another property\'s bookings are not visible', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const mine = await seedProperty({ owner });
  const theirs = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, mine);
  await seedBooking({ property: theirs, check_in: futureDate(2), check_out: futureDate(4), guest_name: 'Not Mine' });

  const res = await agent.get('/api/cleaner-portal/bookings').expect(200);
  assert.equal(res.body.length, 0);
});

test('blocks and cancellations are not stays', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);
  await seedBooking({ property, check_in: futureDate(1), check_out: futureDate(3), platform: 'Blocked channel auto', guest_name: '' });
  await seedBooking({ property, check_in: futureDate(4), check_out: futureDate(6), status: 'cancelled', guest_name: 'Gone' });
  await seedBooking({ property, check_in: futureDate(7), check_out: futureDate(9), guest_name: 'Real Guest' });

  const res = await agent.get('/api/cleaner-portal/bookings').expect(200);
  assert.deepEqual(res.body.map((b) => b.guest_name), ['Real Guest']);
});
