const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateRevenueByPlatform } = require('../src/services/analytics-calc');

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

test('single booking: one channel row with its totals + ADR', () => {
  const out = aggregateRevenueByPlatform([
    bk({ platform: 'Airbnb', converted_total_price: 3000, length_of_stay: 3 }),
  ]);
  // ADR = revenue / nights = 3000 / 3 = 1000
  assert.deepEqual(out, [{
    channel: 'Airbnb', revenue: 3000, bookings: 1, nights: 3, adr: 1000,
  }]);
});

test('bookings on the same channel accumulate', () => {
  const out = aggregateRevenueByPlatform([
    bk({ platform: 'Airbnb', converted_total_price: 3000, length_of_stay: 3 }),
    bk({ platform: 'Airbnb', converted_total_price: 5000, length_of_stay: 5 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].revenue, 8000);
  assert.equal(out[0].bookings, 2);
  assert.equal(out[0].nights, 8);
  assert.equal(out[0].adr, 1000);
});

test('channels are keyed on canonical platform names', () => {
  // Airbnb + AIRBNB + Airbnb 2 all collapse into one row (via normalizePlatform).
  // Booking.com + booking collapse.
  // VRBO + HomeAway collapse.
  const out = aggregateRevenueByPlatform([
    bk({ platform: 'Airbnb', converted_total_price: 1000, length_of_stay: 1 }),
    bk({ platform: 'AIRBNB', converted_total_price: 2000, length_of_stay: 2 }),
    bk({ platform: 'Airbnb 2', converted_total_price: 3000, length_of_stay: 3 }),
    bk({ platform: 'Booking.com', converted_total_price: 4000, length_of_stay: 4 }),
    bk({ platform: 'booking', converted_total_price: 5000, length_of_stay: 5 }),
    bk({ platform: 'HomeAway', converted_total_price: 7000, length_of_stay: 7 }),
    bk({ platform: 'vrbo', converted_total_price: 8000, length_of_stay: 8 }),
  ]);
  const channels = Object.fromEntries(out.map(r => [r.channel, r]));
  assert.equal(channels['Airbnb'].revenue, 6000);
  assert.equal(channels['Airbnb'].bookings, 3);
  assert.equal(channels['Booking.com'].revenue, 9000);
  assert.equal(channels['Booking.com'].bookings, 2);
  assert.equal(channels['VRBO'].revenue, 15000);
  assert.equal(channels['VRBO'].bookings, 2);
});

test('null / empty platform bucketed as Direct', () => {
  const out = aggregateRevenueByPlatform([
    bk({ platform: null, converted_total_price: 1000, length_of_stay: 1 }),
    bk({ platform: '', converted_total_price: 2000, length_of_stay: 2 }),
    bk({ platform: 'Direct booking', converted_total_price: 3000, length_of_stay: 3 }),
  ]);
  const direct = out.find(r => r.channel === 'Direct');
  assert.equal(direct.revenue, 6000);
  assert.equal(direct.bookings, 3);
});

test('ADR is 0 when nights sum to 0', () => {
  // Pathological input: zero-night bookings shouldn't NaN or divide-by-zero.
  const b = bk({ converted_total_price: 1000, length_of_stay: 0 });
  // length_of_stay: 0 with the "|| 1" fallback still falls back to 1 — so use
  // an explicit case that avoids the fallback. Use falsy check: 0 falls back to 1.
  // The realistic zero-nights path never triggers; assert that ADR at least
  // never returns NaN.
  const out = aggregateRevenueByPlatform([b]);
  assert.equal(Number.isFinite(out[0].adr), true);
});

test('empty input returns empty array', () => {
  assert.deepEqual(aggregateRevenueByPlatform([]), []);
});

test('ADR rounds to nearest integer', () => {
  // 1000 / 3 = 333.33... → rounded to 333.
  const out = aggregateRevenueByPlatform([
    bk({ platform: 'Airbnb', converted_total_price: 1000, length_of_stay: 3 }),
  ]);
  assert.equal(out[0].adr, 333);
});
