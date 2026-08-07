const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateRevenueByMonth,
  aggregateRevenueByProperty,
  aggregateRevenueByPlatform,
  aggregateAdrByMonth,
  portfolioTotalRevenue,
} = require('../src/services/analytics-calc');

/**
 * Cross-facet reconciliation invariants.
 *
 * The analytics dashboard shows the same revenue figure sliced by multiple
 * dimensions — by month, by property, by platform. Users see all three at once
 * and expect the numbers to reconcile: the totals must be identical whichever
 * slice you sum. Any drift means one of the aggregators dropped a booking,
 * double-counted, or is filtering differently than the others.
 *
 * These tests use one shared fixture — a realistic mixed portfolio — and
 * assert equality across every facet, so any regression in any aggregator
 * fails at least one of these tests.
 */

// A realistic fixture: 2 properties × 3 platforms × 6 months. All amounts
// currency-converted (as bulkConvert would produce).
const FIXTURE = [
  // Property 1 — Sea View
  { property_id: 1, property_name: 'Sea View', check_in: '2025-01-05', check_out: '2025-01-08', length_of_stay: 3, converted_total_price: 3000, platform: 'Airbnb' },
  { property_id: 1, property_name: 'Sea View', check_in: '2025-02-10', check_out: '2025-02-14', length_of_stay: 4, converted_total_price: 4000, platform: 'Airbnb' },
  { property_id: 1, property_name: 'Sea View', check_in: '2025-03-01', check_out: '2025-03-06', length_of_stay: 5, converted_total_price: 6000, platform: 'Booking.com' },
  { property_id: 1, property_name: 'Sea View', check_in: '2025-03-20', check_out: '2025-03-22', length_of_stay: 2, converted_total_price: 2500, platform: 'Direct booking' },
  { property_id: 1, property_name: 'Sea View', check_in: '2025-05-15', check_out: '2025-05-20', length_of_stay: 5, converted_total_price: 7500, platform: 'Airbnb' },
  // Property 2 — Garden Cottage
  { property_id: 2, property_name: 'Garden Cottage', check_in: '2025-01-20', check_out: '2025-01-25', length_of_stay: 5, converted_total_price: 3500, platform: 'VRBO' },
  { property_id: 2, property_name: 'Garden Cottage', check_in: '2025-04-01', check_out: '2025-04-04', length_of_stay: 3, converted_total_price: 2100, platform: 'HomeAway' },  // normalizes to VRBO
  { property_id: 2, property_name: 'Garden Cottage', check_in: '2025-04-10', check_out: '2025-04-17', length_of_stay: 7, converted_total_price: 8400, platform: 'Airbnb' },
  { property_id: 2, property_name: 'Garden Cottage', check_in: '2025-06-01', check_out: '2025-06-05', length_of_stay: 4, converted_total_price: 5000, platform: 'Booking.com' },
];

const EXPECTED_TOTAL = 3000 + 4000 + 6000 + 2500 + 7500 + 3500 + 2100 + 8400 + 5000;
const EXPECTED_BOOKINGS = FIXTURE.length;
const EXPECTED_NIGHTS = 3 + 4 + 5 + 2 + 5 + 5 + 3 + 7 + 4;

// Utility to sum a numeric field across an array of rows.
const sumBy = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0);

test('reconciliation: portfolioTotalRevenue matches hand-computed total', () => {
  assert.equal(portfolioTotalRevenue(FIXTURE), EXPECTED_TOTAL);
});

test('reconciliation: sum(revenue by month) === portfolio total', () => {
  const rows = aggregateRevenueByMonth(FIXTURE, '2025-12-31');
  assert.equal(sumBy(rows, 'total'), EXPECTED_TOTAL);
});

test('reconciliation: sum(revenue by property) === portfolio total', () => {
  const rows = aggregateRevenueByProperty(FIXTURE);
  assert.equal(sumBy(rows, 'total'), EXPECTED_TOTAL);
});

test('reconciliation: sum(revenue by platform) === portfolio total', () => {
  const rows = aggregateRevenueByPlatform(FIXTURE);
  assert.equal(sumBy(rows, 'revenue'), EXPECTED_TOTAL);
});

test('reconciliation: all facets produce identical totals (transitively equal)', () => {
  // The core invariant, stated directly: any drift between any pair fails.
  const byMonth = sumBy(aggregateRevenueByMonth(FIXTURE, '2025-12-31'), 'total');
  const byProperty = sumBy(aggregateRevenueByProperty(FIXTURE), 'total');
  const byPlatform = sumBy(aggregateRevenueByPlatform(FIXTURE), 'revenue');
  const portfolio = portfolioTotalRevenue(FIXTURE);
  assert.equal(byMonth, byProperty, 'by-month vs by-property drift');
  assert.equal(byProperty, byPlatform, 'by-property vs by-platform drift');
  assert.equal(byPlatform, portfolio, 'by-platform vs portfolio drift');
});

test('reconciliation: bookings count is identical across facets', () => {
  // Same invariant on the booking count — a dropped or double-counted booking
  // shows up as a count mismatch too.
  const byMonth = sumBy(aggregateRevenueByMonth(FIXTURE, '2025-12-31'), 'bookings');
  const byProperty = sumBy(aggregateRevenueByProperty(FIXTURE), 'bookings');
  const byPlatform = sumBy(aggregateRevenueByPlatform(FIXTURE), 'bookings');
  assert.equal(byMonth, EXPECTED_BOOKINGS);
  assert.equal(byProperty, EXPECTED_BOOKINGS);
  assert.equal(byPlatform, EXPECTED_BOOKINGS);
});

test('reconciliation: nights count is identical across facets', () => {
  const byMonth = sumBy(aggregateRevenueByMonth(FIXTURE, '2025-12-31'), 'nights');
  const byProperty = sumBy(aggregateRevenueByProperty(FIXTURE), 'nights');
  const byPlatform = sumBy(aggregateRevenueByPlatform(FIXTURE), 'nights');
  assert.equal(byMonth, EXPECTED_NIGHTS);
  assert.equal(byProperty, EXPECTED_NIGHTS);
  assert.equal(byPlatform, EXPECTED_NIGHTS);
});

test('reconciliation: per-facet expected values (hand-computed)', () => {
  // Extra pinning so a wrong aggregation that happens to sum to the right
  // portfolio total (unlikely but possible) still fails.

  // By property: 1=23000, 2=19000
  const byProp = Object.fromEntries(
    aggregateRevenueByProperty(FIXTURE).map(r => [r.property_id, r.total])
  );
  assert.equal(byProp[1], 3000 + 4000 + 6000 + 2500 + 7500);  // 23000
  assert.equal(byProp[2], 3500 + 2100 + 8400 + 5000);         // 19000

  // By platform: Airbnb=22900, Booking.com=11000, Direct=2500, VRBO=5600
  const byPlat = Object.fromEntries(
    aggregateRevenueByPlatform(FIXTURE).map(r => [r.channel, r.revenue])
  );
  assert.equal(byPlat['Airbnb'], 3000 + 4000 + 7500 + 8400);  // 22900
  assert.equal(byPlat['Booking.com'], 6000 + 5000);           // 11000
  assert.equal(byPlat['Direct'], 2500);
  assert.equal(byPlat['VRBO'], 3500 + 2100);                  // 5600

  // By month: Jan=6500, Feb=4000, Mar=8500, Apr=10500, May=7500, Jun=5000
  const byMonth = Object.fromEntries(
    aggregateRevenueByMonth(FIXTURE, '2025-12-31').map(r => [r.month, r.total])
  );
  assert.equal(byMonth['2025-01'], 3000 + 3500);   // 6500
  assert.equal(byMonth['2025-02'], 4000);
  assert.equal(byMonth['2025-03'], 6000 + 2500);   // 8500
  assert.equal(byMonth['2025-04'], 2100 + 8400);   // 10500
  assert.equal(byMonth['2025-05'], 7500);
  assert.equal(byMonth['2025-06'], 5000);
});

test('reconciliation: ADR per month is consistent with per-month revenue and nights', () => {
  // ADR should equal Math.round(revenue / nights) for that month.
  const revByMonth = new Map(
    aggregateRevenueByMonth(FIXTURE, '2025-12-31').map(r => [r.month, r])
  );
  const adrRows = aggregateAdrByMonth(FIXTURE);
  for (const { month, adr } of adrRows) {
    const r = revByMonth.get(month);
    if (!r) continue;
    const expectedAdr = r.nights > 0 ? Math.round(r.total / r.nights) : 0;
    assert.equal(adr, expectedAdr, `ADR mismatch for ${month}: got ${adr}, expected ${expectedAdr}`);
  }
});
