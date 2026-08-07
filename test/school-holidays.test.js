const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeBreaks } = require('../src/services/school-holidays');

/**
 * Turning the API's rows into travel windows.
 *
 * Two things go wrong without this. The source publishes far more than the
 * big breaks — single-day school-admin closures named "Repentance Day",
 * "Mid-Year Break", "variable holiday" — none of which sends anyone to
 * Cape Town. And grouping rows by name alone fuses unrelated occurrences:
 * two "Special School Holiday" days three months apart became one
 * three-month span, and three separate "additional holiday" days became a
 * six-month one.
 */

const row = (name, startDate, endDate) => ({
  name: [{ language: 'EN', text: name }],
  startDate,
  endDate,
});

// --- merging -------------------------------------------------------------

test('adjacent rows for the same break merge into one span', () => {
  const out = mergeBreaks([
    row('Summer Holidays', '2026-07-09', '2026-07-31'),
    row('Summer Holidays', '2026-08-01', '2026-08-19'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, '2026-07-09');
  assert.equal(out[0].end, '2026-08-19');
});

test('same name far apart stays separate', () => {
  // The bug this prevents: Christmas 2025 and Christmas 2026 merged into a
  // single thirteen-month span, which then sorted to the top of the panel
  // by its 2025 start date.
  const out = mergeBreaks([
    row('Christmas Holidays', '2025-12-17', '2026-01-10'),
    row('Christmas Holidays', '2026-12-19', '2027-01-12'),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].end, '2026-01-10');
  assert.equal(out[1].start, '2026-12-19');
});

test('casing differences do not split one break in two', () => {
  // The API returns both "Summer Holidays" and "Summer holidays".
  const out = mergeBreaks([
    row('Summer Holidays', '2026-07-09', '2026-07-31'),
    row('Summer holidays', '2026-08-01', '2026-08-19'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].end, '2026-08-19');
});

test('different breaks stay separate', () => {
  const out = mergeBreaks([
    row('Easter Holidays', '2026-03-30', '2026-04-10'),
    row('Summer Holidays', '2026-06-29', '2026-08-08'),
  ]);
  assert.deepEqual(out.map((h) => h.name), ['Easter Holidays', 'Summer Holidays']);
});

// --- filtering out non-travel closures -----------------------------------

test('single-day closures are dropped', () => {
  // Hamburg publishes "Mid-Year Break" and Bavaria "Repentance Day", each
  // one day. They are school-admin days, not travel windows.
  const out = mergeBreaks([
    row('Mid-Year Break', '2027-01-29', '2027-01-29'),
    row('Repentance Day', '2026-11-18', '2026-11-18'),
    row('Autumn Holidays', '2026-10-19', '2026-10-30'),
  ]);
  assert.deepEqual(out.map((h) => h.name), ['Autumn Holidays']);
});

test('a break shorter than five nights is dropped', () => {
  const out = mergeBreaks([row('Long Weekend', '2026-05-01', '2026-05-04')]);
  assert.deepEqual(out, []);
});

test('a break of exactly five nights is kept', () => {
  const out = mergeBreaks([row('Autumn Holidays', '2026-11-02', '2026-11-06')]);
  assert.equal(out.length, 1);
});

// --- shape ---------------------------------------------------------------

test('output is ordered by start date', () => {
  const out = mergeBreaks([
    row('Summer Holidays', '2026-06-29', '2026-08-08'),
    row('Easter Holidays', '2026-03-30', '2026-04-10'),
    row('Autumn Holidays', '2026-10-12', '2026-10-24'),
  ]);
  assert.deepEqual(out.map((h) => h.start), ['2026-03-30', '2026-06-29', '2026-10-12']);
});

test('only name, start and end are returned', () => {
  const out = mergeBreaks([row('Summer Holidays', '2026-06-29', '2026-08-08')]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['end', 'name', 'start']);
});

test('a missing end date falls back to the start, and is then too short to keep', () => {
  const out = mergeBreaks([{ name: [{ text: 'Break' }], startDate: '2026-06-15' }]);
  assert.deepEqual(out, []);
});

test('rows without a name or start are skipped rather than throwing', () => {
  const out = mergeBreaks([
    { name: [], startDate: '2026-06-15' },
    { name: [{ text: 'Valid' }] },
    row('Summer Holidays', '2026-06-29', '2026-08-08'),
  ]);
  assert.deepEqual(out.map((h) => h.name), ['Summer Holidays']);
});

test('empty input returns empty', () => {
  assert.deepEqual(mergeBreaks([]), []);
});
