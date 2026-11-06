const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkProperty, horizonFrom, effectiveMarkups, rollUp, TARGET_DAYS, RED_DAYS,
} = require('../src/services/health-check');
const { addDays } = require('../src/services/dashboard-calc');

/**
 * The judgement, without a network.
 *
 * Every case here is one of the real incidents of the last year, written
 * as the data the check would have been handed on the morning it
 * started. If any of them goes green this module is back to being
 * decoration.
 *
 * `today` is passed explicitly throughout — these are calculations on
 * dates, not against the clock, so pinning them is what makes them
 * reproducible.
 */

const TODAY = '2026-11-06';

/** Rates for `n` days from `TODAY`, every night at `price`. */
function priced(n, price = 3000, from = TODAY) {
  const out = {};
  for (let i = 0; i <= n; i++) out[addDays(from, i)] = { price };
  return out;
}

const lodge = { id: 1, name: 'Hill Top Lodge', price_floor: 1500 };

// --- the horizon ---------------------------------------------------------

test('a year of prices is a full horizon', () => {
  const h = horizonFrom(priced(TARGET_DAYS), TODAY);
  assert.equal(h.days, TARGET_DAYS);
  assert.equal(h.priced_to, addDays(TODAY, TARGET_DAYS));
});

test('the loft on thirty days is red', () => {
  // The incident: one Booking.com room received 30 days while the Lodge
  // had a year, and nothing said so for weeks.
  const r = checkProperty({ property: { id: 2, name: 'The loft', price_floor: 1500 }, rates: priced(30), today: TODAY });
  assert.equal(r.status, 'red');
  const h = r.findings.find((f) => f.key === 'horizon');
  assert.equal(h.severity, 'red');
  assert.match(h.title, /only on sale for 30 more days/);
});

test('short of a year but past the alarm is amber, not red', () => {
  const r = checkProperty({ property: lodge, rates: priced(330), today: TODAY });
  assert.equal(r.status, 'amber');
  assert.equal(r.findings.find((f) => f.key === 'horizon').severity, 'amber');
});

test('the alarm line itself is covered on both sides', () => {
  const at = checkProperty({ property: lodge, rates: priced(RED_DAYS), today: TODAY });
  const under = checkProperty({ property: lodge, rates: priced(RED_DAYS - 1), today: TODAY });
  assert.equal(at.findings.find((f) => f.key === 'horizon').severity, 'amber');
  assert.equal(under.findings.find((f) => f.key === 'horizon').severity, 'red');
});

test('a hole in the middle ends the horizon there', () => {
  // A listing priced to next December with March missing is not priced
  // to next December: March is where a guest searching finds nothing.
  const rates = priced(TARGET_DAYS);
  delete rates[addDays(TODAY, 120)];
  assert.equal(horizonFrom(rates, TODAY).days, 119);
});

test('a booked night does not end the horizon', () => {
  // Unavailable is correct for a booked night. Treating it as the end
  // would turn a full calendar into an alert.
  const rates = priced(TARGET_DAYS);
  rates[addDays(TODAY, 10)] = { price: 3000, available: false };
  assert.equal(horizonFrom(rates, TODAY).days, TARGET_DAYS);
});

test('no price for tonight says so rather than reporting zero days quietly', () => {
  const r = checkProperty({ property: lodge, rates: {}, today: TODAY });
  assert.equal(r.status, 'red');
  assert.match(r.findings[0].title, /no price for tonight/);
});

// --- the floor -----------------------------------------------------------

test('a night under the floor is red', () => {
  const rates = priced(TARGET_DAYS);
  rates[addDays(TODAY, 40)] = { price: 110 };
  const r = checkProperty({ property: lodge, rates, today: TODAY });
  const f = r.findings.find((x) => x.key === 'below_floor');
  assert.equal(f.severity, 'red');
  assert.equal(f.count, 1);
  assert.deepEqual(f.examples, [addDays(TODAY, 40)]);
});

test('the loft at R90 selling on Booking.com for R113 is red', () => {
  // The exact incident. The base is absurd and the guest price is the
  // number that was actually charged, so both are reported — the
  // channel one names the channel and the markup it used.
  const rates = priced(TARGET_DAYS, 90);
  const property = { id: 2, name: 'The loft', price_floor: 1500, guest_markup_booking: 25 };
  const r = checkProperty({ property, rates, today: TODAY });

  assert.equal(r.status, 'red');
  assert.ok(r.findings.find((f) => f.key === 'below_floor'), 'the base is flagged');
  const ch = r.findings.find((f) => f.key === 'below_floor_booking');
  assert.match(ch.title, /sell on Booking\.com under R1\s500/);
  assert.match(ch.detail, /25% on top \(from the property setting\)/);
});

test('a floor nobody has set is reported, not passed', () => {
  // An unset floor is exactly the kind of setting this check exists to
  // find. Amber, and it goes away the moment somebody enters one.
  const r = checkProperty({ property: { id: 3, name: 'New flat' }, rates: priced(TARGET_DAYS, 50), today: TODAY });
  assert.equal(r.status, 'amber');
  assert.ok(r.findings.find((f) => f.key === 'no_floor'));
  assert.equal(r.findings.find((f) => f.key === 'below_floor'), undefined,
    'nothing is measured against a floor that does not exist');
});

test('a night over the ceiling is amber, not red', () => {
  // February carried a R4,300–5,600 dynamic-pricing residue. Worth
  // looking at; a lost booking is recoverable and a night sold at a
  // loss is not.
  const rates = priced(TARGET_DAYS);
  rates[addDays(TODAY, 90)] = { price: 5600 };
  const r = checkProperty({ property: { ...lodge, price_ceiling: 5000 }, rates, today: TODAY });
  assert.equal(r.status, 'amber');
  assert.equal(r.findings.find((f) => f.key === 'above_ceiling').severity, 'amber');
});

test('the count is whole even though the examples are trimmed', () => {
  // Three hundred bad nights is the fact. Listing all of them is not.
  const r = checkProperty({ property: lodge, rates: priced(TARGET_DAYS, 110), today: TODAY });
  const f = r.findings.find((x) => x.key === 'below_floor');
  assert.equal(f.count, TARGET_DAYS + 1);
  assert.equal(f.examples.length, 5);
});

// --- which markup gets used ----------------------------------------------

test('an entered markup beats an observed one', () => {
  const m = effectiveMarkups(
    { guest_markup_booking: 25 },
    { booking: { confident: true, markup: 31 } }
  );
  assert.deepEqual(m.booking, { label: 'Booking.com', percent: 25, source: 'setting' });
});

test('an observed markup is used when nothing was entered', () => {
  const m = effectiveMarkups({}, { airbnb: { confident: true, markup: 20.5 } });
  assert.equal(m.airbnb.percent, 20.5);
  assert.equal(m.airbnb.source, 'observed');
});

test('an unconfident observation is not used at all', () => {
  // observedMarkup's own header: an unconfident median is the middle of
  // some noise. Guessing from it would report a guest price nobody is
  // charged.
  const m = effectiveMarkups({}, { airbnb: { confident: false, markup: 20.5 } });
  assert.equal(m.airbnb, null);
});

test('with no markup to use, the channel is simply not checked', () => {
  const rates = priced(TARGET_DAYS, 1400);
  const r = checkProperty({ property: lodge, rates, today: TODAY });
  assert.ok(r.findings.find((f) => f.key === 'below_floor'), 'the base is still checked');
  assert.equal(r.findings.filter((f) => f.key.startsWith('below_floor_')).length, 0);
});

// --- failure is not health ----------------------------------------------

test('a fetch that failed is red, and says nothing else was checked', () => {
  // Rates failed silently for months behind a sync reporting success. A
  // health check that returns green on no data is the same bug.
  const r = checkProperty({ property: lodge, rates: null, today: TODAY, error: '401 Unauthorized' });
  assert.equal(r.status, 'red');
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].detail, /Nothing below has been checked/);
});

// --- the roll-up ---------------------------------------------------------

test('one red listing makes the card red', () => {
  assert.equal(rollUp([{ status: 'green' }, { status: 'amber' }, { status: 'red' }]), 'red');
  assert.equal(rollUp([{ status: 'green' }, { status: 'amber' }]), 'amber');
  assert.equal(rollUp([{ status: 'green' }]), 'green');
});

test('nothing to check is green rather than undefined', () => {
  assert.equal(rollUp([]), 'green');
});

test('a healthy listing has nothing to say', () => {
  const property = { ...lodge, price_ceiling: 6000, guest_markup_booking: 25 };
  const r = checkProperty({ property, rates: priced(TARGET_DAYS, 3000), today: TODAY });
  assert.equal(r.status, 'green');
  assert.deepEqual(r.findings, []);
});
