const test = require('node:test');
const assert = require('node:assert/strict');
const { observedMarkup, nightsOf, median } = require('../src/services/observed-markup');

/**
 * Reading Smoobu's markup off the bookings it produced.
 *
 * Smoobu decides what a guest pays; this only notices what it has been
 * deciding. The tests that matter are the ones about not being
 * confidently wrong — a partial base, a single odd stay, a channel with
 * nothing to say.
 */

const rate = (from, nights, price) => {
  const out = {};
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < nights; i++) {
    out[new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10)] = price;
  }
  return out;
};

const stay = (o) => ({ status: 'confirmed', platform: 'Airbnb', ...o });

test('a 14% markup is read back as 14%', () => {
  const rates = rate('2026-09-01', 10, 1000);
  const out = observedMarkup({
    rates,
    bookings: [stay({ check_in: '2026-09-01', check_out: '2026-09-04', total_price: 3420 })],
  });
  assert.equal(out.airbnb.markup, 14);
  assert.equal(out.airbnb.bookings, 1);
  assert.equal(out.airbnb.nights, 3);
});

test('no markup reads as zero, not as absent', () => {
  const out = observedMarkup({
    rates: rate('2026-09-01', 10, 1000),
    bookings: [stay({ platform: 'Booking.com', check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2000 })],
  });
  assert.equal(out.booking.markup, 0);
});

test('the typical booking wins, not the odd one', () => {
  // One long stay straddling a repriced weekend would drag an average
  // anywhere; the median is what the rest of them say.
  const rates = rate('2026-09-01', 30, 1000);
  const out = observedMarkup({
    rates,
    bookings: [
      stay({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2280 }), // 14%
      stay({ check_in: '2026-09-05', check_out: '2026-09-07', total_price: 2280 }), // 14%
      stay({ check_in: '2026-09-10', check_out: '2026-09-12', total_price: 4000 }), // 100%, odd
    ],
  });
  assert.equal(out.airbnb.markup, 14);
  assert.equal(out.airbnb.high, 100, 'the outlier is still reported, not hidden');
});

test('the spread comes back so a wide one can be distrusted', () => {
  const rates = rate('2026-09-01', 30, 1000);
  const out = observedMarkup({
    rates,
    bookings: [
      stay({ check_in: '2026-09-01', check_out: '2026-09-02', total_price: 1050 }),
      stay({ check_in: '2026-09-05', check_out: '2026-09-06', total_price: 1400 }),
    ],
  });
  assert.equal(out.airbnb.low, 5);
  assert.equal(out.airbnb.high, 40);
});

test('a booking missing a rate for even one night is dropped', () => {
  // A base summed over four nights of a five-night stay makes the markup
  // look 25% larger than it is. Better to measure nothing.
  const rates = rate('2026-09-01', 2, 1000); // only the 1st and 2nd
  const out = observedMarkup({
    rates,
    bookings: [stay({ check_in: '2026-09-01', check_out: '2026-09-04', total_price: 3420 })],
  });
  assert.deepEqual(out, {}, 'nothing measurable rather than a wrong number');
});

test('a channel with nothing to measure is absent, not zero', () => {
  // Absent means "no idea"; zero would read as "no markup".
  const out = observedMarkup({ rates: rate('2026-09-01', 5, 1000), bookings: [] });
  assert.equal(out.airbnb, undefined);
});

test('direct bookings teach nothing about a channel', () => {
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [stay({ platform: 'Direct booking', check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2000 })],
  });
  assert.deepEqual(out, {});
});

test('cancellations and blocks are not evidence', () => {
  const rates = rate('2026-09-01', 10, 1000);
  const out = observedMarkup({
    rates,
    bookings: [
      stay({ status: 'cancelled', check_in: '2026-09-01', check_out: '2026-09-03', total_price: 5000 }),
      stay({ platform: 'Blocked channel', check_in: '2026-09-05', check_out: '2026-09-07', total_price: 0 }),
    ],
  });
  assert.deepEqual(out, {});
});

test('a booking with no price is skipped rather than read as free', () => {
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [stay({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 0 })],
  });
  assert.deepEqual(out, {});
});

test('each channel is measured on its own bookings', () => {
  const rates = rate('2026-09-01', 30, 1000);
  const out = observedMarkup({
    rates,
    bookings: [
      stay({ platform: 'Airbnb', check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2280 }),
      stay({ platform: 'Booking.com', check_in: '2026-09-05', check_out: '2026-09-07', total_price: 2000 }),
    ],
  });
  assert.equal(out.airbnb.markup, 14);
  assert.equal(out.booking.markup, 0);
});

// --- the small pieces ----------------------------------------------------

test('a stay covers its nights, not its checkout day', () => {
  assert.deepEqual(
    nightsOf({ check_in: '2026-09-01', check_out: '2026-09-04' }),
    ['2026-09-01', '2026-09-02', '2026-09-03']
  );
});

test('a same-day booking has no nights', () => {
  assert.deepEqual(nightsOf({ check_in: '2026-09-01', check_out: '2026-09-01' }), []);
});

test('median handles both lengths', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

// --- is it even a setting ------------------------------------------------

test('bookings that agree with each other are worth acting on', () => {
  const rates = rate('2026-09-01', 30, 1000);
  const out = observedMarkup({
    rates,
    bookings: [
      stay({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2280 }), // 14%
      stay({ check_in: '2026-09-05', check_out: '2026-09-07', total_price: 2300 }), // 15%
    ],
  });
  assert.equal(out.airbnb.confident, true);
});

test('bookings that disagree wildly are reported but not offered', () => {
  // A channel markup is a fixed percentage. When observations range
  // across tens of points, something else is moving the price and the
  // median is the middle of some noise.
  const rates = rate('2026-09-01', 30, 1000);
  const out = observedMarkup({
    rates,
    bookings: [
      stay({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 1200 }), // -40%
      stay({ check_in: '2026-09-05', check_out: '2026-09-07', total_price: 2280 }), // +14%
    ],
  });
  assert.equal(out.airbnb.confident, false);
  assert.ok(out.airbnb.markup != null, 'still reported, so the disagreement is visible');
});

test('a single booking is never enough to call it a setting', () => {
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [stay({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2280 })],
  });
  assert.equal(out.airbnb.confident, false, 'one booking is an anecdote');
  assert.equal(out.airbnb.markup, 14);
});

/* ---------------------------------------------------------------------- *
 * The commission, and the markup it demands
 *
 * The markup needs the base and the base goes stale. The commission is
 * two numbers on the same booking row, so it is the one figure here that
 * can be measured rather than estimated — and it is the one the markup
 * has to clear.
 * ---------------------------------------------------------------------- */

const { requiredMarkup, measuredCommission } = require('../src/services/observed-markup');

/** A confirmed Booking.com stay, since that is the channel in question. */
const sold = (o) => ({ status: 'confirmed', platform: 'Booking.com', ...o });

test('the markup a commission demands is a division, not a subtraction', () => {
  // 17% kept needs 20.5% added, not 17%. Setting the markup equal to the
  // commission is the intuitive mistake and it loses money every night.
  assert.equal(requiredMarkup(17), 20.5);
  assert.equal(requiredMarkup(15), 17.6);
  // At 20% kept, a 25% markup is exactly break-even.
  assert.equal(requiredMarkup(20), 25);
});

test('the required markup returns the base exactly', () => {
  // The property the formula exists for: (1 + m)(1 - c) = 1.
  for (const c of [10, 15, 17, 20, 25]) {
    const m = requiredMarkup(c);
    const payout = 1000 * (1 + m / 100) * (1 - c / 100);
    assert.ok(Math.abs(payout - 1000) < 1.5, `${c}% -> ${m}% returns ${payout.toFixed(2)}`);
  }
});

test('no commission needs no markup, and an impossible one has none', () => {
  assert.equal(requiredMarkup(0), 0);
  assert.equal(requiredMarkup(-5), 0);
  // A channel keeping everything cannot be covered at any markup.
  assert.equal(requiredMarkup(100), null);
});

test('what a channel keeps is measured off the booking row', () => {
  // R601.64 kept out of R4,010.90 sold — the real Nov 2025 Lodge
  // booking, if Booking.com's cut were the configured 15%.
  const out = measuredCommission([
    sold({ check_in: '2025-11-09', check_out: '2025-11-11', total_price: 4010.90, commission: 601.64 }),
  ]);
  assert.equal(out.booking.commission, 15);
  assert.equal(out.booking.required_markup, 17.6);
  assert.equal(out.booking.bookings, 1);
});

test('measuring the commission needs no rates at all', () => {
  // The whole point. A booking from last year is as good as evidence,
  // because there is no base in the ratio to have been repriced.
  const out = measuredCommission([
    sold({ check_in: '2024-03-01', check_out: '2024-03-03', total_price: 2000, commission: 340 }),
  ]);
  assert.equal(out.booking.commission, 17);
  assert.equal(out.booking.required_markup, 20.5);
});

test('a booking that reported no commission is left out, not counted as zero', () => {
  // "Did not say" is not "took nothing". Averaging the two reports a
  // channel as cheaper than it is, which understates the markup needed.
  const out = measuredCommission([
    sold({ check_in: '2025-01-01', check_out: '2025-01-03', total_price: 2000, commission: 340 }),
    sold({ check_in: '2025-02-01', check_out: '2025-02-03', total_price: 2000 }),
    sold({ check_in: '2025-03-01', check_out: '2025-03-03', total_price: 2000, commission: 0 }),
  ]);
  assert.equal(out.booking.commission, 17);
  assert.equal(out.booking.bookings, 1);
});

test('a commission larger than the price sold is a broken row, not a commission', () => {
  const out = measuredCommission([
    sold({ check_in: '2025-01-01', check_out: '2025-01-03', total_price: 2000, commission: 2000 }),
    sold({ check_in: '2025-02-01', check_out: '2025-02-03', total_price: 2000, commission: 340 }),
  ]);
  assert.equal(out.booking.commission, 17);
  assert.equal(out.booking.bookings, 1);
});

test('each channel is measured on its own, and direct bookings not at all', () => {
  const out = measuredCommission([
    { status: 'confirmed', platform: 'Airbnb', total_price: 2000, commission: 300 },
    { status: 'confirmed', platform: 'Booking.com', total_price: 2000, commission: 340 },
    { status: 'confirmed', platform: 'Direct booking', total_price: 2000, commission: 500 },
    { status: 'confirmed', platform: 'Blocked channel', total_price: 2000, commission: 500 },
  ]);
  assert.equal(out.airbnb.commission, 15);
  assert.equal(out.booking.commission, 17);
  assert.equal(out.direct, undefined);
  assert.equal(Object.keys(out).sort().join(','), 'airbnb,booking');
});

test('a cancelled booking is not evidence of anything', () => {
  const out = measuredCommission([
    sold({ status: 'cancelled', total_price: 2000, commission: 900 }),
    sold({ total_price: 2000, commission: 340 }),
  ]);
  assert.equal(out.booking.commission, 17);
  assert.equal(out.booking.bookings, 1);
});

test('the spread is reported so one renegotiated rate is visible', () => {
  const out = measuredCommission([
    sold({ total_price: 2000, commission: 300 }),
    sold({ total_price: 2000, commission: 340 }),
    sold({ total_price: 2000, commission: 400 }),
  ]);
  assert.equal(out.booking.commission, 17);
  assert.equal(out.booking.low, 15);
  assert.equal(out.booking.high, 20);
});
