const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateByName } = require('../src/services/school-holidays');

/**
 * Collapsing per-region school-holiday rows into one demand window.
 *
 * Germany staggers school holidays across its sixteen states on purpose, so
 * the API returns summer 2026 as sixteen separate rows spanning late June
 * to mid-September. Sixteen rows is noise; the eleven-week window is the
 * signal — that is the period a German family can fly to Cape Town.
 */

const row = (name, startDate, endDate, subs = []) => ({
  name: [{ language: 'EN', text: name }],
  startDate,
  endDate,
  subdivisions: subs.map((code) => ({ code, shortName: code })),
});

test('staggered state rows collapse to one span, earliest start to latest end', () => {
  const out = aggregateByName([
    row('Summer Holidays', '2026-06-29', '2026-08-08', ['DE-NW']),
    row('Summer Holidays', '2026-07-09', '2026-08-22', ['DE-BY']),
    row('Summer Holidays', '2026-08-01', '2026-09-14', ['DE-BW']),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, '2026-06-29');
  assert.equal(out[0].end, '2026-09-14');
});

test('the region count is carried so the span reads as staggered, not national', () => {
  // Without this the eleven-week range looks like the whole country shuts
  // down for a quarter of the year.
  const out = aggregateByName([
    row('Summer Holidays', '2026-06-29', '2026-08-08', ['DE-NW']),
    row('Summer Holidays', '2026-07-09', '2026-08-22', ['DE-BY']),
  ]);
  assert.equal(out[0].regions, 2);
});

test('casing differences do not split one window in two', () => {
  // The API really does return both "Summer Holidays" and "Summer holidays"
  // for the same break, which would otherwise produce two ranges.
  const out = aggregateByName([
    row('Summer Holidays', '2026-06-29', '2026-08-08', ['DE-NW']),
    row('Summer holidays', '2026-07-09', '2026-09-14', ['DE-BY']),
  ]);
  assert.equal(out.length, 1, 'expected one window, not one per spelling');
  assert.equal(out[0].end, '2026-09-14');
});

test('different holidays stay separate', () => {
  const out = aggregateByName([
    row('Easter Holidays', '2026-03-30', '2026-04-10', ['DE-NW']),
    row('Summer Holidays', '2026-06-29', '2026-08-08', ['DE-NW']),
  ]);
  assert.deepEqual(out.map((h) => h.name), ['Easter Holidays', 'Summer Holidays']);
});

test('output is ordered by start date', () => {
  const out = aggregateByName([
    row('Summer Holidays', '2026-06-29', '2026-08-08', ['DE-NW']),
    row('Easter Holidays', '2026-03-30', '2026-04-10', ['DE-NW']),
    row('Autumn Holidays', '2026-10-12', '2026-10-24', ['DE-NW']),
  ]);
  assert.deepEqual(out.map((h) => h.start), ['2026-03-30', '2026-06-29', '2026-10-12']);
});

test('a nationwide holiday needs no subdivisions to count', () => {
  // South Africa publishes term dates nationally, so rows carry no
  // subdivisions at all.
  const out = aggregateByName([
    { name: [{ text: 'Winter Break' }], startDate: '2026-06-27', endDate: '2026-07-20', nationwide: true },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].nationwide, true);
  assert.equal(out[0].regions, 1);
});

test('a single-day break keeps start and end equal', () => {
  const out = aggregateByName([
    { name: [{ text: 'Special School Holiday' }], startDate: '2026-06-15', endDate: '2026-06-15', nationwide: true },
  ]);
  assert.equal(out[0].start, '2026-06-15');
  assert.equal(out[0].end, '2026-06-15');
});

test('a missing end date falls back to the start', () => {
  const out = aggregateByName([
    { name: [{ text: 'Break' }], startDate: '2026-06-15', nationwide: true },
  ]);
  assert.equal(out[0].end, '2026-06-15');
});

test('rows without a name or start are skipped rather than crashing', () => {
  const out = aggregateByName([
    { name: [], startDate: '2026-06-15' },
    { name: [{ text: 'Valid' }] },
    row('Summer Holidays', '2026-06-29', '2026-08-08', ['DE-NW']),
  ]);
  assert.deepEqual(out.map((h) => h.name), ['Summer Holidays']);
});

test('empty input returns empty', () => {
  assert.deepEqual(aggregateByName([]), []);
});
