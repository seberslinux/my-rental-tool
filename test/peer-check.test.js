const test = require('node:test');
const assert = require('node:assert/strict');
const { diffCalendar, classify, summarise } = require('../src/services/peer-check');
const { todayISO, inDays } = require('./helpers/dates');

/**
 * Reading a competitor's sales off two copies of their calendar.
 *
 * Pure: no database and no Airbnb. The rules are str-tracker's
 * docs/algorithm.md, and these pin the ones that decide whether a run of
 * taken nights is reported as somebody's booking.
 */

const today = todayISO();
const night = (i) => (i === 0 ? today : inDays(i));

// `days` nights from today, open unless `taken(i)` says otherwise.
function calendar(days, taken = () => false, minNights = 2) {
  return Array.from({ length: days }, (_, i) => ({ date: night(i), available: !taken(i), minNights }));
}
const asPrevious = (nights) => new Map(nights.map((n) => [n.date, { available: n.available, minNights: n.minNights }]));

test('a first reading finds nothing, because there is nothing to compare it with', () => {
  const { stays } = diffCalendar(new Map(), calendar(60, (i) => i < 10), today);
  assert.deepEqual(stays, []);
});

test('two nights taken next week are one booking', () => {
  const before = asPrevious(calendar(60));
  const { stays } = diffCalendar(before, calendar(60, (i) => i === 5 || i === 6), today);
  assert.equal(stays.length, 1);
  assert.equal(stays[0].checkIn, inDays(5));
  assert.equal(stays[0].checkOut, inDays(7));
  assert.equal(stays[0].nights, 2);
  assert.equal(stays[0].kind, 'booking');
});

test('separate runs of nights are separate stays', () => {
  const before = asPrevious(calendar(60));
  const { stays } = diffCalendar(before, calendar(60, (i) => (i >= 3 && i < 5) || (i >= 9 && i < 12)), today);
  assert.deepEqual(stays.map((s) => s.nights), [2, 3]);
});

test('a month closed at once is the host, not a guest', () => {
  const before = asPrevious(calendar(90));
  const { stays } = diffCalendar(before, calendar(90, (i) => i >= 20 && i < 55), today);
  assert.equal(stays[0].kind, 'block');
});

test('more than sixty nights gone in one reading are all blocks, even short runs', () => {
  const before = asPrevious(calendar(120));
  const { stays } = diffCalendar(before, calendar(120, (i) => i % 7 !== 0), today);
  assert.ok(stays.length > 1);
  assert.ok(stays.every((s) => s.kind === 'block'));
});

test('a night that was already taken is not sold again', () => {
  const before = asPrevious(calendar(30, (i) => i === 4 || i === 5));
  const { stays } = diffCalendar(before, calendar(30, (i) => i === 4 || i === 5), today);
  assert.deepEqual(stays, []);
});

test('a night that opens again is reported, so a sale can be reversed', () => {
  const before = asPrevious(calendar(30, (i) => i === 8));
  const { opened } = diffCalendar(before, calendar(30), today);
  assert.deepEqual(opened, [inDays(8)]);
});

test('the rules in order: short and soon is a booking, long and far is a block', () => {
  assert.equal(classify({ nights: 3, minNights: 2, leadDays: 10 }), 'booking');
  assert.equal(classify({ nights: 1, minNights: 2, leadDays: 3 }), 'block');
  assert.equal(classify({ nights: 1, minNights: 1, leadDays: 3 }), 'booking');
  assert.equal(classify({ nights: 1, minNights: 1, leadDays: 40 }), 'ambiguous');
  assert.equal(classify({ nights: 4, minNights: 2, leadDays: 200 }), 'ambiguous');
  assert.equal(classify({ nights: 20, minNights: 2, leadDays: 30 }), 'ambiguous');
  assert.equal(classify({ nights: 20, minNights: 2, leadDays: 120 }), 'block');
  assert.equal(classify({ nights: 3, minNights: 2, leadDays: 400 }), 'block');
});

test('one message per run, the benchmark first, our own listings left out', () => {
  const stay = (name, i, extra = {}) => ({
    checkIn: inDays(i), checkOut: inDays(i + 2), nights: 2, kind: 'booking',
    listing: { name, is_own: false, is_benchmark: false, ...extra },
  });
  const msg = summarise([
    stay('Seaforest', 3),
    stay('Our loft', 4, { is_own: true }),
    stay("Tal's house", 9, { is_benchmark: true }),
    { ...stay('Sea Song', 5), kind: 'block' },
  ]);
  assert.equal(msg.title, '2 competitor bookings');
  assert.ok(msg.body.startsWith("Tal's house"));
  assert.ok(!msg.body.includes('Our loft'));
  assert.ok(!msg.body.includes('Sea Song'));
});

test('nothing to say when only blocks or our own sales were found', () => {
  assert.equal(summarise([]), null);
  assert.equal(summarise([{ kind: 'block', listing: { is_own: false } }]), null);
});

// --- prices -----------------------------------------------------------------

const { planQuotes } = require('../src/services/peer-check');
const { fetchQuote } = require('../src/services/airbnb-calendar');

const weekdayOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const nextCalendar = (open = () => true, minNights = 2) => new Map(
  Array.from({ length: 70 }, (_, i) => [inDays(i + 1), { available: open(i + 1), minNights }])
);

test('quotes are planned for Friday weekends and Monday weekday stays', () => {
  const plan = planQuotes(nextCalendar(), today);
  const weekends = plan.filter((p) => p.kind === 'weekend');
  const weekdays = plan.filter((p) => p.kind === 'weekday');
  assert.equal(weekends.length, 8);
  assert.equal(weekdays.length, 8);
  assert.ok(weekends.every((p) => weekdayOf(p.checkIn) === 5 && p.nights === 2));
  assert.ok(weekdays.every((p) => weekdayOf(p.checkIn) === 1));
});

test('a stay with any night taken is not quoted', () => {
  const plan = planQuotes(nextCalendar((i) => weekdayOf(inDays(i)) !== 6), today);
  assert.equal(plan.filter((p) => p.kind === 'weekend').length, 0, 'every Saturday is taken');
  assert.equal(plan.filter((p) => p.kind === 'weekday').length, 8);
});

test("a listing's minimum stay sets the length of the quote", () => {
  const plan = planQuotes(nextCalendar(() => true, 3), today);
  assert.ok(plan.every((p) => p.nights === 3));
});

function fakeAirbnb(body, status = 200) {
  return async () => ({ ok: status < 400, status, json: async () => body });
}
const priced = (line, total) => ({
  data: { node: { pdpPresentation: { bookIt: { structuredDisplayPrice: {
    primaryLine: { price: total, accessibilityLabel: `${total} for 2 nights` },
    explanationData: { priceDetails: [{ items: [{ description: line }] }] },
  } } } } },
});

test("the nightly rate is Airbnb's own per-night line, fees left out", async () => {
  const q = await fetchQuote('1', inDays(5), inDays(7), {
    key: 'k', hash: 'h', fetchImpl: fakeAirbnb(priced('2 nights x R 2,544.00 ZAR', 'R 5,688 ZAR')),
  });
  assert.equal(q.nightly, 2544);
  assert.equal(q.total, 5688);
});

test('without the per-night line, the total is shared over the nights', async () => {
  const q = await fetchQuote('1', inDays(5), inDays(7), {
    key: 'k', hash: 'h', fetchImpl: fakeAirbnb(priced('', 'R 5,000 ZAR')),
  });
  assert.equal(q.nightly, 2500);
});

test('dates Airbnb will not sell give no quote rather than a wrong one', async () => {
  const q = await fetchQuote('1', inDays(5), inDays(7), {
    key: 'k', hash: 'h', fetchImpl: fakeAirbnb({ data: { node: { pdpPresentation: { bookIt: { structuredDisplayPrice: null } } } } }),
  });
  assert.equal(q, null);
});

test('a rotated hash is an error, not an empty answer', async () => {
  await assert.rejects(
    fetchQuote('1', inDays(5), inDays(7), {
      key: 'k', hash: 'h', fetchImpl: fakeAirbnb({ errors: [{ message: 'PersistedQueryNotFound' }] }),
    }),
    /PersistedQueryNotFound/
  );
});

test('a booking message says what the nights were on sale for', () => {
  const msg = summarise([{
    checkIn: inDays(9), checkOut: inDays(11), nights: 2, kind: 'booking', nightly: 4200,
    listing: { name: "Tal's house", is_own: false, is_benchmark: true },
  }]);
  assert.match(msg.body, /about R4 200 a night/);
});
