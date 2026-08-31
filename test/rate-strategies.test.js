const test = require('node:test');
const assert = require('node:assert/strict');
const { applyStrategies, findGaps, catalogue, defaultsFor, readParams } = require('../src/services/rate-strategies');

/**
 * The rules that read the diary.
 *
 * The engine two versions ago assigned `price = base * something` in
 * sequence, so a Friday inside the last-minute window came out at the
 * discount and the weekend uplift silently vanished. The tests that
 * matter most here are the ones that pin the opposite: two rules that
 * both apply both apply, and the order cannot change the answer.
 */

const TODAY = '2026-08-10';

/** One night as the rate plan hands it over. */
const night = (date, o = {}) => ({
  date,
  category: o.category || 'weekday',
  label: o.label || 'Weekday',
  current_price: o.current_price ?? 1000,
  new_price: o.new_price ?? 1000,
  current_min_stay: o.current_min_stay ?? null,
  new_min_stay: o.new_min_stay ?? null,
  changes: true,
});

const on = (params = {}) => ({ enabled: true, params });

// --- orphan gaps ---------------------------------------------------------

test('a two-night gap is discounted and the minimum stay drops to fit', () => {
  // The reason gaps sat empty: the old engine cut the price and left a
  // three-night minimum in place, so the discount was on a night nobody
  // was allowed to book.
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12', { new_min_stay: 3 })],
    config: { orphan_gap: on({ max_gap: 2, discount: 25, release_min_stay: true }) },
    today: TODAY, bookings,
  });

  assert.equal(row.new_price, 750);
  assert.equal(row.new_min_stay, 2, 'bookable at the length of the gap');
  assert.match(row.trail[1].why, /2-night gap/);
});

test('a gap longer than the setting is left alone', () => {
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-20', check_out: '2026-08-25' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-14')],
    config: { orphan_gap: on({ max_gap: 2, discount: 25 }) },
    today: TODAY, bookings,
  });
  assert.equal(row.new_price, 1000);
  assert.equal(row.trail.length, 1, 'nothing to say, so it says nothing');
});

test('the minimum stay is only ever lowered, never raised', () => {
  // Raising one here would close the gap this rule exists to open.
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-13', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12', { new_min_stay: 1 })],
    config: { orphan_gap: on({ max_gap: 2, discount: 10, release_min_stay: true }) },
    today: TODAY, bookings,
  });
  assert.equal(row.new_min_stay, 1, 'already looser than the gap');
});

test('releasing the minimum stay can be turned off', () => {
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12', { new_min_stay: 3 })],
    config: { orphan_gap: on({ max_gap: 2, discount: 25, release_min_stay: false }) },
    today: TODAY, bookings,
  });
  assert.equal(row.new_min_stay, 3);
});

// --- last minute ---------------------------------------------------------

test('the discount grows as the night approaches', () => {
  const conf = { lead_time: on({ start_days: 20, max_discount: 20 }) };
  const at = (date) => applyStrategies({
    rows: [night(date)], config: conf, today: TODAY, bookings: [],
  })[0].new_price;

  assert.equal(at('2026-08-30'), 1000, 'at the far edge, nothing yet');
  assert.equal(at('2026-08-20'), 900, 'halfway in, half the discount');
  assert.equal(at('2026-08-10'), 800, 'on the day, the whole of it');
});

test('a night beyond the window is untouched', () => {
  const [row] = applyStrategies({
    rows: [night('2026-12-25')],
    config: { lead_time: on({ start_days: 21, max_discount: 25 }) },
    today: TODAY, bookings: [],
  });
  assert.equal(row.new_price, 1000);
});

// --- pace ----------------------------------------------------------------

test('a month selling ahead of target costs more, one behind costs less', () => {
  const conf = (occupancy) => applyStrategies({
    rows: [night('2026-09-05')],
    config: { pace: on({ target: 60, max_adjust: 10 }) },
    today: TODAY, bookings: [], occupancy,
  })[0];

  assert.ok(conf(0.9).new_price > 1000, 'ahead of target');
  assert.ok(conf(0.2).new_price < 1000, 'behind it');
  assert.equal(conf(0.6).new_price, 1000, 'on target, left alone');
});

test('pace says nothing when occupancy is unknown', () => {
  // Not the same as an empty month. Guessing here would reprice a whole
  // window off a number nobody supplied.
  const [row] = applyStrategies({
    rows: [night('2026-09-05')],
    config: { pace: on({ target: 60, max_adjust: 10 }) },
    today: TODAY, bookings: [], occupancy: null,
  });
  assert.equal(row.new_price, 1000);
  assert.equal(row.trail.length, 1);
});

// --- composing -----------------------------------------------------------

test('two rules that both apply both apply', () => {
  // The regression this module exists to prevent. Under the old engine
  // the second rule overwrote the first and one of them vanished with no
  // trace; here they multiply.
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12')],
    config: {
      orphan_gap: on({ max_gap: 2, discount: 20, release_min_stay: false }),
      lead_time: on({ start_days: 20, max_discount: 50 }),
    },
    today: TODAY, bookings,
  });

  // 2 days out of a 20-day window is 90% of the way in: 45% off. Then
  // 20% off that. 1000 * 0.55 * 0.8 = 440.
  assert.equal(row.new_price, 440);
  assert.equal(row.trail.length, 3, 'the plan and both rules are on the record');
});

test('the order the rules run in cannot change the price', () => {
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const both = {
    orphan_gap: on({ max_gap: 2, discount: 20, release_min_stay: false }),
    lead_time: on({ start_days: 20, max_discount: 50 }),
  };
  const reversed = {
    lead_time: both.lead_time,
    orphan_gap: both.orphan_gap,
  };
  const price = (config) => applyStrategies({
    rows: [night('2026-08-12')], config, today: TODAY, bookings,
  })[0].new_price;

  assert.equal(price(both), price(reversed), 'multiplication commutes, so precedence is not a thing to learn');
});

test('a rule that is switched off contributes nothing', () => {
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12')],
    config: { orphan_gap: { enabled: false, params: { discount: 90 } } },
    today: TODAY, bookings,
  });
  assert.equal(row.new_price, 1000);
});

// --- the floor -----------------------------------------------------------

test('compounding discounts cannot duck under the floor', () => {
  // Two rules at 25% each take 44% off together, which is correct for
  // compounding and the wrong price for a flat in December.
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12')],
    config: {
      orphan_gap: on({ max_gap: 2, discount: 50, release_min_stay: false }),
      lead_time: on({ start_days: 20, max_discount: 50 }),
      floor: on({ min_price: 700 }),
    },
    today: TODAY, bookings,
  });
  assert.equal(row.new_price, 700);
  assert.match(row.trail[row.trail.length - 1].why, /floor/);
});

test('the floor does not raise a price that is already above it', () => {
  const [row] = applyStrategies({
    rows: [night('2026-12-25')],
    config: { floor: on({ min_price: 700 }) },
    today: TODAY, bookings: [],
  });
  assert.equal(row.new_price, 1000);
});

// --- the trail -----------------------------------------------------------

test('every night can say why it costs what it costs', () => {
  const bookings = [
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ];
  const [row] = applyStrategies({
    rows: [night('2026-08-12', { label: 'Weekend', new_price: 1200 })],
    config: { orphan_gap: on({ max_gap: 2, discount: 25, release_min_stay: true }) },
    today: TODAY, bookings,
  });

  assert.equal(row.plan_price, 1200, 'what the plan said, kept beside what came out');
  assert.equal(row.trail[0].label, 'Weekend');
  assert.equal(row.trail[0].price, 1200);
  assert.equal(row.trail[1].change, -25);
  assert.equal(row.new_price, 900);
});

// --- gaps ----------------------------------------------------------------

test('every night of a gap carries the whole gap length', () => {
  // A two-night hole is a two-night problem on both of its nights.
  const gaps = findGaps([
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
  ]);
  assert.equal(gaps.get('2026-08-12').length, 2);
  assert.equal(gaps.get('2026-08-13').length, 2);
  assert.equal(gaps.get('2026-08-14'), undefined, 'the next guest arrives');
});

test('back-to-back bookings leave no gap', () => {
  const gaps = findGaps([
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'confirmed', check_in: '2026-08-12', check_out: '2026-08-20' },
  ]);
  assert.equal(gaps.size, 0);
});

test('bookings out of order still find their gaps', () => {
  const gaps = findGaps([
    { status: 'confirmed', check_in: '2026-08-14', check_out: '2026-08-20' },
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
  ]);
  assert.equal(gaps.get('2026-08-12').length, 2);
});

test('a cancelled booking does not make a gap', () => {
  const gaps = findGaps([
    { status: 'confirmed', check_in: '2026-08-01', check_out: '2026-08-12' },
    { status: 'cancelled', check_in: '2026-08-14', check_out: '2026-08-20' },
  ]);
  assert.equal(gaps.size, 0);
});

// --- parameters ----------------------------------------------------------

test('a missing parameter falls back to its default, not to zero', () => {
  // Treating absence as 0% would switch a rule off while the screen
  // still showed it on.
  const p = readParams('orphan_gap', { max_gap: 3 });
  assert.equal(p.max_gap, 3);
  assert.equal(p.discount, defaultsFor('orphan_gap').discount);
});

test('parameters are held inside their bounds', () => {
  const p = readParams('orphan_gap', { discount: 900, max_gap: -4 });
  assert.equal(p.discount, 60, 'clamped to the maximum');
  assert.equal(p.max_gap, 1, 'clamped to the minimum');
});

test('the catalogue describes itself, floor last', () => {
  const list = catalogue();
  assert.deepEqual(list.map((s) => s.key), ['orphan_gap', 'lead_time', 'pace', 'floor']);
  for (const s of list) {
    assert.ok(s.label && s.blurb, `${s.key} says what it is`);
    assert.ok(s.params.length > 0, `${s.key} declares its own parameters`);
  }
});
