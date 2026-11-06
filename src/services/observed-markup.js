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

/* ---------------------------------------------------------------------- *
 * The commission, and the markup it demands
 *
 * The markup above is the unreliable half of this module: it needs the
 * base, the base is `daily_rates`, and `daily_rates` holds today's price
 * rather than the one the night sold at. A rate raised 13% after a
 * booking drags a 25% markup down to 10.7% and the result still looks
 * confident, because every booking in the sample was repriced together.
 *
 * The commission has none of that problem. It is two numbers on the same
 * booking row — what the guest was charged and what the channel kept —
 * so there is no base to rot and nothing to go stale. It is the one
 * figure here that can be measured rather than estimated.
 *
 * And it is the figure the markup has to clear:
 *
 *     sold   = base x (1 + markup)
 *     payout = sold x (1 - commission)
 *
 * so the payout only reaches the base when (1 + markup)(1 - commission)
 * is at least 1 — which means the markup must be at least
 *
 *     1 / (1 - commission) - 1
 *
 * At 17% that is 20.48%, not 17%. Setting the markup equal to the
 * commission is the intuitive mistake and it loses money on every
 * night: 17% on top of a R2,000 base sells at R2,340, the channel keeps
 * R398, and R1,942 comes back against a base of R2,000.
 * ---------------------------------------------------------------------- */

/**
 * The markup needed for the payout to clear the base, given a total
 * commission expressed as a percentage.
 *
 * Division, not subtraction. A commission is a share of the price sold
 * and a markup is a share of the base, so they are fractions of
 * different numbers and the one cannot be cancelled by the other.
 */
function requiredMarkup(commissionPercent) {
  const c = Number(commissionPercent);
  if (!Number.isFinite(c) || c <= 0) return 0;
  // A channel keeping everything cannot be covered by any markup.
  if (c >= 100) return null;
  return Math.round((1 / (1 - c / 100) - 1) * 1000) / 10;
}

/**
 * What each channel has actually been keeping, per channel.
 *
 * `commission` is Smoobu's `commission-included` — the channel's cut,
 * included in the price the guest was charged. So the share kept is
 * `commission / total_price`, and the payout is the difference.
 *
 * The median, for the same reason the markup uses it: one promotion or
 * one renegotiated rate would drag a mean anywhere. Bookings that
 * reported no commission are left out rather than counted as zero —
 * "did not say" is not "took nothing", and averaging the two together
 * reports a channel as cheaper than it is.
 */
function measuredCommission(bookings = []) {
  const samples = {};

  for (const b of bookings) {
    if (b.status && b.status !== 'confirmed') continue;
    if (isBlockedPlatform(b.platform)) continue;
    const key = KEY_FOR[normalizePlatform(b.platform)];
    // A direct booking has no channel to keep anything.
    if (!key) continue;

    const sold = Number(b.total_price);
    const kept = Number(b.commission);
    if (!Number.isFinite(sold) || sold <= 0) continue;
    if (!Number.isFinite(kept) || kept <= 0) continue;
    // A channel keeping more than the guest paid is a broken row, not a
    // commission, and one of them would move the median.
    if (kept >= sold) continue;

    (samples[key] = samples[key] || []).push(kept / sold);
  }

  const out = {};
  for (const [key, shares] of Object.entries(samples)) {
    const mid = median(shares);
    const commission = Math.round(mid * 1000) / 10;
    out[key] = {
      commission,
      bookings: shares.length,
      low: Math.round(Math.min(...shares) * 1000) / 10,
      high: Math.round(Math.max(...shares) * 1000) / 10,
      // What the markup has to be for the payout to clear the base.
      required_markup: requiredMarkup(commission),
    };
  }
  return out;
}

module.exports.requiredMarkup = requiredMarkup;
module.exports.measuredCommission = measuredCommission;
