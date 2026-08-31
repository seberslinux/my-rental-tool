/**
 * What Smoobu's markup has actually been doing.
 *
 * The percentage each channel adds to your rate is set in Smoobu, not
 * here, and Smoobu is the only authority on it — whatever this module
 * says, the guest pays what that setting decides. But the setting leaves
 * evidence: every booking records what the guest was charged, and
 * `daily_rates` records what you were asking for those nights. The ratio
 * of the two is the markup, observed rather than declared.
 *
 * That is worth having because the alternative is somebody typing a
 * number from memory into a field that then quietly governs every price
 * comparison on the Rates page.
 *
 * ## What this is not
 *
 * An estimate, and it says so. It is offered as "this is what your last
 * six Airbnb bookings imply" so somebody can accept it or overrule it —
 * never written anywhere on its own.
 *
 * ## Why the sample is small
 *
 * `daily_rates` is synced from today forward and overwritten each run,
 * so there is no record of what a night cost last March. Only bookings
 * whose nights still carry a rate can be measured, which in practice
 * means future ones. A booking missing a rate for even one of its nights
 * is dropped rather than measured against a partial total — an
 * understated base would inflate the ratio, and a confidently wrong
 * markup is worse than none.
 *
 * ## Median, not mean
 *
 * One long stay straddling a repriced weekend would drag an average
 * anywhere. The median is what the typical booking says, and the spread
 * is reported beside it so a wide one can be distrusted on sight.
 */

const { normalizePlatform, isBlockedPlatform } = require('./analytics-calc');

/**
 * How far observations may range and still look like one setting.
 *
 * Ten percentage points. A channel markup is a fixed number, so real
 * observations of one sit close together; anything wider is being moved
 * by something this cannot see.
 */
const SPREAD_LIMIT = 10;

const DAY = 86400000;
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** The channel keys the rest of the app uses, from the display names. */
const KEY_FOR = {
  'Airbnb': 'airbnb',
  'Booking.com': 'booking',
  'VRBO': 'vrbo',
};

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Every night of a stay, check-out exclusive. */
function nightsOf(booking) {
  const out = [];
  for (let d = parse(booking.check_in); d < parse(booking.check_out); d = new Date(d.getTime() + DAY)) {
    out.push(ymd(d));
  }
  return out;
}

/**
 * What each channel appears to be adding.
 *
 * `rates` is `{ 'YYYY-MM-DD': price }` — what you were asking for that
 * night. `bookings` are stays with `total_price`, `platform`, `check_in`
 * and `check_out`.
 *
 * Returns one entry per channel that had anything to measure. A channel
 * with no usable bookings is absent rather than reported as zero, which
 * would read as "no markup" when it means "no idea".
 */
function observedMarkup({ bookings = [], rates = {} } = {}) {
  const samples = {};

  for (const b of bookings) {
    if (b.status && b.status !== 'confirmed') continue;
    if (isBlockedPlatform(b.platform)) continue;

    const key = KEY_FOR[normalizePlatform(b.platform)];
    // Direct bookings have no channel adding anything, so there is
    // nothing here to learn from them.
    if (!key) continue;

    const nights = nightsOf(b);
    if (nights.length === 0) continue;

    // Every night, or none. A base summed over four nights of a
    // five-night stay makes the markup look 25% larger than it is.
    let base = 0;
    let complete = true;
    for (const n of nights) {
      const price = Number(rates[n]);
      if (!Number.isFinite(price) || price <= 0) { complete = false; break; }
      base += price;
    }
    if (!complete) continue;

    const paid = Number(b.total_price);
    if (!Number.isFinite(paid) || paid <= 0) continue;

    (samples[key] = samples[key] || []).push({
      ratio: paid / base,
      // Kept for the caller to reject: see below.
      nights: nights.length,
      from: nights[0],
    });
  }

  const out = {};
  for (const [key, rows] of Object.entries(samples)) {
    /**
     * A markup is never negative.
     *
     * `base` is what the rate is *now*, because Smoobu keeps one price
     * per date and forgets the previous one — there is no history
     * endpoint, and a booking carries no per-night breakdown. So when a
     * rate has been changed since a booking was taken, `paid / base` can
     * land below 1 and the channel is reported as taking money off the
     * price it adds to.
     *
     * That is not a small markup, it is a wrong denominator, and
     * averaging it in poisons the median. Such a booking is evidence
     * only that the rate moved, so it is discarded rather than counted.
     */
    const usable = rows.filter((r) => r.ratio >= 1);
    if (usable.length === 0) {
      out[key] = {
        confident: false,
        markup: null,
        bookings: 0,
        stale: rows.length,
        nights: 0,
        low: null,
        high: null,
      };
      continue;
    }

    const ratios = usable.map((r) => r.ratio);
    const mid = median(ratios);
    const low = Math.round((Math.min(...ratios) - 1) * 1000) / 10;
    const high = Math.round((Math.max(...ratios) - 1) * 1000) / 10;
    out[key] = {
      /**
       * Whether this looks like a setting at all.
       *
       * A channel markup is a fixed percentage, so honest observations
       * of one cluster. When they range across tens of points something
       * else is moving the price — a length-of-stay discount, a
       * promotion, a rate changed after the booking was taken — and the
       * median is then the middle of some noise rather than the setting.
       *
       * Reported rather than hidden, because "your bookings do not agree
       * with each other" is worth knowing. It is the screen's cue not to
       * offer the number as something to accept.
       */
      confident: usable.length >= 2 && high - low <= SPREAD_LIMIT,
      // As a percentage on top, which is how the field is expressed.
      markup: Math.round((mid - 1) * 1000) / 10,
      bookings: usable.length,
      nights: usable.reduce((n, r) => n + r.nights, 0),
      // How many were thrown out because the rate has since moved.
      stale: rows.length - usable.length,
      // The spread, so a wide one can be distrusted at a glance. Two
      // bookings 3% apart is a setting; two 40% apart is not a number
      // anybody should paste into a field.
      low,
      high,
    };
  }
  return out;
}

module.exports = { observedMarkup, nightsOf, median, KEY_FOR, SPREAD_LIMIT };
