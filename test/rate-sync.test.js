const test = require('node:test');
const assert = require('node:assert/strict');
const { ratesForApartment, normalizeRate } = require('../src/services/rate-sync');

/**
 * Reading Smoobu's rate payload.
 *
 * This matters more than its size suggests. `daily_rates` was empty in
 * production, so the calendar fell back to inventing a nightly price from
 * `properties.base_price` — R80 on a room selling at R3,012. Anything that
 * silently returns `{}` here puts that blank back, so the shapes Smoobu
 * actually sends are pinned.
 */

test('rates nested under `data` are found', () => {
  const payload = { data: { 42: { '2026-08-08': { price: 3012 } } } };
  assert.deepEqual(ratesForApartment(payload, 42), { '2026-08-08': { price: 3012 } });
});

test('rates keyed at the top level are found', () => {
  const payload = { 42: { '2026-08-08': { price: 3012 } } };
  assert.deepEqual(ratesForApartment(payload, 42), { '2026-08-08': { price: 3012 } });
});

test('an unknown apartment yields no rates rather than throwing', () => {
  assert.deepEqual(ratesForApartment({ data: { 7: {} } }, 42), {});
});

test('a null or empty response yields no rates', () => {
  assert.deepEqual(ratesForApartment(null, 42), {});
  assert.deepEqual(ratesForApartment({}, 42), {});
});

// --- field shapes --------------------------------------------------------

test('snake_case and camelCase min-stay are both read', () => {
  assert.equal(normalizeRate({ price: 100, min_length_of_stay: 3 }).minStay, 3);
  assert.equal(normalizeRate({ price: 100, minLengthOfStay: 3 }).minStay, 3);
});

test('daily_price is accepted as an alias for price', () => {
  assert.equal(normalizeRate({ daily_price: 2500 }).price, 2500);
});

test('a missing `available` means available', () => {
  // Smoobu omits the flag on open days; defaulting to closed would grey out
  // the whole forward calendar.
  assert.equal(normalizeRate({ price: 100 }).available, 1);
});

test('available:false is preserved as closed', () => {
  assert.equal(normalizeRate({ price: 100, available: false }).available, 0);
});

test('a missing price is 0, not NaN', () => {
  // NaN would render as "R NaN" in a calendar cell.
  assert.equal(normalizeRate({}).price, 0);
  assert.equal(normalizeRate(null).price, 0);
});

test('string prices from the API are coerced to numbers', () => {
  assert.equal(normalizeRate({ price: '3012.50' }).price, 3012.5);
});

test('min stay defaults to 1 when absent or zero', () => {
  assert.equal(normalizeRate({ price: 100 }).minStay, 1);
  assert.equal(normalizeRate({ price: 100, min_length_of_stay: 0 }).minStay, 1);
});
