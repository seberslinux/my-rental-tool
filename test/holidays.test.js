const test = require('node:test');
const assert = require('node:assert/strict');
const {
  easterSunday,
  nthWeekday,
  holidaysForCountry,
  upcomingHolidays,
} = require('../src/services/holidays');

/**
 * Public holiday rules.
 *
 * The output of this module was diffed against the Nager.Date public
 * dataset for 2025–2027 across all six countries. ZA and DE match
 * exactly. GB differs only where that dataset splits by region: Easter
 * Monday, New Year and the late-August bank holiday are marked regional
 * because Scotland keeps a different calendar. Ours follow England & Wales.
 *
 * The tests below pin the rules that a hand-maintained list gets wrong:
 * weekend observance shifts, Easter arithmetic, and nth-weekday rules.
 */

// --- Easter --------------------------------------------------------------

test('easterSunday: known dates', () => {
  // Every Easter-relative holiday in every country derives from this, so
  // an error here corrupts a third of the calendar.
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  assert.equal(easterSunday(2030), '2030-04-21');
});

test('easterSunday: always lands on a Sunday', () => {
  for (let y = 2020; y <= 2040; y++) {
    const d = new Date(easterSunday(y) + 'T00:00:00Z').getUTCDay();
    assert.equal(d, 0, `Easter ${y} is not a Sunday`);
  }
});

// --- nthWeekday ----------------------------------------------------------

test('nthWeekday: nth occurrence forward', () => {
  // 4th Thursday of November 2026 → US Thanksgiving.
  assert.equal(nthWeekday(2026, 11, 4, 4), '2026-11-26');
  // 3rd Monday of January 2026 → MLK Day.
  assert.equal(nthWeekday(2026, 1, 1, 3), '2026-01-19');
});

test('nthWeekday: n = -1 finds the last occurrence in the month', () => {
  // Last Monday of May 2026 → US Memorial Day / UK Spring Bank Holiday.
  assert.equal(nthWeekday(2026, 5, 1, -1), '2026-05-25');
  // Last Monday of August 2026 → UK Summer Bank Holiday.
  assert.equal(nthWeekday(2026, 8, 1, -1), '2026-08-31');
});

test('nthWeekday: handles a month starting on the target weekday', () => {
  // 1 June 2026 is itself a Monday, so the 1st Monday is the 1st.
  assert.equal(nthWeekday(2026, 6, 1, 1), '2026-06-01');
});

// --- South Africa: the Sunday rule --------------------------------------

test('ZA: a holiday falling on a Sunday is observed on the Monday', () => {
  // The case that exposed the whole feature: National Women's Day is
  // 9 August, which in 2026 is a Sunday — so Monday the 10th is the
  // public holiday. A hardcoded date list would have shown the 9th.
  const za = holidaysForCountry('ZA', 2026);
  const womens = za.find((h) => h.name === "National Women's Day");
  assert.equal(womens.date, '2026-08-10');
});

test('ZA: a holiday on a weekday is not shifted', () => {
  // 16 June 2026 is a Tuesday.
  const youth = holidaysForCountry('ZA', 2026).find((h) => h.name === 'Youth Day');
  assert.equal(youth.date, '2026-06-16');
});

test('ZA: a holiday on a Saturday is NOT shifted (only Sundays move)', () => {
  // 27 April 2024 (Freedom Day) fell on a Saturday and stayed there.
  const freedom = holidaysForCountry('ZA', 2024).find((h) => h.name === 'Freedom Day');
  assert.equal(freedom.date, '2024-04-27');
});

test('ZA: Good Friday and Family Day bracket Easter', () => {
  const za = holidaysForCountry('ZA', 2026);
  assert.equal(za.find((h) => h.name === 'Good Friday').date, '2026-04-03');
  assert.equal(za.find((h) => h.name === 'Family Day').date, '2026-04-06');
});

test('ZA: 12 public holidays a year', () => {
  for (const year of [2025, 2026, 2027]) {
    assert.equal(holidaysForCountry('ZA', year).length, 12, `ZA ${year}`);
  }
});




// --- United Kingdom: substitute days ------------------------------------

test('GB: Boxing Day on a Saturday gets a substitute weekday', () => {
  // 26 December 2026 is a Saturday. Christmas (Friday the 25th) does not
  // move, so Boxing Day's substitute is Monday the 28th.
  const gb = holidaysForCountry('GB', 2026);
  assert.equal(gb.find((h) => h.name === 'Christmas Day').date, '2026-12-25');
  assert.equal(gb.find((h) => h.name === 'Boxing Day').date, '2026-12-28');
});

test('GB: Christmas and Boxing Day substitutes never collide', () => {
  // 25 Dec 2021 was a Saturday and 26 Dec a Sunday — both need substitutes,
  // and they must land on different days (Mon 27th and Tue 28th).
  const gb = holidaysForCountry('GB', 2021);
  const xmas = gb.find((h) => h.name === 'Christmas Day').date;
  const boxing = gb.find((h) => h.name === 'Boxing Day').date;
  assert.notEqual(xmas, boxing);
  assert.equal(xmas, '2021-12-27');
  assert.equal(boxing, '2021-12-28');
});

test('GB: bank holidays use last-Monday rules for spring and summer', () => {
  const gb = holidaysForCountry('GB', 2026);
  assert.equal(gb.find((h) => h.name === 'Early May Bank Holiday').date, '2026-05-04');
  assert.equal(gb.find((h) => h.name === 'Spring Bank Holiday').date, '2026-05-25');
  assert.equal(gb.find((h) => h.name === 'Summer Bank Holiday').date, '2026-08-31');
});




// --- metadata ------------------------------------------------------------

test('local holidays are flagged so the UI can separate ops from demand', () => {
  assert.equal(holidaysForCountry('ZA', 2026)[0].is_local, true);
  assert.equal(holidaysForCountry('DE', 2026)[0].is_local, false);
});

test('unknown country returns empty rather than throwing', () => {
  assert.deepEqual(holidaysForCountry('XX', 2026), []);
});

// --- upcomingHolidays ----------------------------------------------------

test('upcomingHolidays: returns only dates inside the window', () => {
  const out = upcomingHolidays('2026-08-07', { countries: ['ZA'], days: 30 });
  assert.deepEqual(out.map((h) => h.date), ['2026-08-10']);
});

test('upcomingHolidays: window start is inclusive, end exclusive', () => {
  const onDay = upcomingHolidays('2026-08-10', { countries: ['ZA'], days: 1 });
  assert.equal(onDay.length, 1, 'a holiday on the first day of the window counts');

  const dayBefore = upcomingHolidays('2026-08-09', { countries: ['ZA'], days: 1 });
  assert.equal(dayBefore.length, 0, 'the window end is exclusive');
});

test('upcomingHolidays: spans the year boundary', () => {
  // A window opening in December must pick up January's holidays, which
  // means computing two years.
  const out = upcomingHolidays('2026-12-20', { countries: ['ZA'], days: 30 });
  const dates = out.map((h) => h.date);
  assert.ok(dates.includes('2026-12-25'), 'December holiday');
  assert.ok(dates.includes('2027-01-01'), 'January holiday from the next year');
});

test('upcomingHolidays: sorted by date, then country', () => {
  const out = upcomingHolidays('2026-01-01', { days: 400 });
  const dates = out.map((h) => h.date);
  assert.deepEqual(dates, [...dates].sort(), 'not sorted by date');
});

test('upcomingHolidays: defaults to the tracked source markets', () => {
  // Switzerland, the Netherlands and the US were dropped: each sent 4–6
  // bookings against Germany's 42, and Switzerland's cantonal calendar
  // alone contributed enough entries to push Germany off the panel.
  const out = upcomingHolidays('2026-01-01', { days: 400 });
  const seen = new Set(out.map((h) => h.country));
  assert.deepEqual([...seen].sort(), ['DE', 'GB', 'ZA']);
});

test('upcomingHolidays: countries can be narrowed', () => {
  const out = upcomingHolidays('2026-01-01', { countries: ['ZA', 'DE'], days: 400 });
  const seen = new Set(out.map((h) => h.country));
  assert.deepEqual([...seen].sort(), ['DE', 'ZA']);
});

test('upcomingHolidays: empty window returns empty', () => {
  assert.deepEqual(upcomingHolidays('2026-08-07', { countries: ['ZA'], days: 0 }), []);
});
