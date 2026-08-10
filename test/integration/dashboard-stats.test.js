const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, seedCleaner, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * GET /api/dashboard/stats — end-to-end accuracy tests.
 *
 * The endpoint reads the wall clock (`new Date()`) rather than accepting an
 * injectable `today`, so every test seeds bookings relative to `todayPlus(n)`
 * and asserts the derived numbers.
 *
 * Response shape:
 *   { upcoming_checkouts, occupancy, gaps, pending_cleaning_jobs,
 *     display_currency, last_synced_at }
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

function todayPlus(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// --- auth wall + empty state ---------------------------------------------

test('unauthenticated GET /api/dashboard/stats → 401', async () => {
  const app = await getApp();
  const request = require('supertest');
  await request(app).get('/api/dashboard/stats').expect(401);
});

test('user with no properties → empty arrays, no error', async () => {
  const user = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, user);

  const { body } = await agent.get('/api/dashboard/stats').expect(200);
  assert.deepEqual(body.upcoming_checkouts, []);
  assert.deepEqual(body.occupancy, []);
  assert.deepEqual(body.gaps, []);
  assert.deepEqual(body.pending_cleaning_jobs, []);
});

test('property with no bookings → occupancy row for it at 0%', async () => {
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, name: 'Empty House' });
  const agent = await getAgent();
  await loginAs(agent, admin);

  const { body } = await agent.get('/api/dashboard/stats').expect(200);
  assert.equal(body.occupancy.length, 1);
  assert.equal(body.occupancy[0].name, 'Empty House');
  assert.equal(body.occupancy[0].occupancy_rate, 0);
  assert.equal(body.occupancy[0].booked_nights, 0);
});

// --- occupancy over next 30 days -----------------------------------------

test('occupancy: booking fully inside the 30-day window → correct night count + %', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  // 5-night stay entirely within the window.
  await seedBooking({
    property,
    check_in: todayPlus(5),
    check_out: todayPlus(10),
    length_of_stay: 5,
    platform: 'Airbnb',
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);

  const row = body.occupancy.find((r) => r.property_id === property.id);
  assert.equal(row.booked_nights, 5);
  assert.equal(row.occupancy_rate, Math.round((5 / 30) * 100)); // 17
});

test('occupancy: booking straddling the window end is clipped', async () => {
  // Booking starts inside the 30-day window and continues past it. Only
  // the overlap should count.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({
    property,
    check_in: todayPlus(25),   // starts inside the window
    check_out: todayPlus(45),  // ends 15 days past it → only 5 in-window nights (25..30)
    length_of_stay: 20,
    platform: 'Airbnb',
  });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);
  const row = body.occupancy.find((r) => r.property_id === property.id);
  assert.equal(row.booked_nights, 5, 'only the in-window nights (25..30) should count');
});

test('occupancy: cancelled and blocked bookings do not count', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, check_in: todayPlus(1), check_out: todayPlus(5), length_of_stay: 4, status: 'cancelled', platform: 'Airbnb' });
  await seedBooking({ property, check_in: todayPlus(10), check_out: todayPlus(15), length_of_stay: 5, platform: 'Blocked channel' });
  await seedBooking({ property, check_in: todayPlus(20), check_out: todayPlus(23), length_of_stay: 3, platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);
  const row = body.occupancy.find((r) => r.property_id === property.id);
  assert.equal(row.booked_nights, 3, 'only the 3-night Airbnb booking should count');
});

// --- upcoming checkouts (next 48h) ---------------------------------------

test('upcoming_checkouts: booking with check_out inside next 48h shows up; further out does not', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // Guest checking out tomorrow → included (well within 48h).
  await seedBooking({ property, check_in: todayPlus(-2), check_out: todayPlus(1), length_of_stay: 3, guest_name: 'Leaving Soon', platform: 'Airbnb' });
  // Guest checking out in 5 days → NOT included.
  await seedBooking({ property, check_in: todayPlus(0), check_out: todayPlus(5), length_of_stay: 5, guest_name: 'Not Yet', platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);

  const names = body.upcoming_checkouts.map((b) => b.guest_name);
  assert.ok(names.includes('Leaving Soon'), 'guest checking out tomorrow should appear');
  assert.ok(!names.includes('Not Yet'), 'guest 5 days out should NOT appear');
});

// --- gap detection --------------------------------------------------------

test('gaps: 2-night gap between consecutive bookings is reported', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, name: 'Gap Palace' });

  await seedBooking({ property, check_in: todayPlus(3), check_out: todayPlus(6), length_of_stay: 3, platform: 'Airbnb' });
  await seedBooking({ property, check_in: todayPlus(8), check_out: todayPlus(11), length_of_stay: 3, platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);

  assert.equal(body.gaps.length, 1);
  assert.equal(body.gaps[0].property_id, property.id);
  assert.equal(body.gaps[0].property_name, 'Gap Palace');
  assert.equal(body.gaps[0].nights, 2);
});

test('gaps: back-to-back (same-day turnover) is 0 nights and NOT reported', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({ property, check_in: todayPlus(3), check_out: todayPlus(6), length_of_stay: 3, platform: 'Airbnb' });
  await seedBooking({ property, check_in: todayPlus(6), check_out: todayPlus(10), length_of_stay: 4, platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);

  assert.deepEqual(body.gaps, [], 'a 0-night gap should not appear');
});

test('gaps: 4+ night gap is NOT reported (default max is 3)', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({ property, check_in: todayPlus(3), check_out: todayPlus(6), length_of_stay: 3, platform: 'Airbnb' });
  await seedBooking({ property, check_in: todayPlus(10), check_out: todayPlus(13), length_of_stay: 3, platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);

  assert.deepEqual(body.gaps, []);
});

// --- scoping --------------------------------------------------------------

test('scoping: user B\'s dashboard sees only user B\'s occupancy rows', async () => {
  const alice = await seedUser({ role: 'property_manager' });
  const bob = await seedUser({ role: 'property_manager' });
  const aliceProp = await seedProperty({ owner: alice, name: 'Alice House' });
  const bobProp = await seedProperty({ owner: bob, name: 'Bob House' });

  await seedBooking({ property: aliceProp, check_in: todayPlus(1), check_out: todayPlus(6), length_of_stay: 5, platform: 'Airbnb' });
  await seedBooking({ property: bobProp, check_in: todayPlus(2), check_out: todayPlus(5), length_of_stay: 3, platform: 'Airbnb' });

  const agent = await getAgent();
  await loginAs(agent, bob);
  const { body } = await agent.get('/api/dashboard/stats').expect(200);

  assert.deepEqual(
    body.occupancy.map((r) => r.name),
    ['Bob House'],
    'Bob should see only his property in the occupancy list'
  );
  const bobRow = body.occupancy[0];
  assert.equal(bobRow.booked_nights, 3);
});

test('a job the cleaner declined is not returned as cover', async () => {
  // The calendar decides a booking has a cleaner by looking for a job on
  // the day with a name on it. This endpoint used to hand back declined
  // jobs alongside live ones, so a refusal read on screen as "Francesca
  // is cleaning this" — while the day sheet, asking differently, showed
  // nobody. One of the contradictions on the front page.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ name: 'Francesca' });
  const date = todayPlus(1);

  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, '10:00', '12:30', 'declined')`,
    [property.id, cleaner.id, date]
  );

  const agent = await getAgent();
  await loginAs(agent, owner);
  const res = await agent.get('/api/dashboard/stats').expect(200);

  const jobs = res.body.pending_cleaning_jobs || [];
  assert.equal(
    jobs.filter((j) => j.cleaner_name === 'Francesca').length, 0,
    'she said no, so she is not cover'
  );
});
