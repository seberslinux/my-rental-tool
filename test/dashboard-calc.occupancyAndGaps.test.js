const test = require('node:test');
const assert = require('node:assert/strict');
const {
  occupancyByProperty,
  detectGaps,
} = require('../src/services/dashboard-calc');

function bk(overrides = {}) {
  return {
    id: 1,
    property_id: 1,
    check_in: '2025-06-10',
    check_out: '2025-06-13',
    platform: 'Airbnb',
    status: 'confirmed',
    ...overrides,
  };
}

// --- occupancyByProperty --------------------------------------------------
// Booked nights within the window [todayStr, todayStr + days).
// The half-open window matches how [check_in, check_out) is interpreted.

test('occupancyByProperty: booking fully inside the window counts every night', () => {
  // 3 nights inside a 30-night window = 3/30 = 10%.
  const bookings = [bk({ property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' })];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 3);
  assert.equal(rows[0].occupancy_rate, 10);
});

test('occupancyByProperty: booking straddling the window START is clipped', () => {
  // Booking is Jun 5–15 (10 nights). Window starts Jun 10. Only Jun 10–15 = 5 nights count.
  const bookings = [bk({ property_id: 1, check_in: '2025-06-05', check_out: '2025-06-15' })];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 5);
});

test('occupancyByProperty: booking straddling the window END is clipped', () => {
  // Booking is Jul 5–15 (10 nights). Window ends Jul 10 (exclusive). Only Jul 5–10 = 5 nights.
  const bookings = [bk({ property_id: 1, check_in: '2025-07-05', check_out: '2025-07-15' })];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 5);
});

test('occupancyByProperty: booking entirely before window contributes 0', () => {
  const bookings = [bk({ property_id: 1, check_in: '2025-05-01', check_out: '2025-05-05' })];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 0);
  assert.equal(rows[0].occupancy_rate, 0);
});

test('occupancyByProperty: booking entirely after window contributes 0', () => {
  const bookings = [bk({ property_id: 1, check_in: '2025-08-01', check_out: '2025-08-05' })];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 0);
});

test('occupancyByProperty: multiple bookings on the same property accumulate', () => {
  // 3 + 4 = 7 nights inside a 30-night window = 7/30 ≈ 23%.
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-20', check_out: '2025-06-24' }),
  ];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 7);
  assert.equal(rows[0].occupancy_rate, Math.round((7 / 30) * 100));
});

test('occupancyByProperty: separate properties have independent counts', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' }), // 3 nights on prop 1
    bk({ id: 2, property_id: 2, check_in: '2025-06-15', check_out: '2025-06-25' }), // 10 nights on prop 2
  ];
  const rows = occupancyByProperty(bookings, [1, 2], '2025-06-10', 30);
  const p1 = rows.find(r => r.property_id === 1);
  const p2 = rows.find(r => r.property_id === 2);
  assert.equal(p1.booked_nights, 3);
  assert.equal(p2.booked_nights, 10);
});

test('occupancyByProperty: property with no bookings returns 0%', () => {
  const rows = occupancyByProperty([], [1, 2], '2025-06-10', 30);
  assert.deepEqual(rows.map(r => r.occupancy_rate), [0, 0]);
});

test('occupancyByProperty: cancelled and blocked bookings do not count', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-20', check_out: '2025-06-25', status: 'cancelled' }),
    bk({ id: 3, property_id: 1, check_in: '2025-06-25', check_out: '2025-06-28', platform: 'Blocked' }),
  ];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 3); // only booking 1 counts
});

test('occupancyByProperty: fully booked → 100%', () => {
  // 30 nights covering the whole window.
  const bookings = [bk({ property_id: 1, check_in: '2025-06-10', check_out: '2025-07-10' })];
  const rows = occupancyByProperty(bookings, [1], '2025-06-10', 30);
  assert.equal(rows[0].booked_nights, 30);
  assert.equal(rows[0].occupancy_rate, 100);
});

// --- detectGaps -----------------------------------------------------------
// Gap between two consecutive bookings on the same property = number of
// nights from booking A's check_out to booking B's check_in.

test('detectGaps: 2-night gap between consecutive bookings is reported', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' }), // 2-night gap
  ];
  const gaps = detectGaps(bookings, '2025-06-01');
  assert.deepEqual(gaps, [
    { property_id: 1, gap_start: '2025-06-13', gap_end: '2025-06-15', nights: 2 },
  ]);
});

test('detectGaps: back-to-back (same-day turnover) is 0 nights, not reported', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-13', check_out: '2025-06-16' }),
  ];
  assert.deepEqual(detectGaps(bookings, '2025-06-01'), []);
});

test('detectGaps: gap of 4 nights exceeds default max (3), not reported', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-17', check_out: '2025-06-20' }),
  ];
  assert.deepEqual(detectGaps(bookings, '2025-06-01'), []);
});

test('detectGaps: gaps ending before today are excluded', () => {
  // The first booking already checked out before "today"; no reminder to fill.
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-01', check_out: '2025-06-05' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-08', check_out: '2025-06-10' }), // 3-night gap ending before today
  ];
  assert.deepEqual(detectGaps(bookings, '2025-06-15'), []);
});

test('detectGaps: gaps are per-property (no cross-property "gaps")', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 2, check_in: '2025-06-15', check_out: '2025-06-18' }),
  ];
  assert.deepEqual(detectGaps(bookings, '2025-06-01'), []);
});

test('detectGaps: multiple gaps across multiple properties', () => {
  const bookings = [
    // Property 1: 2-night gap
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' }),
    // Property 2: 1-night gap
    bk({ id: 3, property_id: 2, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 4, property_id: 2, check_in: '2025-06-14', check_out: '2025-06-17' }),
  ];
  const gaps = detectGaps(bookings, '2025-06-01');
  assert.equal(gaps.length, 2);
  const g1 = gaps.find(g => g.property_id === 1);
  const g2 = gaps.find(g => g.property_id === 2);
  assert.equal(g1.nights, 2);
  assert.equal(g2.nights, 1);
});

test('detectGaps: cancelled and blocked bookings are ignored in ordering', () => {
  // Without the filter, the blocked block in the middle would prevent gap detection.
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-13', check_out: '2025-06-15', platform: 'Blocked' }),
    bk({ id: 3, property_id: 1, check_in: '2025-06-15', check_out: '2025-06-18' }),
  ];
  const gaps = detectGaps(bookings, '2025-06-01');
  // Blocked booking ignored → real gap is bk1.check_out (13th) to bk3.check_in (15th) = 2 nights
  assert.deepEqual(gaps, [
    { property_id: 1, gap_start: '2025-06-13', gap_end: '2025-06-15', nights: 2 },
  ]);
});

test('detectGaps: custom min/max nights', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-18', check_out: '2025-06-20' }), // 5 nights
  ];
  assert.deepEqual(detectGaps(bookings, '2025-06-01', { minNights: 4, maxNights: 7 }).length, 1);
  assert.deepEqual(detectGaps(bookings, '2025-06-01', { minNights: 1, maxNights: 3 }).length, 0);
});
