const test = require('node:test');
const assert = require('node:assert/strict');
const { forwardOccupancy } = require('../src/services/dashboard-calc');

/**
 * Forward occupancy — one row per upcoming calendar month.
 *
 * Exists because a 30-day occupancy figure cannot answer "is my calendar
 * filling up?". An empty month four months out is still sellable; by the
 * time a 30-day window reaches it, it is not.
 */

function b(overrides = {}) {
  return {
    property_id: 1,
    check_in: '2026-09-01',
    check_out: '2026-09-11', // 10 nights
    converted_total_price: 1000,
    platform: 'Direct booking',
    status: 'confirmed',
    ...overrides,
  };
}

// --- shape ---------------------------------------------------------------

test('returns one row per month, starting with the current month', () => {
  const out = forwardOccupancy([], 2, '2026-08-07', 6);
  assert.deepEqual(
    out.map((r) => r.month),
    ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']
  );
});

test('spans the year boundary', () => {
  const out = forwardOccupancy([], 1, '2026-11-15', 4);
  assert.deepEqual(out.map((r) => r.month), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

// --- the current month is partial ---------------------------------------

test('current month counts only the nights still to come', () => {
  // 7 August, 2 properties. August has 31 days, so 25 nights remain
  // (the 7th through the 31st inclusive) → 50 sellable property-nights.
  const out = forwardOccupancy([], 2, '2026-08-07', 1);
  assert.equal(out[0].is_partial, true);
  assert.equal(out[0].nights_available, 50);
});

test('later months use the full month', () => {
  // September has 30 days × 2 properties = 60.
  const out = forwardOccupancy([], 2, '2026-08-07', 2);
  assert.equal(out[1].is_partial, false);
  assert.equal(out[1].nights_available, 60);
});

test('on the 1st, the current month is not partial', () => {
  const out = forwardOccupancy([], 1, '2026-08-01', 1);
  assert.equal(out[0].is_partial, false);
  assert.equal(out[0].nights_available, 31);
});

// --- occupancy arithmetic ------------------------------------------------

test('a fully-contained booking counts its nights against the month', () => {
  // 10 nights in September; 1 property → 10/30 = 33%.
  const out = forwardOccupancy(
    [b({ check_in: '2026-09-01', check_out: '2026-09-11' })],
    1, '2026-08-07', 2
  );
  const sep = out.find((r) => r.month === '2026-09');
  assert.equal(sep.nights_booked, 10);
  assert.equal(sep.nights_available, 30);
  assert.equal(sep.occupancy_rate, 33);
});

test('a booking spanning a month boundary is split across both months', () => {
  // 28 Sep → 3 Oct is 5 nights: 28, 29, 30 Sep (3) and 1, 2 Oct (2).
  const out = forwardOccupancy(
    [b({ check_in: '2026-09-28', check_out: '2026-10-03' })],
    1, '2026-08-07', 3
  );
  assert.equal(out.find((r) => r.month === '2026-09').nights_booked, 3);
  assert.equal(out.find((r) => r.month === '2026-10').nights_booked, 2);
});

test('an empty month reports 0% rather than being omitted', () => {
  // The whole point of the strip — a zero month must be visible.
  const out = forwardOccupancy(
    [b({ check_in: '2026-09-01', check_out: '2026-09-11' })],
    1, '2026-08-07', 4
  );
  const nov = out.find((r) => r.month === '2026-11');
  assert.equal(nov.nights_booked, 0);
  assert.equal(nov.occupancy_rate, 0);
  assert.equal(nov.revenue, 0);
});

test('multiple properties raise the denominator', () => {
  // Same single booking, but two properties to fill → half the rate.
  const booking = b({ check_in: '2026-09-01', check_out: '2026-09-11' });
  const one = forwardOccupancy([booking], 1, '2026-08-07', 2);
  const two = forwardOccupancy([booking], 2, '2026-08-07', 2);
  assert.equal(one.find((r) => r.month === '2026-09').occupancy_rate, 33);
  assert.equal(two.find((r) => r.month === '2026-09').occupancy_rate, 17);
});

test('bookings across different properties accumulate', () => {
  const out = forwardOccupancy(
    [
      b({ property_id: 1, check_in: '2026-09-01', check_out: '2026-09-11' }), // 10
      b({ property_id: 2, check_in: '2026-09-05', check_out: '2026-09-10' }), // 5
    ],
    2, '2026-08-07', 2
  );
  const sep = out.find((r) => r.month === '2026-09');
  assert.equal(sep.nights_booked, 15);
  assert.equal(sep.nights_available, 60);
  assert.equal(sep.occupancy_rate, 25);
});

test('cancelled and blocked bookings do not count', () => {
  const out = forwardOccupancy(
    [
      b({ check_in: '2026-09-01', check_out: '2026-09-11' }),
      b({ check_in: '2026-09-12', check_out: '2026-09-20', status: 'cancelled' }),
      b({ check_in: '2026-09-20', check_out: '2026-09-25', platform: 'Blocked channel' }),
    ],
    1, '2026-08-07', 2
  );
  assert.equal(out.find((r) => r.month === '2026-09').nights_booked, 10);
});

test('past nights of an in-progress stay are excluded from the current month', () => {
  // Stay 01–11 Aug, today is the 7th. Only nights 07–11 remain → 4.
  const out = forwardOccupancy(
    [b({ check_in: '2026-08-01', check_out: '2026-08-11' })],
    1, '2026-08-07', 1
  );
  assert.equal(out[0].nights_booked, 4);
});

// --- revenue -------------------------------------------------------------

test('revenue is pro-rata per month, matching the occupancy split', () => {
  // R1000 over 10 nights = R100/night, split 3 nights Sep / 2 nights Oct.
  const out = forwardOccupancy(
    [b({ check_in: '2026-09-28', check_out: '2026-10-03', converted_total_price: 500 })],
    1, '2026-08-07', 3
  );
  assert.equal(out.find((r) => r.month === '2026-09').revenue, 300);
  assert.equal(out.find((r) => r.month === '2026-10').revenue, 200);
});

// --- degenerate input ----------------------------------------------------

test('no properties → 0% rather than a divide-by-zero', () => {
  const out = forwardOccupancy([], 0, '2026-08-07', 2);
  assert.equal(out[0].nights_available, 0);
  assert.equal(out[0].occupancy_rate, 0);
});

test('no bookings → every month reports 0%', () => {
  const out = forwardOccupancy([], 2, '2026-08-07', 6);
  assert.ok(out.every((r) => r.occupancy_rate === 0 && r.nights_booked === 0));
});
