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
 * The price sold, not the money received
 *
 * Booking.com was reported at +10.7% against a setting of 25%. The gap
 * was a commission: `total_price` is what the channel paid out, and
 * `commission-included` is what it kept. A markup divides the price the
 * guest was charged by the base; dividing the payout by the base
 * measures neither the markup nor the commission.
 * ---------------------------------------------------------------------- */

const sold = (o) => ({ status: 'confirmed', platform: 'Booking.com', ...o });

test('a 25% markup paid out net of commission still reads as 25%', () => {
  // Two nights at R1,000. Sold at R2,500, Booking kept R286, paid R2,214.
  // Before this, the same row read +10.7% — the exact number on the
  // Rates page that started this.
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2214, commission: 286 })],
  });
  assert.equal(out.booking.markup, 25);
});

test('what the channel kept is reported beside the markup', () => {
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2214, commission: 286 })],
  });
  // As a percentage of the price sold, which is how a commission is
  // quoted and what the commission_booking setting means.
  assert.equal(out.booking.keeps, 11.4);
  assert.equal(out.booking.keeps_bookings, 1);
});

test('the figure says when it was reconstructed', () => {
  // The difference between a reading and a reading plus an assumption,
  // which the screen has to be able to state.
  const withCommission = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2214, commission: 286 })],
  });
  const without = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2500 })],
  });
  assert.equal(withCommission.booking.reconstructed, true);
  assert.equal(without.booking.reconstructed, false);
  // Same markup either way — one channel deducts its fee, the other adds
  // it on the guest's side, and both sold the night for R2,500.
  assert.equal(without.booking.markup, 25);
});

test('no commission reported changes nothing', () => {
  // "Did not say" must not become "took nothing". A channel that adds
  // its fee to the guest reports no commission and is measured exactly
  // as before.
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 1000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2410, commission: 0 })],
  });
  assert.equal(out.booking.markup, 20.5);
  assert.equal(out.booking.keeps, null);
  assert.equal(out.booking.keeps_bookings, 0);
});

test('a commission is never averaged in as a zero', () => {
  // One booking reported a commission and one did not. The median must
  // be of the one that did, not of 11.4 and 0.
  const out = observedMarkup({
    rates: rate('2026-09-01', 10, 1000),
    bookings: [
      sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2214, commission: 286 }),
      sold({ check_in: '2026-09-05', check_out: '2026-09-07', total_price: 2500 }),
    ],
  });
  assert.equal(out.booking.keeps, 11.4);
  assert.equal(out.booking.keeps_bookings, 1);
  assert.equal(out.booking.bookings, 2, 'both still count towards the markup');
});

test('a reconstructed price sold is still subject to the stale guard', () => {
  // The rate has since been raised far above what the night sold for.
  // Adding the commission back does not rescue it, and it must still be
  // discarded rather than reported as a negative markup.
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 5000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 2214, commission: 286 })],
  });
  assert.equal(out.booking.markup, null);
  assert.equal(out.booking.stale, 1);
  assert.equal(out.booking.reconstructed, false, 'nothing usable was reconstructed');
});

test('a channel with nothing to say still has every field', () => {
  // The caller must never have to check whether a key exists.
  const out = observedMarkup({
    rates: rate('2026-09-01', 5, 5000),
    bookings: [sold({ check_in: '2026-09-01', check_out: '2026-09-03', total_price: 100 })],
  });
  assert.deepEqual(Object.keys(out.booking).sort(), [
    'bookings', 'confident', 'high', 'keeps', 'keeps_bookings',
    'low', 'markup', 'nights', 'reconstructed', 'stale',
  ]);
});
