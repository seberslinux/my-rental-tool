const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const {
  seedUser,
  seedProperty,
  seedBooking,
  seedCleaner,
  linkCleanerToProperty,
  seedAvailability,
  seedAvailabilityOverride,
} = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const mockWhatsapp = require('../helpers/mock-whatsapp');
const { pool } = require('../../src/db/database');
const {
  assignCleanerForCheckout,
  runAssignmentForAllCheckouts,
} = require('../../src/services/cleaner-assignment');

/**
 * Cleaner-assignment cron correctness.
 *
 * assignCleanerForCheckout() picks an eligible cleaner for a booking's
 * checkout day, creates a cleaning_jobs row + sends WhatsApp, or blocks
 * the dates in Smoobu when nobody is available. It runs unattended on a
 * schedule (see src/cron/jobs.js) and touches production data — a bug
 * here silently mis-assigns cleaners or wrongly blocks dates.
 */

test.before(() => getApp());
test.beforeEach(async () => {
  await resetDb();
  mockSmoobu.reset();
  mockWhatsapp.reset();
});
test.after(() => closePool());

// --- helpers -------------------------------------------------------------

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay();
}

// Every test uses a fixed known-good date; day-of-week arithmetic is
// verified separately by seedAvailability(dayOfWeek(date), ...).
const CHECKOUT = '2025-06-13'; // Friday
const NEXT_CHECKIN = '2025-06-13';

async function loadJobs(propertyId) {
  const rows = await pool.query(
    'SELECT * FROM cleaning_jobs WHERE property_id = $1 ORDER BY id',
    [propertyId]
  );
  return rows.rows;
}

async function loadBlockedDates(propertyId) {
  const rows = await pool.query(
    'SELECT * FROM blocked_dates WHERE property_id = $1',
    [propertyId]
  );
  return rows.rows;
}

// --- happy path ----------------------------------------------------------

test('eligible cleaner is assigned: job row created with correct fields', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({
    property, smoobu_id: 1001,
    check_in: '2025-06-10', check_out: CHECKOUT, length_of_stay: 3,
  });
  const cleaner = await seedCleaner({ name: 'Anna' });
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '08:00', '17:00');

  const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  assert.ok(jobId, 'expected a job id');

  const jobs = await loadJobs(property.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].cleaner_id, cleaner.id);
  // booking_id stores smoobu_id (not the local bookings.id) so the link
  // survives the delete-and-re-insert sync cycle.
  assert.equal(Number(jobs[0].booking_id), 1001);
  assert.equal(new Date(jobs[0].cleaning_date).toISOString().slice(0, 10), CHECKOUT);
  assert.equal(jobs[0].start_time, '10:00');
  assert.equal(jobs[0].status, 'pending');
});

test('WhatsApp message sent on assignment includes property + date + duration', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, name: 'Sea View' });
  const booking = await seedBooking({ property, smoobu_id: 2, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner({ name: 'Bea', phone: '+27111111111' });
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '08:00', '17:00');

  await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });

  assert.equal(mockWhatsapp.sent.length, 1);
  // Digits, no plus. The bare sendMessage this replaced passed the number
  // through as stored; notify() normalises it, which is the form the API
  // wants and what the owner-facing path has always asserted.
  assert.equal(mockWhatsapp.sent[0].to, '27111111111');
  const msg = mockWhatsapp.sent[0].message;
  assert.ok(msg.includes('Sea View'), 'message must include property name');
  assert.ok(msg.includes(CHECKOUT), 'message must include the checkout date');
});

test('end_time = start_time + cleaning_hours_required (default 2.5h)', async () => {
  // Default cleaning_hours_required = 2.5; start = '10:00'; expect '12:30'.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 3, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '08:00', '17:00');

  await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  const jobs = await loadJobs(property.id);
  assert.equal(jobs[0].end_time, '12:30');
});

// --- ineligibility rules -------------------------------------------------

test('cleaner with override marking date UNAVAILABLE is skipped', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 4, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '08:00', '17:00');
  await seedAvailabilityOverride(cleaner, CHECKOUT, false); // explicit UNAVAILABLE

  const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  assert.equal(jobId, null, 'no job should be created when only cleaner is on override-unavailable');
  assert.equal((await loadJobs(property.id)).length, 0);
});

test('cleaner with no weekly availability for that day is skipped', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 5, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  // Availability only on Monday (1); checkout is Friday (5) → skipped.
  await seedAvailability(cleaner, 1, '08:00', '17:00');

  const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  assert.equal(jobId, null);
});

test('cleaner whose weekly window does not cover the cleaning window is skipped', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 6, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  // Cleaner only works 12:00–13:00; cleaning window is 10:00–15:00 → skipped.
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '12:00', '13:00');

  const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  assert.equal(jobId, null);
});

test('cleaner already booked that day is skipped', async () => {
  const admin = await seedUser({ role: 'admin' });
  const propA = await seedProperty({ owner: admin, name: 'A' });
  const propB = await seedProperty({ owner: admin, name: 'B' });
  const bookingA = await seedBooking({ property: propA, smoobu_id: 7, check_in: '2025-06-10', check_out: CHECKOUT });
  const bookingB = await seedBooking({ property: propB, smoobu_id: 8, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, propA);
  await linkCleanerToProperty(cleaner, propB);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '08:00', '17:00');

  // Assign to property A first.
  await assignCleanerForCheckout(bookingA, { check_in: NEXT_CHECKIN });
  assert.equal((await loadJobs(propA.id)).length, 1);

  // Second call should NOT reuse the same cleaner — property B has no one else.
  const secondJobId = await assignCleanerForCheckout(bookingB, { check_in: NEXT_CHECKIN });
  assert.equal(secondJobId, null, 'cleaner already booked that date must be skipped');
  assert.equal((await loadJobs(propB.id)).length, 0);
});

// --- property constraint --------------------------------------------------

test('property requiring more cleaning hours than the window → nobody assigned, dates blocked', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await pool.query(
    `UPDATE properties SET cleaning_hours_required = 10 WHERE id = $1`,
    [property.id]
  );
  const booking = await seedBooking({ property, smoobu_id: 9, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '00:00', '23:59');

  const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  assert.equal(jobId, null);
  assert.equal((await loadJobs(property.id)).length, 0);
  assert.equal((await loadBlockedDates(property.id)).length, 1);
});

// --- multi-cleaner order --------------------------------------------------

test('first eligible cleaner is picked; when first is unavailable, second is used', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 10, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleanerA = await seedCleaner({ name: 'A-first' });
  const cleanerB = await seedCleaner({ name: 'B-second' });
  await linkCleanerToProperty(cleanerA, property);
  await linkCleanerToProperty(cleanerB, property);
  await seedAvailabilityOverride(cleanerA, CHECKOUT, false); // A unavailable
  await seedAvailability(cleanerB, dayOfWeek(CHECKOUT), '08:00', '17:00'); // B available

  await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  const jobs = await loadJobs(property.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].cleaner_id, cleanerB.id);
});

// --- no cleaner available → block dates ---------------------------------

test('nobody available → smoobu.blockDates called + blocked_dates row inserted + NO WhatsApp', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 5000 });
  const booking = await seedBooking({ property, smoobu_id: 11, check_in: '2025-06-10', check_out: CHECKOUT });
  // No cleaners linked at all.

  const blockCalls = [];
  const smoobu = require('../../src/services/smoobu');
  const originalBlock = smoobu.blockDates;
  smoobu.blockDates = async (aptId, from, to, note) => {
    blockCalls.push({ aptId, from, to, note });
    return { id: 99 };
  };

  try {
    const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
    assert.equal(jobId, null);
    assert.equal(mockWhatsapp.sent.length, 0, 'no cleaner → no WhatsApp');
    assert.equal(blockCalls.length, 1, 'smoobu.blockDates must be called');
    assert.equal(blockCalls[0].aptId, 5000);
    assert.equal(blockCalls[0].from, CHECKOUT);
    assert.equal((await loadBlockedDates(property.id)).length, 1);
  } finally {
    smoobu.blockDates = originalBlock;
  }
});

// --- window shape (with vs without nextBooking) ------------------------

test('window shape: with nextBooking the cleaning window is 10:00-15:00 (5h)', async () => {
  // A 5h window comfortably fits the default 2.5h requirement.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 12, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  // Availability exactly matches the cleaning window.
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '10:00', '15:00');

  const jobId = await assignCleanerForCheckout(booking, { check_in: NEXT_CHECKIN });
  assert.ok(jobId);
});

test('window shape: without nextBooking the cleaning window is 10:00-14:00 (4h)', async () => {
  // Availability that fits the 5h "with next" window but NOT the 4h "no next"
  // window — 10:00-14:30. Should be assigned because 14:00 is inside 14:30.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const booking = await seedBooking({ property, smoobu_id: 13, check_in: '2025-06-10', check_out: CHECKOUT });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, dayOfWeek(CHECKOUT), '10:00', '14:30');

  // No nextBooking → shorter window.
  const jobId = await assignCleanerForCheckout(booking, null);
  assert.ok(jobId);
});

// --- runAssignmentForAllCheckouts scope + idempotency ------------------

test('runAssignmentForAllCheckouts: skips bookings that already have a cleaning_job', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  const day = daysFromNow(5);
  await seedAvailability(cleaner, dayOfWeek(day), '08:00', '17:00');

  await seedBooking({
    property, smoobu_id: 20,
    check_in: daysFromNow(2), check_out: day, length_of_stay: 3,
  });

  await runAssignmentForAllCheckouts();
  const first = await loadJobs(property.id);
  assert.equal(first.length, 1);

  // Run again — must be idempotent (NOT EXISTS filter guards this).
  await runAssignmentForAllCheckouts();
  const second = await loadJobs(property.id);
  assert.equal(second.length, 1, 'second run must not duplicate the job');
});

test('runAssignmentForAllCheckouts: only bookings checking out inside the 30-day window are processed', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);
  // Availability for every day so weekday doesn't confound the test.
  for (let d = 0; d < 7; d++) await seedAvailability(cleaner, d, '08:00', '17:00');

  // In-window checkout: 5 days out.
  await seedBooking({ property, smoobu_id: 30, check_in: daysFromNow(2), check_out: daysFromNow(5) });
  // Out-of-window checkout: 45 days out.
  await seedBooking({ property, smoobu_id: 31, check_in: daysFromNow(42), check_out: daysFromNow(45) });

  await runAssignmentForAllCheckouts();

  const jobs = await loadJobs(property.id);
  assert.equal(jobs.length, 1, 'only the in-window booking should get a job');
  assert.equal(Number(jobs[0].booking_id), 30);
});

// --- helpers --------------------------------------------------------------

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// --- reconciliation: jobs follow their booking ---------------------------

/**
 * Assignment only ever created.
 *
 * Its query skips any booking that already has a job, so once a job
 * existed nothing looked at it again. A booking that moved left its clean
 * behind: production had a stay running to 31 July whose clean sat on 30
 * June, a date nothing checked out on. The webhook path rebuilds the job,
 * but a change arriving by sync never reached that code.
 */

const { reconcileCleaningJobs } = require('../../src/services/cleaner-assignment');

/** A date N days from today, as YYYY-MM-DD. */
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function jobFor(smoobuId) {
  const { rows } = await pool.query(
    'SELECT * FROM cleaning_jobs WHERE booking_id = $1', [smoobuId]
  );
  return rows[0] || null;
}

async function seedJob({ property, cleaner, smoobuId, date }) {
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, booking_id, cleaning_date,
       start_time, end_time, status)
     VALUES ($1, $2, $3, $4, '10:00', '13:00', 'pending')`,
    [property.id, cleaner.id, smoobuId, date]
  );
}

test('a booking that moved takes its cleaning job with it', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await linkCleanerToProperty(cleaner, property);

  // The stay now ends later than when the job was created.
  const booking = await seedBooking({
    property, smoobu_id: 999001, check_in: inDays(1), check_out: inDays(20),
  });
  await seedJob({ property, cleaner, smoobuId: 999001, date: inDays(5) });

  const out = await reconcileCleaningJobs();

  const job = await jobFor(999001);
  assert.equal(
    job.cleaning_date instanceof Date
      ? job.cleaning_date.toISOString().slice(0, 10)
      : String(job.cleaning_date).slice(0, 10),
    inDays(20),
    'the clean belongs on the day the guest actually leaves'
  );
  assert.equal(out.moved.length, 1);
  assert.equal(booking.smoobu_id, 999001);
});

test('a cancelled booking loses its cleaning job', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await seedBooking({
    property, smoobu_id: 999002, check_in: inDays(1), check_out: inDays(6),
    status: 'cancelled',
  });
  await seedJob({ property, cleaner, smoobuId: 999002, date: inDays(6) });

  await reconcileCleaningJobs();
  assert.equal(await jobFor(999002), null);
});

test('a job left over from a blocked night is removed', async () => {
  // Smoobu writes "Blocked channel auto" rows for nights off sale. Nobody
  // slept there, so nobody cleans.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await seedBooking({
    property, smoobu_id: 999003, check_in: inDays(2), check_out: inDays(3),
    platform: 'Blocked channel auto',
  });
  await seedJob({ property, cleaner, smoobuId: 999003, date: inDays(3) });

  await reconcileCleaningJobs();
  assert.equal(await jobFor(999003), null);
});

test('a job whose booking no longer exists is removed', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await seedJob({ property, cleaner, smoobuId: 999004, date: inDays(4) });

  await reconcileCleaningJobs();
  assert.equal(await jobFor(999004), null, 'nothing justifies this clean');
});

test('work already started is never touched', async () => {
  // started_at and completed_at are the record of what somebody actually
  // did. No reconciliation is worth rewriting them.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await seedBooking({
    property, smoobu_id: 999005, check_in: inDays(1), check_out: inDays(9),
    status: 'cancelled',
  });
  await seedJob({ property, cleaner, smoobuId: 999005, date: inDays(2) });
  await pool.query("UPDATE cleaning_jobs SET started_at = NOW() WHERE booking_id = 999005");

  await reconcileCleaningJobs();
  assert.ok(await jobFor(999005), 'a clean in progress survives a cancelled booking');
});

test('the past is left alone', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await seedJob({ property, cleaner, smoobuId: 999006, date: inDays(-30) });

  await reconcileCleaningJobs();
  assert.ok(await jobFor(999006), 'last month is history, right or wrong');
});

test('a job already on the right day is not churned', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();
  await seedBooking({
    property, smoobu_id: 999007, check_in: inDays(1), check_out: inDays(7),
  });
  await seedJob({ property, cleaner, smoobuId: 999007, date: inDays(7) });

  const out = await reconcileCleaningJobs();
  assert.equal(out.moved.length, 0, 'a Date object compared with === would move everything');
  assert.equal(out.removed.length, 0);
});
