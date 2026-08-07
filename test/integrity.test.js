const test = require('node:test');
const assert = require('node:assert/strict');
const {
  intervalsOverlap,
  findOverlappingBookings,
  findInvalidBookingDates,
  findCleanerDoubleBookings,
} = require('../src/services/integrity');

/**
 * Data integrity detectors — unit tests.
 *
 * These functions FIND business-rule violations. The app doesn't currently
 * enforce these rules at write time (Smoobu is treated as source of truth
 * and its data is trusted), so these tests both:
 *   - lock in the detector semantics
 *   - document what "impossible state" looks like when the trust breaks
 */

// --- intervalsOverlap ----------------------------------------------------

test('intervalsOverlap: identical intervals overlap', () => {
  assert.equal(intervalsOverlap('2025-06-10', '2025-06-13', '2025-06-10', '2025-06-13'), true);
});

test('intervalsOverlap: back-to-back (a.end == b.start) do NOT overlap (half-open)', () => {
  // Guest A leaves 2025-06-13, guest B arrives 2025-06-13 → same-day turnover,
  // both booking rows are legitimate.
  assert.equal(intervalsOverlap('2025-06-10', '2025-06-13', '2025-06-13', '2025-06-16'), false);
});

test('intervalsOverlap: touching in reverse (b.end == a.start) do NOT overlap', () => {
  assert.equal(intervalsOverlap('2025-06-13', '2025-06-16', '2025-06-10', '2025-06-13'), false);
});

test('intervalsOverlap: partial overlap detected either way', () => {
  assert.equal(intervalsOverlap('2025-06-10', '2025-06-14', '2025-06-12', '2025-06-16'), true);
  assert.equal(intervalsOverlap('2025-06-12', '2025-06-16', '2025-06-10', '2025-06-14'), true);
});

test('intervalsOverlap: one interval fully inside the other', () => {
  assert.equal(intervalsOverlap('2025-06-10', '2025-06-20', '2025-06-12', '2025-06-15'), true);
});

test('intervalsOverlap: fully separate → no overlap', () => {
  assert.equal(intervalsOverlap('2025-06-10', '2025-06-13', '2025-06-20', '2025-06-25'), false);
});

// --- findOverlappingBookings --------------------------------------------

function bk(overrides = {}) {
  return {
    id: 0,
    property_id: 1,
    check_in: '2025-06-10',
    check_out: '2025-06-13',
    status: 'confirmed',
    platform: 'Airbnb',
    ...overrides,
  };
}

test('findOverlappingBookings: empty input → empty', () => {
  assert.deepEqual(findOverlappingBookings([]), []);
});

test('findOverlappingBookings: no overlaps on distinct dates → empty', () => {
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, check_in: '2025-06-15', check_out: '2025-06-18' }),
  ];
  assert.deepEqual(findOverlappingBookings(rows), []);
});

test('findOverlappingBookings: back-to-back is NOT an overlap', () => {
  // Same-day turnover — the invariant every busy property depends on.
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, check_in: '2025-06-13', check_out: '2025-06-16' }),
  ];
  assert.deepEqual(findOverlappingBookings(rows), []);
});

test('findOverlappingBookings: two overlapping bookings on same property → one pair', () => {
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-14' }),
    bk({ id: 2, check_in: '2025-06-12', check_out: '2025-06-16' }),
  ];
  const pairs = findOverlappingBookings(rows);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].map((b) => b.id).sort(), [1, 2]);
});

test('findOverlappingBookings: overlap requires SAME property_id', () => {
  const rows = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-14' }),
    bk({ id: 2, property_id: 2, check_in: '2025-06-10', check_out: '2025-06-14' }),
  ];
  assert.deepEqual(findOverlappingBookings(rows), []);
});

test('findOverlappingBookings: cancelled bookings are ignored', () => {
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-14', status: 'cancelled' }),
    bk({ id: 2, check_in: '2025-06-12', check_out: '2025-06-16' }),
  ];
  assert.deepEqual(findOverlappingBookings(rows), []);
});

test('findOverlappingBookings: blocked-platform bookings are ignored', () => {
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-14', platform: 'Blocked channel' }),
    bk({ id: 2, check_in: '2025-06-12', check_out: '2025-06-16' }),
  ];
  assert.deepEqual(findOverlappingBookings(rows), []);
});

test('findOverlappingBookings: three overlapping bookings on same property → three pairs', () => {
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-20' }),
    bk({ id: 2, check_in: '2025-06-12', check_out: '2025-06-14' }),
    bk({ id: 3, check_in: '2025-06-15', check_out: '2025-06-18' }),
  ];
  const pairs = findOverlappingBookings(rows);
  // 1 overlaps with 2 and 3; 2 does not overlap with 3 → 2 pairs.
  const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort().join(',')).sort();
  assert.deepEqual(pairIds, ['1,2', '1,3']);
});

test('findOverlappingBookings: each unordered pair reported exactly once', () => {
  const rows = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-15' }),
    bk({ id: 2, check_in: '2025-06-12', check_out: '2025-06-16' }),
  ];
  assert.equal(findOverlappingBookings(rows).length, 1);
});

// --- findInvalidBookingDates --------------------------------------------

test('findInvalidBookingDates: check_in == check_out → flagged (zero-night stay)', () => {
  const bad = bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-10' });
  assert.deepEqual(findInvalidBookingDates([bad]).map((b) => b.id), [1]);
});

test('findInvalidBookingDates: check_in > check_out → flagged (negative-length stay)', () => {
  const bad = bk({ id: 2, check_in: '2025-06-13', check_out: '2025-06-10' });
  assert.deepEqual(findInvalidBookingDates([bad]).map((b) => b.id), [2]);
});

test('findInvalidBookingDates: valid stays are not flagged', () => {
  assert.deepEqual(findInvalidBookingDates([bk()]), []);
});

// --- findCleanerDoubleBookings ------------------------------------------

function job(overrides = {}) {
  return {
    id: 0,
    cleaner_id: 1,
    cleaning_date: '2025-06-13',
    status: 'pending',
    ...overrides,
  };
}

test('findCleanerDoubleBookings: single job per (cleaner, day) → no dupes', () => {
  const jobs = [
    job({ id: 1, cleaner_id: 1, cleaning_date: '2025-06-13' }),
    job({ id: 2, cleaner_id: 2, cleaning_date: '2025-06-13' }),
    job({ id: 3, cleaner_id: 1, cleaning_date: '2025-06-14' }),
  ];
  assert.deepEqual(findCleanerDoubleBookings(jobs), []);
});

test('findCleanerDoubleBookings: same cleaner + same day + both non-completed → flagged', () => {
  const jobs = [
    job({ id: 1, cleaner_id: 5, cleaning_date: '2025-06-13' }),
    job({ id: 2, cleaner_id: 5, cleaning_date: '2025-06-13' }),
  ];
  const dupes = findCleanerDoubleBookings(jobs);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].cleaner_id, 5);
  assert.equal(dupes[0].cleaning_date, '2025-06-13');
  assert.deepEqual(dupes[0].jobs.map((j) => j.id).sort(), [1, 2]);
});

test('findCleanerDoubleBookings: a completed job does not count', () => {
  const jobs = [
    job({ id: 1, cleaner_id: 5, cleaning_date: '2025-06-13', status: 'completed' }),
    job({ id: 2, cleaner_id: 5, cleaning_date: '2025-06-13', status: 'pending' }),
  ];
  assert.deepEqual(findCleanerDoubleBookings(jobs), []);
});

test('findCleanerDoubleBookings: unassigned (cleaner_id null) jobs never dupe', () => {
  const jobs = [
    job({ id: 1, cleaner_id: null, cleaning_date: '2025-06-13' }),
    job({ id: 2, cleaner_id: null, cleaning_date: '2025-06-13' }),
  ];
  assert.deepEqual(findCleanerDoubleBookings(jobs), []);
});

test('findCleanerDoubleBookings: accepts Date objects as cleaning_date (pg row shape)', () => {
  // pg returns date columns as JS Date; the detector must handle that as well
  // as YYYY-MM-DD strings.
  const jobs = [
    job({ id: 1, cleaner_id: 5, cleaning_date: new Date('2025-06-13T00:00:00Z') }),
    job({ id: 2, cleaner_id: 5, cleaning_date: '2025-06-13' }),
  ];
  const dupes = findCleanerDoubleBookings(jobs);
  assert.equal(dupes.length, 1);
});
