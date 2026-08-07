const test = require('node:test');
const assert = require('node:assert/strict');
const {
  revenueEarned,
  revenueComing,
  avgRateEarned,
} = require('../src/services/dashboard-calc');

/**
 * KPI-tier aggregations from dashboard-calc.
 *
 * These power GET /api/dashboard/kpis. They operate on currency-converted
 * bookings — `converted_total_price` and `converted_price_per_night` (as
 * produced by exchange-rates.bulkConvert). Cancelled and blocked-platform
 * rows are excluded from every KPI.
 */

// Currency-converted booking factory.
function b(overrides = {}) {
  return {
    property_id: 1,
    check_in: '2025-06-10',
    check_out: '2025-06-13',
    converted_total_price: 3000,
    converted_price_per_night: 1000,
    platform: 'Airbnb',
    status: 'confirmed',
    ...overrides,
  };
}

// --- revenueEarned -------------------------------------------------------

test('revenueEarned: booking checked out inside the window counts', async () => {
  // today = 2025-06-30; window = [2025-05-31, 2025-06-30].
  // Booking checks out 2025-06-13 → inside.
  const rows = [b({ check_out: '2025-06-13', converted_total_price: 3000 })];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 3000);
});

test('revenueEarned: check_out AFTER today is EXCLUDED (that\'s "coming", not "earned")', async () => {
  // The classic bug: filter that includes future bookings inflates revenue.
  const rows = [b({ check_out: '2025-07-10', converted_total_price: 5000 })];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 0);
});

test('revenueEarned: check_out just before window start is EXCLUDED', async () => {
  // Window = [2025-05-31, 2025-06-30]; check_out 2025-05-30 → out.
  const rows = [b({ check_out: '2025-05-30', converted_total_price: 999 })];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 0);
});

test('revenueEarned: check_out ON today is INCLUDED (inclusive boundary)', async () => {
  const rows = [b({ check_out: '2025-06-30', converted_total_price: 1234 })];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 1234);
});

test('revenueEarned: cancelled bookings do NOT count', async () => {
  const rows = [
    b({ check_out: '2025-06-13', converted_total_price: 3000 }),
    b({ check_out: '2025-06-14', converted_total_price: 4000, status: 'cancelled' }),
  ];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 3000);
});

test('revenueEarned: blocked-platform bookings do NOT count', async () => {
  const rows = [
    b({ check_out: '2025-06-13', converted_total_price: 3000 }),
    b({ check_out: '2025-06-14', converted_total_price: 4000, platform: 'Blocked channel' }),
  ];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 3000);
});

test('revenueEarned: uses converted_total_price (NOT raw total_price)', async () => {
  // Multi-currency safety: raw total_price would silently sum ZAR+EUR.
  const rows = [b({ check_out: '2025-06-13', converted_total_price: 3000, total_price: 999999 })];
  assert.equal(revenueEarned(rows, '2025-06-30', 30), 3000);
});

test('revenueEarned: empty input → 0', async () => {
  assert.equal(revenueEarned([], '2025-06-30'), 0);
});

// --- revenueComing -------------------------------------------------------

test('revenueComing: check_out AFTER today is INCLUDED', async () => {
  const rows = [b({ check_out: '2025-07-10', converted_total_price: 5000 })];
  assert.equal(revenueComing(rows, '2025-06-30'), 5000);
});

test('revenueComing: check_out ON today is EXCLUDED (already earned)', async () => {
  const rows = [b({ check_out: '2025-06-30', converted_total_price: 5000 })];
  assert.equal(revenueComing(rows, '2025-06-30'), 0);
});

test('revenueComing: check_out in the past is EXCLUDED', async () => {
  const rows = [b({ check_out: '2025-06-13', converted_total_price: 3000 })];
  assert.equal(revenueComing(rows, '2025-06-30'), 0);
});

test('revenueComing: in-progress guest (check_in past, check_out future) is INCLUDED', async () => {
  // Current guest counts as "money coming in" until they check out.
  const rows = [b({ check_in: '2025-06-25', check_out: '2025-07-05', converted_total_price: 4000 })];
  assert.equal(revenueComing(rows, '2025-06-30'), 4000);
});

test('revenueComing: cancelled and blocked excluded', async () => {
  const rows = [
    b({ check_out: '2025-07-10', converted_total_price: 5000 }),
    b({ check_out: '2025-07-11', converted_total_price: 6000, status: 'cancelled' }),
    b({ check_out: '2025-07-12', converted_total_price: 7000, platform: 'Blocked channel auto' }),
  ];
  assert.equal(revenueComing(rows, '2025-06-30'), 5000);
});

test('revenueComing + revenueEarned partition the set — no double-count, no gap', async () => {
  const rows = [
    b({ check_out: '2025-06-13', converted_total_price: 3000 }),  // earned
    b({ check_out: '2025-06-30', converted_total_price: 4000 }),  // earned (edge)
    b({ check_out: '2025-07-01', converted_total_price: 5000 }),  // coming
    b({ check_out: '2025-07-15', converted_total_price: 6000 }),  // coming
  ];
  const earned = revenueEarned(rows, '2025-06-30', 30);
  const coming = revenueComing(rows, '2025-06-30');
  assert.equal(earned, 7000);
  assert.equal(coming, 11000);
  assert.equal(earned + coming, 18000, 'partitioning invariant');
});

// --- avgRateEarned -------------------------------------------------------

test('avgRateEarned: mean of converted_price_per_night across earned bookings', async () => {
  const rows = [
    b({ check_out: '2025-06-10', converted_price_per_night: 1000 }),
    b({ check_out: '2025-06-20', converted_price_per_night: 1500 }),
  ];
  assert.equal(avgRateEarned(rows, '2025-06-30', 30), 1250);
});

test('avgRateEarned: rounds to nearest integer', async () => {
  const rows = [
    b({ check_out: '2025-06-10', converted_price_per_night: 1000 }),
    b({ check_out: '2025-06-20', converted_price_per_night: 1001 }),
    b({ check_out: '2025-06-25', converted_price_per_night: 999 }),
  ];
  // (1000 + 1001 + 999) / 3 = 1000
  assert.equal(avgRateEarned(rows, '2025-06-30', 30), 1000);
});

test('avgRateEarned: empty set → 0 (no NaN)', async () => {
  assert.equal(avgRateEarned([], '2025-06-30', 30), 0);
});

test('avgRateEarned: future/cancelled/blocked bookings not averaged in', async () => {
  const rows = [
    b({ check_out: '2025-06-13', converted_price_per_night: 1000 }),               // earned
    b({ check_out: '2025-07-10', converted_price_per_night: 5000 }),               // future — excluded
    b({ check_out: '2025-06-14', converted_price_per_night: 9000, status: 'cancelled' }),
    b({ check_out: '2025-06-15', converted_price_per_night: 9000, platform: 'Blocked' }),
  ];
  assert.equal(avgRateEarned(rows, '2025-06-30', 30), 1000);
});
