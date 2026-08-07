const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateRevenueByMonth,
  calcDeductions,
} = require('../src/services/analytics-calc');

// Booking factory. Everything currency-related is pre-converted (as
// exchange-rates.bulkConvert would do) so the aggregator sees only ZAR.
function bk(overrides = {}) {
  return {
    check_in: '2025-06-01',
    check_out: '2025-06-04',
    length_of_stay: 3,
    converted_total_price: 3000,
    platform: 'Direct booking',
    prop_commission_airbnb: 0, bank_charge_airbnb: 0, vat_airbnb: 0,
    prop_commission_booking: 0, bank_charge_booking: 0, vat_booking: 0,
    prop_commission_vrbo: 0, bank_charge_vrbo: 0, vat_vrbo: 0,
    property_vat_rate: 0,
    converted_commission: 0,
    ...overrides,
  };
}

test('aggregates a single booking into its check-in month', () => {
  const rows = aggregateRevenueByMonth(
    [bk({ check_in: '2025-06-10', check_out: '2025-06-13' })],
    '2025-06-30'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].month, '2025-06');
  assert.equal(rows[0].total, 3000);
  assert.equal(rows[0].bookings, 1);
  assert.equal(rows[0].nights, 3);
});

test('paid vs booked split is driven by check_out vs todayStr', () => {
  // June booking (checked out) + August booking (future) — cutoff = 2025-07-15
  const rows = aggregateRevenueByMonth(
    [
      bk({ check_in: '2025-06-01', check_out: '2025-06-04', converted_total_price: 3000 }),
      bk({ check_in: '2025-08-01', check_out: '2025-08-05', converted_total_price: 4000 }),
    ],
    '2025-07-15'
  );
  const june = rows.find(r => r.month === '2025-06');
  const aug = rows.find(r => r.month === '2025-08');
  assert.equal(june.paid, 3000);
  assert.equal(june.booked, 0);
  assert.equal(aug.paid, 0);
  assert.equal(aug.booked, 4000);
});

test('checkout ON todayStr counts as paid (inclusive boundary)', () => {
  const rows = aggregateRevenueByMonth(
    [bk({ check_in: '2025-06-28', check_out: '2025-06-30', converted_total_price: 1500 })],
    '2025-06-30'
  );
  assert.equal(rows[0].paid, 1500);
  assert.equal(rows[0].booked, 0);
});

test('per-month totals equal sum of per-booking values (invariant)', () => {
  const bookings = [
    bk({ check_in: '2025-06-01', check_out: '2025-06-04', converted_total_price: 3000, length_of_stay: 3 }),
    bk({ check_in: '2025-06-15', check_out: '2025-06-20', converted_total_price: 5000, length_of_stay: 5 }),
    bk({ check_in: '2025-07-01', check_out: '2025-07-08', converted_total_price: 7000, length_of_stay: 7 }),
  ];
  const rows = aggregateRevenueByMonth(bookings, '2025-08-01');

  const totalRev = rows.reduce((s, r) => s + r.total, 0);
  const totalNights = rows.reduce((s, r) => s + r.nights, 0);
  const totalBookings = rows.reduce((s, r) => s + r.bookings, 0);

  assert.equal(totalRev, 15000);
  assert.equal(totalNights, 15);
  assert.equal(totalBookings, 3);
});

test('per-month deductions equal sum of calcDeductions across the month', () => {
  const bookings = [
    // Airbnb: 4000 * 15% comm = 600
    bk({
      check_in: '2025-06-01', check_out: '2025-06-05',
      converted_total_price: 4000, platform: 'Airbnb',
      prop_commission_airbnb: 15,
    }),
    // Booking.com: 2000 * 10% = 200
    bk({
      check_in: '2025-06-10', check_out: '2025-06-12',
      converted_total_price: 2000, platform: 'Booking.com',
      prop_commission_booking: 10,
    }),
    // Direct: no deductions
    bk({
      check_in: '2025-06-20', check_out: '2025-06-22',
      converted_total_price: 1500, platform: 'Direct booking',
    }),
  ];
  const rows = aggregateRevenueByMonth(bookings, '2025-07-01');

  const june = rows.find(r => r.month === '2025-06');
  const expectedFromCalc = bookings.reduce((s, b) => s + calcDeductions(b), 0);

  assert.equal(june.deductions, expectedFromCalc);
  assert.equal(june.deductions, 800);
});

test('gross - deductions is well-defined (gross >= deductions on realistic input)', () => {
  const bookings = [
    bk({ check_in: '2025-06-01', check_out: '2025-06-05', converted_total_price: 4000, platform: 'Airbnb', prop_commission_airbnb: 15, bank_charge_airbnb: 2, vat_airbnb: 15 }),
    bk({ check_in: '2025-07-01', check_out: '2025-07-05', converted_total_price: 5000, platform: 'Booking.com', prop_commission_booking: 12, vat_booking: 15 }),
  ];
  const rows = aggregateRevenueByMonth(bookings, '2025-08-01');
  for (const r of rows) {
    assert.ok(r.total >= r.deductions, `net went negative in ${r.month}: total=${r.total}, deductions=${r.deductions}`);
    assert.equal(r.total, r.paid + r.booked, `paid+booked mismatch in ${r.month}`);
  }
});

test('gaps between first and last month are filled with zero-value entries', () => {
  const rows = aggregateRevenueByMonth(
    [
      bk({ check_in: '2025-01-15', check_out: '2025-01-18', converted_total_price: 1000 }),
      bk({ check_in: '2025-04-10', check_out: '2025-04-12', converted_total_price: 2000 }),
    ],
    '2025-12-31'
  );
  // Expect Jan, Feb, Mar, Apr — all four months present, Feb & Mar zeroed
  assert.deepEqual(rows.map(r => r.month), ['2025-01', '2025-02', '2025-03', '2025-04']);
  assert.equal(rows[1].total, 0);
  assert.equal(rows[1].bookings, 0);
  assert.equal(rows[2].total, 0);
});

test('gap-filling crosses year boundaries', () => {
  const rows = aggregateRevenueByMonth(
    [
      bk({ check_in: '2024-11-01', check_out: '2024-11-03', converted_total_price: 1000 }),
      bk({ check_in: '2025-02-01', check_out: '2025-02-03', converted_total_price: 2000 }),
    ],
    '2025-06-01'
  );
  assert.deepEqual(rows.map(r => r.month), ['2024-11', '2024-12', '2025-01', '2025-02']);
});

test('single-month input does not emit any filler months', () => {
  const rows = aggregateRevenueByMonth(
    [bk({ check_in: '2025-06-01', check_out: '2025-06-03', converted_total_price: 1000 })],
    '2025-12-01'
  );
  assert.equal(rows.length, 1);
});

test('empty input returns empty array', () => {
  assert.deepEqual(aggregateRevenueByMonth([], '2025-06-01'), []);
});

test('length_of_stay missing falls back to 1 night', () => {
  const b = bk({ check_in: '2025-06-01', check_out: '2025-06-02', converted_total_price: 500 });
  delete b.length_of_stay;
  const rows = aggregateRevenueByMonth([b], '2025-07-01');
  assert.equal(rows[0].nights, 1);
});

test('first_checkin / last_checkout track earliest/latest within the month', () => {
  const rows = aggregateRevenueByMonth(
    [
      bk({ check_in: '2025-06-20', check_out: '2025-06-25', converted_total_price: 1000 }),
      bk({ check_in: '2025-06-05', check_out: '2025-06-08', converted_total_price: 500 }),
      bk({ check_in: '2025-06-15', check_out: '2025-06-30', converted_total_price: 2000 }),
    ],
    '2025-07-01'
  );
  const june = rows.find(r => r.month === '2025-06');
  assert.equal(june.first_checkin, '2025-06-05');
  assert.equal(june.last_checkout, '2025-06-30');
});
