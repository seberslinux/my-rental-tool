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
 * ## The numerator is the price sold, not the money received
 *
 * This measured `total_price / base` and reported Booking.com at +10.7%
 * against a setting of 25%. The gap is a commission: `total_price` is
 * Smoobu's `price`, and for a channel that collects from the guest that
 * is the payout, with `commission-included` recording what the channel
 * kept. A markup is added to the base for the guest; a commission is
 * taken out of what reaches you. Dividing the second by the base
 * measures neither.
 *
 * So the price sold is reconstructed — payout plus commission — and that
 * is what the ratio uses. Where no commission was reported the two are
 * the same number and nothing changes, which is why every existing
 * expectation still holds.
 *
 * ## Two numbers, because they are two facts
 *
 *   markup   sold / base - 1      what the channel adds for the guest
 *   keeps    commission / sold    what the channel takes before paying
 *
 * The second is reported beside the first because it is the one that can
 * be checked against the `commission_*` setting, and because a markup
 * that suddenly looks wrong is usually a commission in disguise.
 *
 * Both are still Smoobu's account of the transaction. Neither is a bank
 * statement: a payout net of payment-processing fees, currency
 * conversion or withheld VAT is smaller again, and nothing here can see
 * that.
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

/**
 * What the guest was charged, as best it can be reconstructed.
 *
 * `total_price` plus whatever commission the channel reported keeping
 * out of it. A booking with no commission recorded returns `total_price`
 * unchanged — which is right for a channel that adds its fee on the
 * guest's side rather than deducting it, and is the only honest answer
 * when the field is simply absent.
 */
function soldPrice(booking) {
  const paid = Number(booking.total_price);
  if (!Number.isFinite(paid) || paid <= 0) return null;
  const kept = Number(booking.commission);
  return paid + (Number.isFinite(kept) && kept > 0 ? kept : 0);
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

    const sold = soldPrice(b);
    if (sold === null) continue;

    const kept = Number(b.commission);
    (samples[key] = samples[key] || []).push({
      ratio: sold / base,
      sold,
      // Null rather than zero: "took nothing" and "did not say" are
      // different facts, and a median over zeros would report the first
      // while meaning the second.
      kept: Number.isFinite(kept) && kept > 0 ? kept : null,
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
        keeps: null,
        keeps_bookings: 0,
        reconstructed: false,
      };
      continue;
    }

    const ratios = usable.map((r) => r.ratio);
    const mid = median(ratios);

    /**
     * What the channel took before paying, as a percentage of the price
     * sold — the other half of the same transaction.
     *
     * Only from bookings that reported a commission. A booking that did
     * not is evidence of nothing here, and averaging it in as zero would
     * report a channel taking less than it does, which is the mistake
     * the markup was already making in the other direction.
     */
    const paying = usable.filter((r) => r.kept !== null);
    const keeps = paying.length ? median(paying.map((r) => r.kept / r.sold)) : null;
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
      // What the channel keeps out of the price sold, to be read against
      // the `commission_*` setting: measured rather than configured.
      keeps: keeps === null ? null : Math.round(keeps * 1000) / 10,
      keeps_bookings: paying.length,
      // Whether the markup above was measured against a reconstructed
      // price sold rather than against `total_price` as stored. The
      // screen says so, because it is the difference between a reading
      // and a reading plus an assumption.
      reconstructed: paying.length > 0,
    };
  }
  return out;
}

module.exports = { observedMarkup, soldPrice, nightsOf, median, KEY_FOR, SPREAD_LIMIT };
