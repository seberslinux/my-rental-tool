const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stayNights,
  nightsInWindow,
  nightsSoldInWindow,
  revenueInWindow,
  revenueEarned,
  revenueComing,
  avgRateEarned,
} = require('../src/services/revenue');

/**
 * Revenue attribution — the single source of truth for every revenue
 * figure in the app.
 *
 * Rule under test: nightly pro-rata. A booking's revenue spreads evenly
 * across the nights of the stay; each night is attributed to the date it
 * falls on. Windows are half-open `[from, to)`.
 *
 * The bug these tests exist to prevent: Home and Analytics disagreeing
 * because they attributed the same booking to different periods.
 */

// Currency-converted booking (as bulkConvert leaves it).
function b(overrides = {}) {
  return {
    property_id: 1,
    check_in: '2025-06-10',
    check_out: '2025-06-20',   // 10 nights
    converted_total_price: 1000,
    platform: 'Direct booking', // no deductions unless a test opts in
    status: 'confirmed',
    ...overrides,
  };
}

// Airbnb booking with fees configured: 15% commission, 2% bank, 15% VAT
// on (commission + bank) → 19.55% total deductions.
function bFees(overrides = {}) {
  return b({
    platform: 'Airbnb',
    prop_commission_airbnb: 15,
    bank_charge_airbnb: 2,
    vat_airbnb: 15,
    ...overrides,
  });
}

// --- stayNights ----------------------------------------------------------

test('stayNights: derived from dates, not the stored length_of_stay', () => {
  // Pro-rata must divide by the same night count the window overlap
  // measures against, or parts won't sum to the whole.
  const booking = b({ check_in: '2025-06-10', check_out: '2025-06-20', length_of_stay: 999 });
  assert.equal(stayNights(booking), 10);
});

test('stayNights: falls back to length_of_stay when dates are unusable', () => {
  const booking = { check_in: '2025-06-10', check_out: '2025-06-10', length_of_stay: 3 };
  assert.equal(stayNights(booking), 3);
});

test('stayNights: never returns 0 (would divide by zero)', () => {
  assert.equal(stayNights({ check_in: '2025-06-10', check_out: '2025-06-10' }), 1);
});

// --- nightsInWindow ------------------------------------------------------

test('nightsInWindow: stay entirely inside the window counts every night', () => {
  const booking = b({ check_in: '2025-06-10', check_out: '2025-06-15' }); // 5 nights
  assert.equal(nightsInWindow(booking, '2025-06-01', '2025-07-01'), 5);
});

test('nightsInWindow: stay entirely outside counts 0', () => {
  const booking = b({ check_in: '2025-05-01', check_out: '2025-05-05' });
  assert.equal(nightsInWindow(booking, '2025-06-01', '2025-07-01'), 0);
});

test('nightsInWindow: stay straddling the window START is clipped', () => {
  // Stay 05–15 June; window opens 10 June → nights 10..15 = 5.
  const booking = b({ check_in: '2025-06-05', check_out: '2025-06-15' });
  assert.equal(nightsInWindow(booking, '2025-06-10', '2025-07-01'), 5);
});

test('nightsInWindow: stay straddling the window END is clipped', () => {
  // Stay 05–15 June; window closes 10 June (exclusive) → nights 05..10 = 5.
  const booking = b({ check_in: '2025-06-05', check_out: '2025-06-15' });
  assert.equal(nightsInWindow(booking, '2025-06-01', '2025-06-10'), 5);
});

test('nightsInWindow: stay spanning the whole window counts the window length', () => {
  const booking = b({ check_in: '2025-01-01', check_out: '2025-12-31' });
  assert.equal(nightsInWindow(booking, '2025-06-01', '2025-06-11'), 10);
});

test('nightsInWindow: check_out ON the window start counts 0 (half-open)', () => {
  // Guest left the morning the window opened — no nights inside it.
  const booking = b({ check_in: '2025-06-01', check_out: '2025-06-10' });
  assert.equal(nightsInWindow(booking, '2025-06-10', '2025-07-01'), 0);
});

test('nightsInWindow: check_in ON the window end counts 0 (half-open)', () => {
  const booking = b({ check_in: '2025-06-10', check_out: '2025-06-20' });
  assert.equal(nightsInWindow(booking, '2025-06-01', '2025-06-10'), 0);
});

test('nightsInWindow: null bounds mean unbounded on that side', () => {
  const booking = b({ check_in: '2025-06-10', check_out: '2025-06-20' });
  assert.equal(nightsInWindow(booking, null, '2025-06-15'), 5);
  assert.equal(nightsInWindow(booking, '2025-06-15', null), 5);
  assert.equal(nightsInWindow(booking, null, null), 10);
});

// --- revenueInWindow: the core pro-rata behaviour ------------------------

test('revenueInWindow: fully-contained stay contributes its whole amount', () => {
  const rows = [b({ check_in: '2025-06-10', check_out: '2025-06-20', converted_total_price: 1000 })];
  assert.equal(revenueInWindow(rows, '2025-06-01', '2025-07-01'), 1000);
});

test('revenueInWindow: half the nights in window → half the revenue', () => {
  // 10-night stay at R1000 = R100/night. Window captures 5 nights → R500.
  const rows = [b({ check_in: '2025-06-05', check_out: '2025-06-15', converted_total_price: 1000 })];
  assert.equal(revenueInWindow(rows, '2025-06-10', '2025-07-01'), 500);
});

test('revenueInWindow: THE regression case — long stay split across periods', () => {
  // This is the Jack Spence booking that made Home and Analytics disagree:
  // 100 nights, R25 800, checked in 22 Apr, checked out 31 Jul.
  // Under check-in attribution the whole amount landed in April; under
  // check-out attribution it all landed in July. Pro-rata splits it.
  const jack = b({
    check_in: '2026-04-22',
    check_out: '2026-07-31',
    converted_total_price: 25800,
  });
  assert.equal(stayNights(jack), 100);

  // July: he checks out on the 31st, so his July nights are 01–30 Jul
  // = 30 nights → 30 × R258 = R7 740.
  const july = revenueInWindow([jack], '2026-07-01', '2026-08-01');
  assert.equal(july, 7740);

  // April: he checks in on the 22nd, so nights 22–30 Apr = 9 nights
  // → 9 × R258 = R2 322.
  const april = revenueInWindow([jack], '2026-04-01', '2026-05-01');
  assert.equal(april, 2322);
});

test('revenueInWindow: monthly slices of one booking sum back to its total', () => {
  // The invariant that makes pro-rata trustworthy — no revenue is created
  // or lost by slicing a stay into periods.
  const jack = b({ check_in: '2026-04-22', check_out: '2026-07-31', converted_total_price: 25800 });
  const months = [
    ['2026-04-01', '2026-05-01'],
    ['2026-05-01', '2026-06-01'],
    ['2026-06-01', '2026-07-01'],
    ['2026-07-01', '2026-08-01'],
  ];
  const sum = months.reduce((acc, [from, to]) => acc + revenueInWindow([jack], from, to), 0);
  assert.equal(Math.round(sum), 25800);
});

test('revenueInWindow: cancelled and blocked bookings never contribute', () => {
  const rows = [
    b({ converted_total_price: 1000 }),
    b({ converted_total_price: 5000, status: 'cancelled' }),
    b({ converted_total_price: 5000, platform: 'Blocked channel' }),
  ];
  assert.equal(revenueInWindow(rows, '2025-06-01', '2025-07-01'), 1000);
});

test('revenueInWindow: uses converted_total_price, never raw total_price', () => {
  // Multi-currency safety — raw total_price would sum ZAR and EUR together.
  const rows = [b({ converted_total_price: 1000, total_price: 999999 })];
  assert.equal(revenueInWindow(rows, '2025-06-01', '2025-07-01'), 1000);
});

test('revenueInWindow: empty input → 0', () => {
  assert.equal(revenueInWindow([], '2025-06-01', '2025-07-01'), 0);
});

// --- net mode ------------------------------------------------------------

test('revenueInWindow net: deductions come off before the nightly split', () => {
  // R1000 gross, 19.55% deductions → R804.50 net over 10 nights.
  const rows = [bFees({ check_in: '2025-06-10', check_out: '2025-06-20', converted_total_price: 1000 })];
  assert.equal(revenueInWindow(rows, '2025-06-01', '2025-07-01', { net: true }), 804.5);
});

test('revenueInWindow net: partial window gets the net nightly rate', () => {
  // Net R804.50 over 10 nights = R80.45/night; 5 nights → R402.25.
  const rows = [bFees({ check_in: '2025-06-05', check_out: '2025-06-15', converted_total_price: 1000 })];
  assert.equal(revenueInWindow(rows, '2025-06-10', '2025-07-01', { net: true }), 402.25);
});

test('revenueInWindow net: direct bookings have no deductions, net === gross', () => {
  const rows = [b({ platform: 'Direct booking', converted_total_price: 1000 })];
  const gross = revenueInWindow(rows, '2025-06-01', '2025-07-01');
  const net = revenueInWindow(rows, '2025-06-01', '2025-07-01', { net: true });
  assert.equal(net, gross);
});

test('revenueInWindow net: falls back to Smoobu commission when no property rate is set', () => {
  const rows = [b({
    platform: 'Booking.com',
    converted_total_price: 5000,
    converted_commission: 750,
  })];
  assert.equal(revenueInWindow(rows, '2025-06-01', '2025-07-01', { net: true }), 4250);
});

test('net never exceeds gross', () => {
  const rows = [
    bFees({ converted_total_price: 3000 }),
    bFees({ converted_total_price: 5000 }),
  ];
  const gross = revenueInWindow(rows, '2025-06-01', '2025-07-01');
  const net = revenueInWindow(rows, '2025-06-01', '2025-07-01', { net: true });
  assert.ok(net <= gross, `net ${net} must not exceed gross ${gross}`);
});

// --- earned / coming partition ------------------------------------------

test('earned: counts only nights already slept', () => {
  // 10-night stay 01–11 June at R1000 (R100/night). Today is 06 June, so
  // nights 01–06 are slept → R500.
  const rows = [b({ check_in: '2025-06-01', check_out: '2025-06-11', converted_total_price: 1000 })];
  assert.equal(revenueEarned(rows, '2025-06-06', 30), 500);
});

test('coming: counts only nights not yet slept', () => {
  // Same stay, same today → nights 06–11 remain → R500.
  const rows = [b({ check_in: '2025-06-01', check_out: '2025-06-11', converted_total_price: 1000 })];
  assert.equal(revenueComing(rows, '2025-06-06'), 500);
});

test('earned + coming partition an in-progress stay exactly', () => {
  // The property that makes the two KPI cards trustworthy: no night is
  // counted twice and none is dropped.
  const rows = [b({ check_in: '2025-06-01', check_out: '2025-06-11', converted_total_price: 1000 })];
  const earned = revenueEarned(rows, '2025-06-06', 30);
  const coming = revenueComing(rows, '2025-06-06');
  assert.equal(earned + coming, 1000);
});

test('earned: ignores nights older than the window', () => {
  // Stay ended 40 days before today — outside a 30-day earned window.
  const rows = [b({ check_in: '2025-04-01', check_out: '2025-04-11', converted_total_price: 1000 })];
  assert.equal(revenueEarned(rows, '2025-06-01', 30), 0);
});

test('earned: a stay straddling the window start counts only nights inside it', () => {
  // Today 2025-07-01, window opens 2025-06-01. Stay 25 May – 05 Jun is
  // 11 nights at R1100 → R100/night. The guest leaves on the 5th, so the
  // nights inside June are 01–04 = 4 → R400.
  const rows = [b({ check_in: '2025-05-25', check_out: '2025-06-05', converted_total_price: 1100 })];
  assert.equal(revenueEarned(rows, '2025-07-01', 30), 400);
});

test('coming: purely future booking counts in full', () => {
  const rows = [b({ check_in: '2025-08-01', check_out: '2025-08-06', converted_total_price: 2500 })];
  assert.equal(revenueComing(rows, '2025-06-01'), 2500);
});

test('coming: fully past booking counts 0', () => {
  const rows = [b({ check_in: '2025-05-01', check_out: '2025-05-06', converted_total_price: 2500 })];
  assert.equal(revenueComing(rows, '2025-06-01'), 0);
});

// --- nightsSoldInWindow + avgRateEarned ---------------------------------

test('nightsSoldInWindow: sums clipped nights, skipping cancelled and blocked', () => {
  const rows = [
    b({ check_in: '2025-06-01', check_out: '2025-06-06' }),                            // 5
    b({ check_in: '2025-06-10', check_out: '2025-06-13' }),                            // 3
    b({ check_in: '2025-06-15', check_out: '2025-06-20', status: 'cancelled' }),       // 0
    b({ check_in: '2025-06-20', check_out: '2025-06-25', platform: 'Blocked' }),       // 0
  ];
  assert.equal(nightsSoldInWindow(rows, '2025-06-01', '2025-07-01'), 8);
});

test('avgRateEarned: ADR — revenue over nights, not a mean of booking rates', () => {
  // A 9-night stay at R100/night and a 1-night stay at R1000.
  // ADR = (900 + 1000) / 10 = R190.
  // A mean of the two nightly rates would give R550 — wrong, because it
  // weights the 1-night stay as heavily as the 9-night one.
  const rows = [
    b({ check_in: '2025-06-01', check_out: '2025-06-10', converted_total_price: 900 }),
    b({ check_in: '2025-06-10', check_out: '2025-06-11', converted_total_price: 1000 }),
  ];
  assert.equal(avgRateEarned(rows, '2025-07-01', 30), 190);
});

test('avgRateEarned: 0 when no nights were sold (no NaN)', () => {
  assert.equal(avgRateEarned([], '2025-06-01', 30), 0);
});

test('avgRateEarned: future stays do not influence the earned rate', () => {
  const rows = [
    b({ check_in: '2025-06-01', check_out: '2025-06-11', converted_total_price: 1000 }), // R100/night
    b({ check_in: '2025-08-01', check_out: '2025-08-11', converted_total_price: 90000 }), // future
  ];
  assert.equal(avgRateEarned(rows, '2025-06-15', 30), 100);
});
