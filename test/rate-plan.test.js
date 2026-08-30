const test = require('node:test');
const assert = require('node:assert/strict');
const { categorise, longWeekendNights, planNights } = require('../src/services/rate-plan');

/**
 * A night gets one category — the most specific that applies.
 *
 * The engine this replaces applied its rules in sequence and let each
 * overwrite the last, so a Friday within five days came out discounted
 * and the weekend uplift silently vanished. These tests pin the order so
 * that cannot come back.
 */

// Real dates from the production holiday table.
const HERITAGE = { start: '2026-09-24', end: '2026-09-24', kind: 'public', name: 'Heritage Day' };   // Thursday
const CHRISTMAS = { start: '2026-12-25', end: '2026-12-25', kind: 'public', name: 'Christmas Day' }; // Friday
const RECONCILIATION = { start: '2026-12-16', end: '2026-12-16', kind: 'public', name: 'Day of Reconciliation' }; // Wednesday
const SUMMER_TERM = { start: '2026-12-12', end: '2027-01-10', kind: 'school', name: 'Summer Break' };

test('a Thursday holiday makes a four-night break, because the Friday gets bridged', () => {
  assert.deepEqual(longWeekendNights('2026-09-24'),
    ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
});

test('a Friday holiday makes three nights, a Monday one makes three the other way', () => {
  assert.deepEqual(longWeekendNights('2026-12-25'),
    ['2026-12-25', '2026-12-26', '2026-12-27']);
  // 2026-11-02 is a Monday.
  assert.deepEqual(longWeekendNights('2026-11-02'),
    ['2026-10-31', '2026-11-01', '2026-11-02']);
});

test('a Wednesday holiday drags nothing', () => {
  assert.deepEqual(longWeekendNights('2026-12-16'), []);
});

test('Christmas is a long weekend, not a school holiday and not merely a Friday', () => {
  // It is all three at once: a public holiday, a Friday, and inside the
  // Summer Break window. The most specific wins.
  const holidays = [CHRISTMAS, SUMMER_TERM];
  assert.equal(categorise('2026-12-25', holidays), 'long_weekend');
});

test('a midweek public holiday is a public holiday, not a long weekend', () => {
  assert.equal(categorise('2026-12-16', [RECONCILIATION]), 'public_holiday');
});

test('a night inside a school term is a school holiday, unless it is more than that', () => {
  assert.equal(categorise('2026-12-20', [SUMMER_TERM]), 'school_holiday');
  // A Saturday inside the term is still the term, because school
  // holidays are the more specific fact about it.
  assert.equal(categorise('2026-12-19', [SUMMER_TERM]), 'school_holiday');
});

test('an ordinary Friday and Saturday are the weekend; the rest are weekdays', () => {
  assert.equal(categorise('2026-10-16', []), 'weekend');   // Friday
  assert.equal(categorise('2026-10-17', []), 'weekend');   // Saturday
  assert.equal(categorise('2026-10-18', []), 'weekday');   // Sunday
  assert.equal(categorise('2026-10-14', []), 'weekday');   // Wednesday
});

// --- what a plan would do -------------------------------------------------

const PLAN = {
  long_weekend: { price: 4200, min_stay: 3 },
  public_holiday: { price: 3800, min_stay: 2 },
  school_holiday: { price: 3600, min_stay: 5 },
  weekend: { price: 3200, min_stay: 2 },
  weekday: { price: 2400, min_stay: 2 },
};

test('Heritage Day weekend is priced as a long weekend, all four nights', () => {
  const rows = planNights({
    from: '2026-09-24', to: '2026-09-27', plan: PLAN, holidays: [HERITAGE],
  });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.category === 'long_weekend'));
  assert.ok(rows.every((r) => r.new_price === 4200 && r.new_min_stay === 3));
});

test('a booked night is left out of the plan entirely', () => {
  const rows = planNights({
    from: '2026-10-14', to: '2026-10-18', plan: PLAN,
    bookings: [{ check_in: '2026-10-15', check_out: '2026-10-17', status: 'confirmed' }],
  });
  const dates = rows.map((r) => r.date);
  assert.ok(!dates.includes('2026-10-15'), 'the guest paid what they paid');
  assert.ok(!dates.includes('2026-10-16'));
  assert.ok(dates.includes('2026-10-17'), 'the night they leave is free again');
});

test('a night already at the planned price is reported as unchanged', () => {
  const rows = planNights({
    from: '2026-10-14', to: '2026-10-14', plan: PLAN,
    currentRates: { '2026-10-14': { price: 2400, min_stay: 2 } },
  });
  assert.equal(rows[0].changes, false, 'so a preview can say "nothing to do"');
});

test('a category with no price set is skipped rather than priced at zero', () => {
  const rows = planNights({
    from: '2026-10-16', to: '2026-10-17',
    plan: { weekday: { price: 2400 } },
  });
  assert.equal(rows.length, 0, 'weekends have no rule, so they are left alone');
});
