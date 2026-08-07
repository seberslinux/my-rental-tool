/**
 * Revenue attribution — THE single source of truth.
 *
 * Every revenue figure in the app (Home KPI cards, Analytics summary,
 * Analytics monthly trend) resolves through this module. If a number needs
 * to change, it changes here once and every surface follows.
 *
 * ## Attribution rule: nightly pro-rata
 *
 * A booking's revenue is spread evenly across the nights of the stay, and
 * each night is attributed to the date it falls on. A 100-night stay for
 * R25 800 earns R258 per night; asking "how much did June earn?" counts
 * only that booking's June nights.
 *
 * The alternatives (attribute the whole amount on check-in, or on
 * check-out) make long stays land as a single lump in one month, which
 * makes month-over-month comparisons meaningless and made the Home and
 * Analytics pages disagree — the same booking appeared in different
 * periods depending on which page you were looking at.
 *
 * ## Window convention
 *
 * Windows are half-open `[from, to)` over nights, matching the booking
 * convention `[check_in, check_out)` — a guest occupies the check-in night
 * and is gone on the check-out date.
 *
 * `earned`  = nights in `[today - N, today)`   — nights already slept
 * `coming`  = nights in `[today, ∞)`           — nights not yet slept
 *
 * These partition exactly at `today`, so a guest currently mid-stay has
 * their past nights in "earned" and their remaining nights in "coming"
 * with no double-count and no gap.
 *
 * ## Input shape
 *
 * Bookings must already be currency-converted (see exchange-rates
 * `bulkConvert`), i.e. carry `converted_total_price` and
 * `converted_commission`. Deductions come from `calcDeductions`, so the
 * per-property fee columns must be joined in — see the query in
 * `/api/dashboard/kpis`.
 */

const { calcDeductions, isBlockedPlatform } = require('./analytics-calc');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A date far enough out to stand in for "no upper bound" on future windows.
const FAR_FUTURE = '9999-12-31';

function toUtcMs(dateStr) {
  return Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
}

function isCountable(b) {
  return b.status !== 'cancelled' && !isBlockedPlatform(b.platform);
}

/**
 * Total nights of the stay, derived from the dates rather than trusting
 * `length_of_stay` — pro-rata must divide by the same night count the
 * window overlap is measured against, or the parts won't sum to the whole.
 * Falls back to `length_of_stay`, then 1, for malformed rows.
 */
function stayNights(booking) {
  const { check_in: ci, check_out: co } = booking;
  if (ci && co) {
    const n = Math.round((toUtcMs(co) - toUtcMs(ci)) / MS_PER_DAY);
    if (n > 0) return n;
  }
  return Math.max(1, booking.length_of_stay || 1);
}

/**
 * How many of `booking`'s nights fall inside the half-open window
 * `[fromStr, toStr)`. Returns 0 when the stay is entirely outside.
 *
 * `fromStr` may be null for "no lower bound", `toStr` null for "no upper
 * bound".
 */
function nightsInWindow(booking, fromStr, toStr) {
  const { check_in: ci, check_out: co } = booking;
  if (!ci || !co) return 0;

  const start = fromStr && fromStr > ci ? fromStr : ci;
  const end = toStr && toStr < co ? toStr : co;
  if (start >= end) return 0;

  return Math.round((toUtcMs(end) - toUtcMs(start)) / MS_PER_DAY);
}

/**
 * Pro-rata revenue for all nights falling inside `[fromStr, toStr)`.
 *
 * `net: true` subtracts commission + bank charges + VAT (via
 * calcDeductions) before spreading across nights, so the per-night figure
 * is what actually reaches the owner.
 *
 * Cancelled and blocked-platform bookings never contribute.
 */
function revenueInWindow(bookings, fromStr, toStr, { net = false } = {}) {
  let total = 0;
  for (const b of bookings) {
    if (!isCountable(b)) continue;

    const nights = nightsInWindow(b, fromStr, toStr);
    if (nights <= 0) continue;

    const gross = b.converted_total_price || 0;
    const amount = net ? gross - calcDeductions(b) : gross;
    total += (amount / stayNights(b)) * nights;
  }
  return total;
}

/** Nights across all bookings that fall inside `[fromStr, toStr)`. */
function nightsSoldInWindow(bookings, fromStr, toStr) {
  let total = 0;
  for (const b of bookings) {
    if (!isCountable(b)) continue;
    total += nightsInWindow(b, fromStr, toStr);
  }
  return total;
}

/**
 * Revenue for nights already slept: `[todayStr - days, todayStr)`.
 * A guest mid-stay contributes only the nights up to last night.
 */
function revenueEarned(bookings, todayStr, days = 30, opts = {}) {
  const from = shiftDate(todayStr, -days);
  return revenueInWindow(bookings, from, todayStr, opts);
}

/**
 * Revenue for nights not yet slept: `[todayStr, ∞)`. Includes the
 * remaining nights of an in-progress stay plus every future booking.
 */
function revenueComing(bookings, todayStr, opts = {}) {
  return revenueInWindow(bookings, todayStr, FAR_FUTURE, opts);
}

/**
 * Average nightly rate over nights slept in `[todayStr - days, todayStr)`.
 *
 * This is ADR (revenue ÷ nights), not a mean of per-booking rates — a
 * 10-night stay influences the average ten times as much as a 1-night
 * stay, which is what "average rate achieved" should mean.
 */
function avgRateEarned(bookings, todayStr, days = 30, opts = {}) {
  const from = shiftDate(todayStr, -days);
  const revenue = revenueInWindow(bookings, from, todayStr, opts);
  const nights = nightsSoldInWindow(bookings, from, todayStr);
  return nights > 0 ? Math.round(revenue / nights) : 0;
}

function shiftDate(dateStr, days) {
  return new Date(toUtcMs(dateStr) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

module.exports = {
  stayNights,
  nightsInWindow,
  nightsSoldInWindow,
  revenueInWindow,
  revenueEarned,
  revenueComing,
  avgRateEarned,
  FAR_FUTURE,
};
