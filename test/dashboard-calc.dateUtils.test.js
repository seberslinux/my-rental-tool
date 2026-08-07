const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, daysBetween } = require('../src/services/dashboard-calc');

// Date arithmetic. Extracted into their own file because occupancy, gap
// detection, and upcoming-window derivations all depend on these two
// primitives being exactly right — an off-by-one here silently drifts every
// number that reaches the dashboard.

test('addDays: 0 returns same date', () => {
  assert.equal(addDays('2025-06-15', 0), '2025-06-15');
});

test('addDays: +1 rolls to the next day', () => {
  assert.equal(addDays('2025-06-15', 1), '2025-06-16');
});

test('addDays: -1 rolls back a day', () => {
  assert.equal(addDays('2025-06-15', -1), '2025-06-14');
});

test('addDays: crosses month boundary', () => {
  assert.equal(addDays('2025-06-30', 1), '2025-07-01');
});

test('addDays: crosses year boundary', () => {
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
});

test('addDays: handles leap day forward', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
});

test('addDays: handles non-leap February', () => {
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
});

test('addDays: +30 for a typical occupancy window', () => {
  assert.equal(addDays('2025-06-15', 30), '2025-07-15');
});

test('daysBetween: same date → 0', () => {
  assert.equal(daysBetween('2025-06-15', '2025-06-15'), 0);
});

test('daysBetween: consecutive days → 1', () => {
  assert.equal(daysBetween('2025-06-15', '2025-06-16'), 1);
});

test('daysBetween: 3 nights → 3', () => {
  // Typical stay: check_in Jun 15, check_out Jun 18 = 3 nights.
  assert.equal(daysBetween('2025-06-15', '2025-06-18'), 3);
});

test('daysBetween: crosses month → correct night count', () => {
  assert.equal(daysBetween('2025-06-28', '2025-07-03'), 5);
});

test('daysBetween: crosses year → correct night count', () => {
  assert.equal(daysBetween('2024-12-30', '2025-01-05'), 6);
});

test('daysBetween: leap year February handled', () => {
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2025-02-28', '2025-03-01'), 1);
});

test('daysBetween: reverse order returns negative', () => {
  // Callers should guard, but arithmetic must be symmetric.
  assert.equal(daysBetween('2025-06-18', '2025-06-15'), -3);
});
