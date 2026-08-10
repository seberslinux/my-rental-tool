/**
 * What cleaning a property needs, and who should do it.
 *
 * These three questions used to be one function. assignCleanerForCheckout
 * decided a clean was wanted, picked somebody, sent the message, and
 * blocked the property in Smoobu when nobody could come — all in one
 * loop, all triggered by a checkout. Every new rule had to be threaded
 * into the middle of it, and a rule about arrivals had nowhere to go at
 * all.
 *
 * So: this module says what *should* exist. Assignment says who does it.
 * Reconciling says make it so. Each is testable without the others.
 *
 * ## The two kinds of clean
 *
 * A departure always wants one. That is what makes the property sellable
 * again the moment the guests are out, which is the whole point — an
 * instant booking should never arrive to a dirty flat.
 *
 * An arrival wants one only if the property will not already be clean:
 * nobody has stayed since the last clean, and that clean is recent enough
 * to still count. A checkout clean serves whoever comes next; an arrival
 * clean serves one booking. Both are real, and a property should never
 * get both for the same gap.
 */

const { isBlockedPlatform } = require('./analytics-calc');
const { needsCleanBefore, ymd } = require('./cleaning-status');

/**
 * The cleans a property ought to have over a window.
 *
 * Pure: hand it the bookings and the jobs and it will tell you what is
 * missing, without touching a database or caring how it got there.
 * Returns one entry per clean that should exist, each saying which day,
 * why, and which booking prompted it.
 */
function planCleans({ property, stays = [], jobs = [], from, to }) {
  const guestStays = stays.
  filter((s) => s.status === 'confirmed' && !isBlockedPlatform(s.platform)).
  sort((a, b) => ymd(a.check_in).localeCompare(ymd(b.check_in)));

  const wanted = [];
  const seen = new Set();
  const want = (date, reason, booking, why) => {
    if (date < from || date > to) return;
    // One clean per day per property. A departure and the next arrival
    // falling on the same day is a turnover, not two visits.
    if (seen.has(date)) return;
    seen.add(date);
    wanted.push({ date, reason, booking_id: booking ? booking.smoobu_id : null, why });
  };

  // Departures first, because a checkout clean covers the arrival that
  // follows it and claiming the day stops a second one being planned.
  guestStays.forEach((s) => {
    want(ymd(s.check_out), 'checkout', s, 'guests leave, ready for whoever is next');
  });

  guestStays.forEach((s) => {
    const arrival = ymd(s.check_in);
    if (seen.has(arrival)) return;

    // Everything already planned counts as a clean that will have
    // happened, so an arrival three days after a checkout clean does not
    // ask for another one.
    const projected = jobs.concat(
      wanted.
      filter((w) => w.date < arrival).
      map((w) => ({ cleaning_date: w.date, status: 'pending' }))
    );

    const verdict = needsCleanBefore({ property, stays, jobs: projected, arrival });
    if (verdict.needed) {
      want(arrival, 'checkin', s, verdict.why);
    }
  });

  return wanted.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Which of those are not yet on the books.
 *
 * A job that has been declined does not count as covering the day — the
 * work still needs doing, by somebody else.
 */
function missingFrom(planned, jobs) {
  const covered = new Set(
    jobs.
    filter((j) => !['declined', 'cancelled'].includes(j.status)).
    map((j) => ymd(j.cleaning_date))
  );
  return planned.filter((p) => !covered.has(p.date));
}

module.exports = { planCleans, missingFrom };
