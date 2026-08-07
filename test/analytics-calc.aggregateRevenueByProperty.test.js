const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateRevenueByProperty } = require('../src/services/analytics-calc');

// Currency-converted booking (as bulkConvert would have produced it).
function bk(overrides = {}) {
  return {
    property_id: 1,
    property_name: 'Sea View',
    check_in: '2025-06-01',
    check_out: '2025-06-04',
    length_of_stay: 3,
    converted_total_price: 3000,
    platform: 'Airbnb',
    ...overrides,
  };
}

test('single booking: one property row with its totals', () => {
  const out = aggregateRevenueByProperty([
    bk({ property_id: 1, property_name: 'Sea View', converted_total_price: 3000, length_of_stay: 3 }),
  ]);
  assert.deepEqual(out, [{
    property_id: 1, property: 'Sea View',
    total: 3000, bookings: 1, nights: 3, top_platform: 'Airbnb',
  }]);
});

test('multiple bookings on same property: revenue/bookings/nights sum', () => {
  const out = aggregateRevenueByProperty([
    bk({ property_id: 1, converted_total_price: 3000, length_of_stay: 3 }),
    bk({ property_id: 1, converted_total_price: 5000, length_of_stay: 5 }),
    bk({ property_id: 1, converted_total_price: 2000, length_of_stay: 2 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].total, 10000);
  assert.equal(out[0].bookings, 3);
  assert.equal(out[0].nights, 10);
});

test('separate properties get separate rows (keyed by property_id, not name)', () => {
  // Regression guard: earlier version used property_name as the key, which
  // would collapse two properties that share a name.
  const out = aggregateRevenueByProperty([
    bk({ property_id: 1, property_name: 'Shared Name', converted_total_price: 1000 }),
    bk({ property_id: 2, property_name: 'Shared Name', converted_total_price: 2000 }),
  ]);
  assert.equal(out.length, 2);
  const p1 = out.find(r => r.property_id === 1);
  const p2 = out.find(r => r.property_id === 2);
  assert.equal(p1.total, 1000);
  assert.equal(p2.total, 2000);
});

test('empty input returns empty array', () => {
  assert.deepEqual(aggregateRevenueByProperty([]), []);
});

test('missing converted_total_price treated as 0', () => {
  const b = bk({ converted_total_price: undefined });
  delete b.converted_total_price;
  const out = aggregateRevenueByProperty([b]);
  assert.equal(out[0].total, 0);
});

test('missing length_of_stay falls back to 1 night', () => {
  const b = bk();
  delete b.length_of_stay;
  const out = aggregateRevenueByProperty([b]);
  assert.equal(out[0].nights, 1);
});

test('top_platform is the most-common platform for that property', () => {
  const out = aggregateRevenueByProperty([
    bk({ property_id: 1, platform: 'Airbnb' }),
    bk({ property_id: 1, platform: 'Airbnb' }),
    bk({ property_id: 1, platform: 'Booking.com' }),
    bk({ property_id: 2, platform: 'VRBO' }),
    bk({ property_id: 2, platform: 'VRBO' }),
    bk({ property_id: 2, platform: 'Airbnb' }),
  ]);
  const p1 = out.find(r => r.property_id === 1);
  const p2 = out.find(r => r.property_id === 2);
  assert.equal(p1.top_platform, 'Airbnb');
  assert.equal(p2.top_platform, 'VRBO');
});

test('top_platform uses canonical names (normalizePlatform), not raw Smoobu strings', () => {
  // 'homeaway' + 'vrbo' both canonicalize to 'VRBO' — treated as one platform.
  const out = aggregateRevenueByProperty([
    bk({ property_id: 1, platform: 'HomeAway' }),
    bk({ property_id: 1, platform: 'vrbo' }),
    bk({ property_id: 1, platform: 'Airbnb' }),
  ]);
  assert.equal(out[0].top_platform, 'VRBO');
});
