const test = require('node:test');
const assert = require('node:assert/strict');
const { splitItems, MAX_ITEMS } = require('../src/services/list-text');

/**
 * Three things typed into one box are three things.
 *
 * The reported case: "Laundry liquid / Bin liners / Dishwasher tablets"
 * written down the lines of one field, stored as one row. A row is the
 * unit somebody ticks off, so buying the bin liners meant either closing
 * the other two with them or leaving all three open.
 */

test('a line each', () => {
  assert.deepEqual(
    splitItems('Laundry liquid\nBin liners\nDishwasher tablets'),
    ['Laundry liquid', 'Bin liners', 'Dishwasher tablets']
  );
});

test('one thing is still one thing', () => {
  assert.deepEqual(splitItems('Laundry liquid'), ['Laundry liquid']);
});

test('blank lines and stray spacing are not items', () => {
  assert.deepEqual(
    splitItems('  Bin liners  \n\n\n   \nCoffee\n'),
    ['Bin liners', 'Coffee']
  );
});

test('windows line endings split too', () => {
  assert.deepEqual(splitItems('Coffee\r\nMilk'), ['Coffee', 'Milk']);
});

test('bullets people type are not part of the name', () => {
  assert.deepEqual(
    splitItems('- Coffee\n• Milk\n* Sugar\n1. Tea\n2) Rusks'),
    ['Coffee', 'Milk', 'Sugar', 'Tea', 'Rusks']
  );
});

test('a quantity at the start of a line survives', () => {
  // The bullet strip requires whitespace after the marker precisely so
  // this does not become "rolls of bin liners". A number at the front of
  // a shopping list line is far commoner than a numbered list, and
  // eating it would be a silent wrong answer rather than an untidy one.
  assert.deepEqual(
    splitItems('2 rolls of bin liners\n6 towels'),
    ['2 rolls of bin liners', '6 towels']
  );
});

test('an array is accepted as it stands', () => {
  assert.deepEqual(splitItems(['Coffee', ' Milk ', '']), ['Coffee', 'Milk']);
});

test('nothing in, nothing out', () => {
  for (const empty of ['', '   ', '\n\n', null, undefined, []]) {
    assert.deepEqual(splitItems(empty), [], `${JSON.stringify(empty)} is not an item`);
  }
});

test('a paste accident is capped rather than becoming a thousand rows', () => {
  const huge = Array.from({ length: MAX_ITEMS + 25 }, (_, i) => `Item ${i}`).join('\n');
  assert.equal(splitItems(huge).length, MAX_ITEMS);
});
