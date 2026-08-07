const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, seedCleaner, linkCleanerToProperty } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const {
  findOverlappingBookings,
  findInvalidBookingDates,
  findCleanerDoubleBookings,
} = require('../../src/services/integrity');

/**
 * Data-integrity detectors run against the real DB.
 *
 * Locks in the promise that the pure detector functions behave the same on
 * pg's actual row shapes (Date objects for date columns, string/numeric ids,
 * etc.) as on plain JS fixtures.
 *
 * Also demonstrates the "monitoring" pattern: a would-be admin health-check
 * would use exactly these queries.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// --- overlap detection over a real DB -----------------------------------

test('DB integrity: findOverlappingBookings catches overlapping rows', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  // Seed two overlapping bookings — impossible in normal operation but the
  // schema doesn't prevent them.
  await seedBooking({ property, smoobu_id: 1, check_in: '2025-06-10', check_out: '2025-06-14' });
  await seedBooking({ property, smoobu_id: 2, check_in: '2025-06-12', check_out: '2025-06-16' });
  // Same-day turnover on the same property — must NOT be flagged.
  await seedBooking({ property, smoobu_id: 3, check_in: '2025-06-16', check_out: '2025-06-20' });

  const bookings = (await pool.query('SELECT * FROM bookings ORDER BY smoobu_id')).rows;
  const overlaps = findOverlappingBookings(bookings);
  assert.equal(overlaps.length, 1);
  const pairIds = overlaps[0].map((b) => Number(b.smoobu_id)).sort();
  assert.deepEqual(pairIds, [1, 2]);
});

test('DB integrity: clean DB → detector reports no overlaps', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' });
  await seedBooking({ property, smoobu_id: 2, check_in: '2025-06-13', check_out: '2025-06-16' });
  await seedBooking({ property, smoobu_id: 3, check_in: '2025-07-01', check_out: '2025-07-05' });

  const bookings = (await pool.query('SELECT * FROM bookings')).rows;
  assert.deepEqual(findOverlappingBookings(bookings), []);
});

test('DB integrity: cancelled + blocked rows are ignored even when they overlap', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 1, check_in: '2025-06-10', check_out: '2025-06-16' });
  await seedBooking({ property, smoobu_id: 2, check_in: '2025-06-11', check_out: '2025-06-15', status: 'cancelled' });
  await seedBooking({ property, smoobu_id: 3, check_in: '2025-06-12', check_out: '2025-06-14', platform: 'Blocked channel' });

  const bookings = (await pool.query('SELECT * FROM bookings')).rows;
  assert.deepEqual(findOverlappingBookings(bookings), []);
});

// --- invalid dates over a real DB ---------------------------------------

test('DB integrity: findInvalidBookingDates catches zero-length stays', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 1, check_in: '2025-06-10', check_out: '2025-06-13', length_of_stay: 3 });
  // Zero-night booking (check_in == check_out) — currently allowed by schema.
  await seedBooking({ property, smoobu_id: 2, check_in: '2025-06-15', check_out: '2025-06-15', length_of_stay: 1 });

  const bookings = (await pool.query('SELECT * FROM bookings ORDER BY smoobu_id')).rows;
  // Normalise Date objects to strings so the string-comparison detector works.
  for (const b of bookings) {
    if (b.check_in instanceof Date) b.check_in = b.check_in.toISOString().slice(0, 10);
    if (b.check_out instanceof Date) b.check_out = b.check_out.toISOString().slice(0, 10);
  }
  const bad = findInvalidBookingDates(bookings);
  assert.equal(bad.length, 1);
  assert.equal(Number(bad[0].smoobu_id), 2);
});

// --- cleaner double-booking over a real DB ------------------------------

test('DB integrity: findCleanerDoubleBookings catches same cleaner on two jobs same day', async () => {
  const admin = await seedUser({ role: 'admin' });
  const propA = await seedProperty({ owner: admin });
  const propB = await seedProperty({ owner: admin });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, propA);
  await linkCleanerToProperty(cleaner, propB);

  // Manually insert two overlapping jobs — the app's own
  // assignCleanerForCheckout would refuse the second, but a bug in another
  // write path could still produce this state.
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2025-06-13', '10:00', '12:30', 'pending'),
            ($3, $2, '2025-06-13', '13:00', '15:30', 'pending')`,
    [propA.id, cleaner.id, propB.id]
  );

  const jobs = (await pool.query('SELECT * FROM cleaning_jobs')).rows;
  const dupes = findCleanerDoubleBookings(jobs);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].cleaner_id, cleaner.id);
  assert.equal(dupes[0].jobs.length, 2);
});

test('DB integrity: completed jobs do not count as double-booking', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);

  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, '2025-06-13', '10:00', '12:30', 'completed'),
            ($1, $2, '2025-06-13', '13:00', '15:30', 'pending')`,
    [property.id, cleaner.id]
  );

  const jobs = (await pool.query('SELECT * FROM cleaning_jobs')).rows;
  assert.deepEqual(findCleanerDoubleBookings(jobs), []);
});
