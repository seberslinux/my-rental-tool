const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendNight, targetFor, floorFor, hasFloor } = require('../src/services/dynamic-pricing');

/**
 * The pricing model on its own: three prices for a night, from the
 * market's price and how full it is, and the guardrails that decide
 * what is actually sent.
 */

const market = 3000;

test('the three prices are ordered: most nights cheapest and surest, most money dearest', () => {
  const r = recommendNight({ market, fullness: 0.6, lead: 30 });
  assert.ok(r.occupancy.price < r.balanced.price && r.balanced.price < r.revenue.price);
  assert.ok(r.occupancy.chance > r.balanced.chance && r.balanced.chance > r.revenue.chance);
});

test('in a typical market the most money sits at about the market price', () => {
  const r = recommendNight({ market, fullness: 0.6, lead: 30 });
  assert.ok(Math.abs(r.revenue.price / market - 1) < 0.05, `${r.revenue.price}`);
});

test('a fuller market raises every price', () => {
  const quiet = recommendNight({ market, fullness: 0.2, lead: 30 });
  const busy = recommendNight({ market, fullness: 0.9, lead: 30 });
  for (const m of ['occupancy', 'balanced', 'revenue']) assert.ok(busy[m].price > quiet[m].price, m);
  assert.ok(busy.revenue.price > market * 1.2, 'well above the market when it is nearly full');
  assert.ok(quiet.revenue.price < market, 'below it when it is empty');
});

test('a night close and unsold in an empty market is cheaper than the same night far out', () => {
  const far = recommendNight({ market, fullness: 0.2, lead: 40 });
  const close = recommendNight({ market, fullness: 0.2, lead: 2 });
  assert.ok(close.revenue.price < far.revenue.price);
  assert.ok(close.revenue.chance < far.revenue.chance, 'and less likely to sell at any price');
});

test('the floor and ceiling bound every recommendation', () => {
  const r = recommendNight({ market, fullness: 0.2, lead: 5, floor: 2900, ceiling: 3100 });
  for (const m of ['occupancy', 'balanced', 'revenue']) {
    assert.ok(r[m].price >= 2900 - 1 && r[m].price <= 3100 + 1, `${m} ${r[m].price}`);
  }
  assert.equal(recommendNight({ market, fullness: 0.5, lead: 10, floor: 4000, ceiling: 3000 }), null);
});

test('what is sent: within the daily step, above the floor, below the ceiling, and only a real change', () => {
  const night = { current: 2000, recommended: { revenue: { rate: 3000 }, balanced: { rate: 1500 }, occupancy: { rate: 2010 } } };
  const s = { mode: 'revenue', floor: 1800, ceiling: 2200, max_step: 15 };
  assert.equal(targetFor(night, s, 'ZAR'), 2200, 'up by at most the ceiling');
  assert.equal(targetFor(night, { ...s, ceiling: null }, 'ZAR'), 2300, 'up by at most 15% a day');
  assert.equal(targetFor(night, { ...s, mode: 'balanced' }, 'ZAR'), 1800, 'never under the floor');
  assert.equal(targetFor(night, { ...s, mode: 'occupancy' }, 'ZAR'), null, 'R10 is not worth sending');
  assert.equal(targetFor(night, { ...s, mode: 'off' }, 'ZAR'), null);
  assert.equal(targetFor({ current: 2000 }, s, 'ZAR'), null, 'no recommendation, no change');
});

test("a month's own floor wins over the general one; a blank month falls back to it", () => {
  const s = { mode: 'revenue', floor: 1500, floors: { 12: 3000, 1: 2800 }, ceiling: null, max_step: 50 };
  assert.equal(floorFor('2026-12-24', s), 3000);
  assert.equal(floorFor('2027-01-10', s), 2800);
  assert.equal(floorFor('2027-06-10', s), 1500);
  const night = (date) => ({ date, current: 2000, recommended: { revenue: { rate: 1600 } } });
  assert.equal(targetFor(night('2026-12-24'), s, 'ZAR'), 3000, 'up to December\'s floor, past the daily step');
  assert.equal(targetFor(night('2027-06-10'), s, 'ZAR'), 1600, 'June has only the general floor of R1 500, so R1 600 stands');
});

test('switching on needs a general floor, or one for every month', () => {
  assert.equal(hasFloor({ floor: 1500, floors: {} }), true);
  assert.equal(hasFloor({ floor: null, floors: { 12: 3000 } }), false);
  const all = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 2000]));
  assert.equal(hasFloor({ floor: null, floors: all }), true);
});
