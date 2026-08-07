/**
 * Data integrity detectors.
 *
 * These are pure functions that FIND violations of business rules — they
 * don't enforce anything. Callers can use them for:
 *   - unit tests that assert expected behaviour on fixtures
 *   - a health-check endpoint that reports current DB violations
 *   - a pre-write validator that rejects bad input
 *
 * Rules covered:
 *   - Booking overlap: two confirmed bookings for the same property whose
 *     [check_in, check_out) intervals overlap. This shouldn't happen when
 *     Smoobu is the source of truth, but the sync doesn't defend against
 *     Smoobu sending impossible data.
 *   - Invalid date range: check_in >= check_out (zero- or negative-length
 *     stay). Currently allowed by the schema.
 *   - Cleaner double-booking: same cleaner assigned to more than one
 *     non-completed cleaning job on the same date. `assignCleanerForCheckout`
 *     guards against this at write time; the detector catches drift from
 *     other write paths.
 *
 * All bookings/jobs are considered as objects with at least the fields
 * documented per function.
 */

/**
 * Two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd AND bStart < aEnd. YYYY-MM-DD strings compare
 * lexicographically, so no Date parsing needed.
 */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Find overlapping booking pairs.
 *
 * bookings: [{ id, property_id, check_in, check_out, status, platform }]
 *
 * Only confirmed, non-blocked bookings are considered — cancelled/blocked
 * rows can legitimately share dates with real ones.
 *
 * Returns: array of [a, b] booking pairs, each ordered by check_in ASC.
 * Same booking id never pairs with itself. Each unordered pair appears
 * exactly once.
 */
function findOverlappingBookings(bookings) {
  const relevant = bookings.filter(
    (b) => b.status !== 'cancelled' && !isBlockedPlatform(b.platform)
  );
  const byProperty = new Map();
  for (const b of relevant) {
    if (!byProperty.has(b.property_id)) byProperty.set(b.property_id, []);
    byProperty.get(b.property_id).push(b);
  }
  const overlaps = [];
  for (const list of byProperty.values()) {
    list.sort((a, b) => a.check_in.localeCompare(b.check_in));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        // Sorted by check_in ascending: if list[j].check_in >= list[i].check_out,
        // it can't overlap and neither can anything further along.
        if (list[j].check_in >= list[i].check_out) break;
        if (intervalsOverlap(list[i].check_in, list[i].check_out, list[j].check_in, list[j].check_out)) {
          overlaps.push([list[i], list[j]]);
        }
      }
    }
  }
  return overlaps;
}

/**
 * Find bookings with an invalid date range: check_in >= check_out.
 * (A zero-night booking sneaks through as check_in == check_out.)
 */
function findInvalidBookingDates(bookings) {
  return bookings.filter((b) => b.check_in >= b.check_out);
}

/**
 * Find cleaners assigned to multiple non-completed jobs on the same day.
 *
 * jobs: [{ id, cleaner_id, cleaning_date, status }]
 *
 * Returns: array of { cleaner_id, cleaning_date, jobs } — one entry per
 * (cleaner, day) combination that has ≥2 non-completed jobs.
 */
function findCleanerDoubleBookings(jobs) {
  const groups = new Map(); // "cleaner_id|date" -> [jobs]
  for (const j of jobs) {
    if (j.status === 'completed') continue;
    if (!j.cleaner_id) continue; // unassigned jobs can't double-book
    const key = `${j.cleaner_id}|${normaliseDate(j.cleaning_date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const dupes = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const [cleanerIdStr, cleaning_date] = key.split('|');
    dupes.push({ cleaner_id: Number(cleanerIdStr), cleaning_date, jobs: list });
  }
  return dupes;
}

// pg returns `date` columns as Date objects; normalise to YYYY-MM-DD string
// so the grouping key is stable regardless of caller shape.
function normaliseDate(v) {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// Local copy to avoid a require cycle if integrity is ever pulled by
// analytics-calc. Kept in sync with analytics-calc.isBlockedPlatform.
function isBlockedPlatform(platform) {
  if (!platform) return false;
  return platform.toLowerCase().startsWith('blocked');
}

module.exports = {
  intervalsOverlap,
  findOverlappingBookings,
  findInvalidBookingDates,
  findCleanerDoubleBookings,
};
