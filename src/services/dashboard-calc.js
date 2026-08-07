/**
 * Pure predicates and derivations for the "today" dashboard.
 *
 * These are the classifiers that answer:
 *   - who's arriving today?
 *   - who's leaving today?
 *   - who's currently in-house?
 *   - what's the occupancy for the next N days?
 *   - is this property blocked right now?
 *
 * They take an explicit `todayStr` (YYYY-MM-DD) rather than reading a clock,
 * so tests can pin any date. All comparisons are string-lexical on YYYY-MM-DD
 * to avoid timezone drift.
 *
 * Booking convention (matches Smoobu / this app's DB):
 *   - check_in  = date the guest arrives (occupied that night)
 *   - check_out = date the guest leaves (NOT occupied that night — the
 *     property is available for a new arrival on this date)
 *   - So `[check_in, check_out)` is the half-open occupancy window.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- Booking-level predicates ---------------------------------------------

function isCancelled(booking) {
  return booking.status === 'cancelled';
}

function isBlocked(booking) {
  return (booking.platform || '').toLowerCase().includes('block');
}

// Guest is in the property on `dateStr` iff check_in <= dateStr < check_out.
function occupiesOn(booking, dateStr) {
  return booking.check_in <= dateStr && dateStr < booking.check_out;
}

function arrivesOn(booking, dateStr) {
  return booking.check_in === dateStr;
}

function departsOn(booking, dateStr) {
  return booking.check_out === dateStr;
}

// --- Collection derivations ------------------------------------------------

// Bookings currently in-house on `dateStr`. Excludes cancelled and blocked.
function inHouseOn(bookings, dateStr) {
  return bookings.filter(b =>
    !isCancelled(b) && !isBlocked(b) && occupiesOn(b, dateStr)
  );
}

// Bookings that begin exactly on `dateStr`. Excludes cancelled and blocked.
function arrivalsOn(bookings, dateStr) {
  return bookings.filter(b =>
    !isCancelled(b) && !isBlocked(b) && arrivesOn(b, dateStr)
  );
}

// Bookings that end exactly on `dateStr`. Excludes cancelled and blocked.
function departuresOn(bookings, dateStr) {
  return bookings.filter(b =>
    !isCancelled(b) && !isBlocked(b) && departsOn(b, dateStr)
  );
}

// Bookings arriving within a rolling window starting at `todayStr`, sorted
// by check_in ascending. `days = 7` means today plus the next 6 days.
function upcomingArrivals(bookings, todayStr, days = 7) {
  const endStr = addDays(todayStr, days - 1);
  return bookings
    .filter(b =>
      !isCancelled(b) && !isBlocked(b) &&
      b.check_in >= todayStr && b.check_in <= endStr
    )
    .sort((a, b) => a.check_in.localeCompare(b.check_in));
}

// Bookings departing within a rolling window starting at `todayStr`.
function upcomingDepartures(bookings, todayStr, days = 7) {
  const endStr = addDays(todayStr, days - 1);
  return bookings
    .filter(b =>
      !isCancelled(b) && !isBlocked(b) &&
      b.check_out >= todayStr && b.check_out <= endStr
    )
    .sort((a, b) => a.check_out.localeCompare(b.check_out));
}

// Per-property: the next real arrival strictly after `todayStr`. Returns a
// Map(propertyId -> booking) — omits properties with no upcoming arrival.
function nextArrivalByProperty(bookings, todayStr) {
  const sorted = bookings
    .filter(b => !isCancelled(b) && !isBlocked(b) && b.check_in > todayStr)
    .sort((a, b) => a.check_in.localeCompare(b.check_in));
  const map = new Map();
  for (const b of sorted) {
    if (!map.has(b.property_id)) map.set(b.property_id, b);
  }
  return map;
}

// Is this property currently blocked (non-guest reservation active now)?
// Returns the blocking booking if any, else null.
function activeBlockOn(bookings, propertyId, dateStr) {
  return bookings.find(b =>
    b.property_id === propertyId &&
    !isCancelled(b) &&
    isBlocked(b) &&
    occupiesOn(b, dateStr)
  ) || null;
}

// Booked nights per property in the window [todayStr, todayStr + days).
// Excludes cancelled and blocked bookings. Rate = bookedNights / days * 100.
function occupancyByProperty(bookings, propertyIds, todayStr, days = 30) {
  const windowEnd = addDays(todayStr, days); // exclusive
  return propertyIds.map(propertyId => {
    let bookedNights = 0;
    for (const b of bookings) {
      if (b.property_id !== propertyId) continue;
      if (isCancelled(b) || isBlocked(b)) continue;
      const start = b.check_in > todayStr ? b.check_in : todayStr;
      const end = b.check_out < windowEnd ? b.check_out : windowEnd;
      const nights = daysBetween(start, end);
      if (nights > 0) bookedNights += nights;
    }
    return {
      property_id: propertyId,
      booked_nights: bookedNights,
      occupancy_rate: Math.round((bookedNights / days) * 100),
    };
  });
}

// 1-3 night gaps between consecutive real bookings for each property, only
// including gaps that start on or after `todayStr`.
function detectGaps(bookings, todayStr, { minNights = 1, maxNights = 3 } = {}) {
  const byProp = new Map();
  for (const b of bookings) {
    if (isCancelled(b) || isBlocked(b)) continue;
    if (b.check_out < todayStr) continue;
    if (!byProp.has(b.property_id)) byProp.set(b.property_id, []);
    byProp.get(b.property_id).push(b);
  }
  const gaps = [];
  for (const [propertyId, list] of byProp) {
    list.sort((a, b) => a.check_in.localeCompare(b.check_in));
    for (let i = 0; i < list.length - 1; i++) {
      const gapStart = list[i].check_out;
      const gapEnd = list[i + 1].check_in;
      const nights = daysBetween(gapStart, gapEnd);
      if (nights >= minNights && nights <= maxNights) {
        gaps.push({ property_id: propertyId, gap_start: gapStart, gap_end: gapEnd, nights });
      }
    }
  }
  return gaps;
}

// --- Date utilities (UTC-only to avoid timezone drift) --------------------

function addDays(dateStr, days) {
  const t = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(fromStr, toStr) {
  const from = Date.UTC(
    Number(fromStr.slice(0, 4)),
    Number(fromStr.slice(5, 7)) - 1,
    Number(fromStr.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toStr.slice(0, 4)),
    Number(toStr.slice(5, 7)) - 1,
    Number(toStr.slice(8, 10)),
  );
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Occupancy for each of the next `months` calendar months.
 *
 * Answers the question the 30-day occupancy KPI cannot: "is my calendar
 * filling up?" — but only over the horizon where the answer means
 * something.
 *
 * Measured against this portfolio's own history, booking lead time is
 * median 25 days and 75th percentile 61 days: three quarters of bookings
 * arrive within two months. A month three or more out is therefore
 * expected to look empty, and reporting that as a shortfall manufactures
 * alarm from noise. Three months covers the window where a gap is both
 * real and still fillable.
 *
 * The first entry is the CURRENT month, but measured only from `todayStr`
 * onward — nights already gone are neither sellable nor a fair part of
 * the denominator. It is flagged `is_partial` so the UI can label it
 * ("rest of Aug") rather than implying a full-month comparison.
 *
 * Returns one row per month:
 *   { month, nights_booked, nights_available, occupancy_rate,
 *     revenue, is_partial }
 */
function forwardOccupancy(bookings, propertyCount, todayStr, months = 3) {
  const { nightsSoldInWindow, revenueInWindow } = require('./revenue');

  let year = Number(todayStr.slice(0, 4));
  let month = Number(todayStr.slice(5, 7));
  const out = [];

  for (let i = 0; i < months; i++) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    // Only the current month is clipped; later months count in full.
    const isPartial = i === 0 && todayStr > monthStart;
    const windowStart = isPartial ? todayStr : monthStart;

    const nightsAvailable = daysBetween(windowStart, monthEnd) * propertyCount;
    const nightsBooked = nightsSoldInWindow(bookings, windowStart, monthEnd);

    out.push({
      month: monthStart.slice(0, 7),
      nights_booked: nightsBooked,
      nights_available: nightsAvailable,
      occupancy_rate: nightsAvailable > 0
        ? Math.round((nightsBooked / nightsAvailable) * 100)
        : 0,
      revenue: Math.round(revenueInWindow(bookings, windowStart, monthEnd)),
      is_partial: isPartial,
    });

    year = nextYear;
    month = nextMonth;
  }

  return out;
}

module.exports = {
  // predicates
  isCancelled,
  isBlocked,
  occupiesOn,
  arrivesOn,
  departsOn,
  // collection derivations
  inHouseOn,
  arrivalsOn,
  departuresOn,
  upcomingArrivals,
  upcomingDepartures,
  nextArrivalByProperty,
  activeBlockOn,
  occupancyByProperty,
  forwardOccupancy,
  detectGaps,
  // date utilities
  addDays,
  daysBetween,
};
