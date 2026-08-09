const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanerDayStatus, parseTime, ymd } = require('../src/services/availability');

/**
 * Who can work when.
 *
 * This rule used to live inside assignCleanerForCheckout, halfway down a
 * loop that also picked a cleaner, checked for clashes and sent a
 * message. The manager's calendar needs the same answer for a hundred
 * days at once, and a second copy written there is how two screens start
 * disagreeing about who is free.
 *
 * The loader is a thin wrapper over two selects; the judgement is here.
 */

/** Build the shape loadAvailability returns, without a database. */
const av = ({ schedule = {}, overrides = {} }) => ({
  schedule: new Map(Object.entries(schedule).map(([id, days]) =>
  [Number(id), new Map(Object.entries(days).map(([d, v]) => [Number(d), v]))])),
  overrides: new Map(Object.entries(overrides).map(([id, dates]) =>
  [Number(id), new Map(Object.entries(dates))])),
});

const NINE_TO_FIVE = { start: 540, end: 1020 };

// --- the weekly pattern --------------------------------------------------

test('a weekday on the schedule is available', () => {
  // 2026-08-11 is a Tuesday.
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } } });
  assert.equal(cleanerDayStatus(a, 1, '2026-08-11').available, true);
});

test('a weekday not on the schedule is not', () => {
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } } });
  // Wednesday.
  const r = cleanerDayStatus(a, 1, '2026-08-12');
  assert.equal(r.available, false);
  assert.match(r.reason, /weekday/);
});

test('a cleaner with no schedule at all is not available', () => {
  assert.equal(cleanerDayStatus(av({}), 99, '2026-08-11').available, false);
});

// --- the exception beats the pattern -------------------------------------

test('an override can take a day away', () => {
  const a = av({
    schedule: { 1: { 2: NINE_TO_FIVE } },
    overrides: { 1: { '2026-08-11': false } },
  });
  const r = cleanerDayStatus(a, 1, '2026-08-11');
  assert.equal(r.available, false);
  assert.match(r.reason, /that day/);
});

test('an override can add a day the pattern does not have', () => {
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } }, overrides: { 1: { '2026-08-12': true } } });
  assert.equal(cleanerDayStatus(a, 1, '2026-08-12').available, true);
});

test('an override only governs its own date', () => {
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } }, overrides: { 1: { '2026-08-11': false } } });
  // The following Tuesday is untouched.
  assert.equal(cleanerDayStatus(a, 1, '2026-08-18').available, true);
});

// --- hours ---------------------------------------------------------------

test('a window outside their hours does not fit', () => {
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } } });
  const r = cleanerDayStatus(a, 1, '2026-08-11', { start: 600, end: 1080 }); // to 18:00
  assert.equal(r.available, false);
  assert.match(r.reason, /hours/);
});

test('a window inside their hours fits', () => {
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } } });
  assert.equal(cleanerDayStatus(a, 1, '2026-08-11', { start: 600, end: 780 }).available, true);
});

test('a day they said yes to ignores the hours', () => {
  // There is nowhere on a calendar day to record "but only until noon",
  // so an override is a blanket yes. This was already how assignment
  // behaved; the test pins it rather than leaving it to be inferred.
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } }, overrides: { 1: { '2026-08-12': true } } });
  assert.equal(cleanerDayStatus(a, 1, '2026-08-12', { start: 0, end: 1439 }).available, true);
});

test('asking without a window asks only whether the day is theirs', () => {
  const a = av({ schedule: { 1: { 2: NINE_TO_FIVE } } });
  assert.equal(cleanerDayStatus(a, 1, '2026-08-11').available, true);
});

// --- the things that bite -------------------------------------------------

test('an empty time is not midnight', () => {
  // Number('') is 0, so an empty column would read as 00:00 and silently
  // widen everybody's day to cover any window at all.
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime('09:00'), 540);
  assert.equal(parseTime('9:00'), 540);
  assert.equal(parseTime('99:99'), null);
});

test('a Date and a string are the same day', () => {
  // node-pg hands back DATE columns as Date objects; overrides are keyed
  // by string. Comparing the two without this is always false.
  assert.equal(ymd(new Date(2026, 7, 11)), '2026-08-11');
  assert.equal(ymd('2026-08-11T00:00:00.000Z'), '2026-08-11');
});

test('an override read back as a Date still matches', () => {
  const a = { schedule: new Map(), overrides: new Map([[1, new Map([[ymd(new Date(2026, 7, 11)), true]])]]) };
  assert.equal(cleanerDayStatus(a, 1, new Date(2026, 7, 11)).available, true);
});
