const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/pricing/comparable');

// Airbnb markup 20.5%, cleaning R500, a 2-night stay: the tracker's own
// figures for our listings, read from Airbnb.
const AIRBNB = 20.5;

test('Hill Top Lodge, a weekday at R2,370: R3,106 a night, as Airbnb quotes it', () => {
  const p = c.fromRates({ rates: 2370, stayNights: 2, markupPercent: AIRBNB, cleaning: 500 });
  assert.equal(p.comparable_gross_nightly, 3106);
  assert.equal(p.base_nightly, 2370);
  assert.equal(p.channel_nightly, 2856);
  assert.equal(p.cleaning_per_night, 250);
  assert.equal(p.stay_total, 6212, 'Airbnb: R6,212 for 2 nights');
  assert.equal(p.basis, 'airbnb, cleaning over 2 nights, excl. guest service fee, from smoobu base rate');
});

test('Hill Top Lodge, a weekend at R3,280 and R3,210: R4,161 — each night rounded up, as Airbnb does', () => {
  const p = c.fromRates({ rates: [3280, 3210], markupPercent: AIRBNB, cleaning: 500 });
  assert.equal(p.comparable_gross_nightly, 4161);
  assert.equal(p.base_nightly, 3245);
  assert.equal(p.stay_total, 8322, '3,953 + 3,869 + 500, Airbnb\'s own total');
});

test('Scarborough Loft, a weekend at R2,300 and R2,500: R3,143 — R6,285 over 2 nights, as the tracker read it', () => {
  // The task sheet said 3,142; the tracker (compare_prices, own listing)
  // shows 3,143: ⌈2,771.50⌉ + ⌈3,012.50⌉ + 500 = 6,285, ÷ 2 = 3,142.50.
  const p = c.fromRates({ rates: [2300, 2500], markupPercent: AIRBNB, cleaning: 500 });
  assert.equal(p.comparable_gross_nightly, 3143);
  assert.equal(p.base_nightly, 2400);
  assert.equal(p.stay_total, 6285);
});

test('a 3-night stay spreads cleaning over 3 nights', () => {
  // Lodge 7–10 Dec: R2,370, R2,370, R2,280 → Airbnb R8,960.
  const p = c.fromRates({ rates: [2370, 2370, 2280], markupPercent: AIRBNB, cleaning: 500 });
  assert.equal(p.stay_total, 8960);
  assert.equal(p.cleaning_per_night, 167);
  assert.equal(p.comparable_gross_nightly, 2987);
  assert.equal(p.basis, 'airbnb, cleaning over 3 nights, excl. guest service fee, from smoobu base rate');
});

test('a listing with no cleaning fee is its nights alone; an unknown fee says so', () => {
  const none = c.fromRates({ rates: 2370, stayNights: 2, markupPercent: AIRBNB, cleaning: 0 });
  assert.equal(none.comparable_gross_nightly, 2856);
  assert.equal(none.cleaning_per_night, 0);
  const unknown = c.fromRates({ rates: 2370, stayNights: 2, markupPercent: AIRBNB });
  assert.equal(unknown.cleaning_per_night, null);
  assert.match(unknown.basis, /cleaning unknown/);
  const quote = c.fromQuote({ nightly: 1300, nights: 2, cleaning: 0, stayNights: 3 });
  assert.equal(quote.comparable_gross_nightly, 1300, 'no fee: the same over any stay');
});

test('an own past booking: Loft, Airbnb, R6,044 over 2 nights → R3,022, R2,772 without cleaning', () => {
  const b = c.fromBooking({ gross: 6044, nights: 2, cleaning: 500, platform: 'Airbnb' });
  assert.equal(b.comparable_gross_nightly, 3022);
  assert.equal(b.gross_ex_cleaning_nightly, 2772);
  assert.equal(b.price_unknown, false);
  assert.match(b.basis, /^airbnb booking, smoobu gross over 2 nights/);
  // The same stay from the rates in force when it was booked: 2 × ⌈2,300 × 1.205⌉ + 500.
  assert.equal(c.fromRates({ rates: 2300, stayNights: 2, markupPercent: AIRBNB, cleaning: 500 }).stay_total, 6044);
});

test('a booking Smoobu has no price for is price unknown, never filled in', () => {
  const b = c.fromBooking({ gross: 0, nights: 3, cleaning: 500, platform: 'VRBO / HomeAway' });
  assert.equal(b.price_unknown, true);
  assert.equal(b.comparable_gross_nightly, null);
  assert.equal(b.basis, 'vrbo booking, price unknown in smoobu');
});

test('a quote is put on the 2-night basis: unchanged for a 2-night quote, re-spread for a long minimum stay', () => {
  assert.equal(c.fromQuote({ nightly: 3106, nights: 2, cleaning: 500 }).comparable_gross_nightly, 3106);
  // 30 nights quoted at R3,305 with R600 cleaning: R3,285 a night before cleaning, + 300.
  const long = c.fromQuote({ nightly: 3305, nights: 30, cleaning: 600 });
  assert.equal(long.comparable_gross_nightly, 3585);
  assert.equal(long.stay_nights, 2);
  const kept = c.fromQuote({ nightly: 3305, nights: 30, cleaning: null });
  assert.equal(kept.comparable_gross_nightly, 3305);
  assert.match(kept.basis, /cleaning unknown.*quote over 30 nights/);
});

test('quote fields keep the deprecated nightly, equal to the comparable', () => {
  const f = c.quoteFields({ nightly: 3106, nights: 2, cleaning: 500 });
  assert.equal(f.nightly, f.comparable_gross_nightly);
});

test('markups by channel come from the property; direct has none', () => {
  const p = { guest_markup_airbnb: 20.5, guest_markup_booking: 18, guest_markup_vrbo: 0 };
  assert.equal(c.markupFor(p, c.channelOf('Airbnb')), 20.5);
  assert.equal(c.markupFor(p, c.channelOf('Booking.com')), 18);
  assert.equal(c.markupFor(p, c.channelOf('VRBO / HomeAway')), 0);
  assert.equal(c.markupFor(p, c.channelOf('Direct booking')), 0);
});

test('the base rate for a wanted comparable price is the inverse', () => {
  const base = c.baseForComparable({ comparable: 3106, stayNights: 2, markupPercent: AIRBNB, cleaning: 500 });
  assert.ok(Math.abs(base - 2370) < 1, String(base));
});
