const test = require('node:test');
const assert = require('node:assert/strict');
const { summarise, suggestions, seasonLabel, hemisphere, mondayOf } = require('../src/services/peer-analysis');
const { todayISO, inDays } = require('./helpers/dates');

/**
 * Adding up what the competitors sold, and what it suggests. Pure: no
 * database. Dates are built from today so nothing here goes stale.
 */

const today = todayISO();
const money = (n) => `R${Math.round(n)}`;
const sale = (o) => ({ name: 'Seaforest', nights: 3, lead_days: 30, revenue: 9000, estimated: false, found: today, check_in: inDays(30), nightly_sold: 3000, ...o });

test('a period adds up bookings, nights and money, and names its top seller', () => {
  const p = summarise([
    sale({ name: 'Seaforest', nights: 3, revenue: 9000 }),
    sale({ name: 'Sea Song', nights: 5, revenue: 10000, lead_days: 10 }),
    sale({ name: 'Seaforest', nights: 4, revenue: null, estimated: true, lead_days: 50 }),
  ]);
  assert.equal(p.bookings, 3);
  assert.equal(p.nights, 12);
  assert.equal(p.revenue, 19000);
  assert.equal(p.avg_nightly, 2375, 'money over the priced nights only');
  assert.equal(p.median_lead_days, 30);
  assert.deepEqual(p.top_listing, { name: 'Seaforest', nights: 7 });
  assert.equal(p.estimated, true);
});

test('seasons follow the hemisphere, and a season across New Year is one season', () => {
  assert.equal(hemisphere({ location: '-34.19,18.37', currency: 'ZAR' }), 'south');
  assert.equal(hemisphere({ location: '', currency: 'EUR' }), 'north');
  assert.equal(seasonLabel('2026-12-20', 'south'), 'Summer 2026/27');
  assert.equal(seasonLabel('2027-01-10', 'south'), 'Summer 2026/27');
  assert.equal(seasonLabel('2027-07-01', 'south'), 'Winter 2027');
  assert.equal(seasonLabel('2027-01-10', 'north'), 'Winter 2026/27');
  assert.equal(seasonLabel('2027-07-01', 'north'), 'Summer 2027');
});

test('weeks start on Monday', () => {
  const m = mondayOf(today);
  assert.equal(new Date(`${m}T00:00:00Z`).getUTCDay(), 1);
  assert.ok(m <= today);
});

test('the lead time says which of our nights are being decided now', () => {
  const sales = [sale({ lead_days: 20 }), sale({ lead_days: 30 }), sale({ lead_days: 40 })];
  const open = new Set([inDays(30), inDays(31)]);
  const out = suggestions({ sales, ownOpen: open, today, money });
  const lead = out.find((s) => s.kind === 'lead');
  assert.match(lead.text, /median 30 days ahead/);
  assert.match(lead.text, /You have 2 of 15 nights open/);
});

test('a week that is selling while we still have nights is called out', () => {
  const week = mondayOf(inDays(30));
  const sales = [sale({ check_in: week, nights: 3 }), sale({ check_in: week, nights: 4, name: 'Sea Song' })];
  const out = suggestions({ sales, ownOpen: new Set([week]), today, money });
  assert.ok(out.some((s) => s.kind === 'hot_week' && /sold 7 nights/.test(s.text)));
  const none = suggestions({ sales, ownOpen: new Set(), today, money });
  assert.ok(!none.some((s) => s.kind === 'hot_week'), 'nothing to say when we are full');
});

test('selling above our price says raise it; far below says come down', () => {
  const week = mondayOf(inDays(30));
  const up = suggestions({ sales: [sale({ check_in: week, nightly_sold: 4000 })], ownPrices: [{ check_in: week, nightly: 3000, open: true }], today, money });
  assert.ok(up.some((s) => s.kind === 'price_up'));
  const down = suggestions({ sales: [sale({ check_in: week, nightly_sold: 2000 })], ownPrices: [{ check_in: week, nightly: 3000, open: true }], today, money });
  assert.ok(down.some((s) => s.kind === 'price_down'));
});

test('the price leader is the ceiling, measured against what we ask', () => {
  const out = suggestions({
    sales: [], today, money,
    leaders: [{ name: 'Tree House', bookings: 2, nights: 8, revenue: 151568, avg_nightly: 18946 }],
    ownPrices: [{ check_in: inDays(10), nightly: 2960, open: true }],
  });
  const l = out.find((s) => s.kind === 'leader_price');
  assert.match(l.text, /Tree House sold 8 nights at about R18946 a night/);
  assert.match(l.text, /6.4× your current asking price/);
});
