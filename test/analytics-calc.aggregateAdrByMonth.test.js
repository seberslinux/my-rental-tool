const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateAdrByMonth } = require('../src/services/analytics-calc');

function bk(overrides = {}) {
  return {
    property_id: 1,
    check_in: '2025-06-01',
    check_out: '2025-06-04',
    length_of_stay: 3,
    converted_total_price: 3000,
    platform: 'Airbnb',
    ...overrides,
  };
}

test('single booking: one month with correct ADR', () => {
  // 3000 / 3 = 1000 ADR.
  const out = aggregateAdrByMonth([
    bk({ check_in: '2025-06-10', converted_total_price: 3000, length_of_stay: 3 }),
  ]);
  assert.deepEqual(out, [{ month: '2025-06', adr: 1000 }]);
});

test('multiple bookings in same month: ADR is total_revenue / total_nights, NOT average of ADRs', () => {
  // Booking A: 4000 revenue, 4 nights → 1000/night
  // Booking B: 1000 revenue, 1 night → 1000/night
  // Weighted ADR = (4000 + 1000) / (4 + 1) = 5000/5 = 1000
  // NOT (1000 + 1000) / 2 = 1000 (same in this case, but the point is which method)
  //
  // Better proof: mix ADRs so simple-avg would give a different answer.
  // Booking A: 6000 revenue, 3 nights → 2000/night
  // Booking B: 1000 revenue, 2 nights → 500/night
  // Weighted:  (6000 + 1000) / (3 + 2) = 7000/5 = 1400
  // Simple avg of nightly rates: (2000 + 500) / 2 = 1250   ← WRONG
  const out = aggregateAdrByMonth([
    bk({ check_in: '2025-06-05', converted_total_price: 6000, length_of_stay: 3 }),
    bk({ check_in: '2025-06-20', converted_total_price: 1000, length_of_stay: 2 }),
  ]);
  assert.equal(out[0].adr, 1400);
});

test('bookings in different months produce separate rows', () => {
  const out = aggregateAdrByMonth([
    bk({ check_in: '2025-06-01', converted_total_price: 3000, length_of_stay: 3 }),
    bk({ check_in: '2025-07-01', converted_total_price: 5000, length_of_stay: 5 }),
  ]);
  const jun = out.find(r => r.month === '2025-06');
  const jul = out.find(r => r.month === '2025-07');
  assert.equal(jun.adr, 1000);
  assert.equal(jul.adr, 1000);
});

test('output is sorted ascending by month', () => {
  const out = aggregateAdrByMonth([
    bk({ check_in: '2025-12-01' }),
    bk({ check_in: '2025-03-01' }),
    bk({ check_in: '2025-08-01' }),
  ]);
  assert.deepEqual(out.map(r => r.month), ['2025-03', '2025-08', '2025-12']);
});

test('booking is attributed to its check-in month (not check-out)', () => {
  // Straddling booking: check_in in June, check_out in July.
  const out = aggregateAdrByMonth([
    bk({ check_in: '2025-06-30', check_out: '2025-07-03', converted_total_price: 3000, length_of_stay: 3 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].month, '2025-06');
});

test('ADR rounds to nearest integer', () => {
  // 1000 / 3 = 333.33... → 333
  const out = aggregateAdrByMonth([
    bk({ check_in: '2025-06-01', converted_total_price: 1000, length_of_stay: 3 }),
  ]);
  assert.equal(out[0].adr, 333);
});

test('empty input returns empty array', () => {
  assert.deepEqual(aggregateAdrByMonth([]), []);
});
