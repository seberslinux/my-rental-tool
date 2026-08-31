/**
 * One rate, three numbers.
 *
 * A nightly rate is not a single fact. The number you set is the number
 * pushed to Smoobu and on to the channels; it is rarely the number the
 * guest sees, and it is never the number that reaches your account.
 *
 *   Your rate    what you set, and what gets sent
 *   Guest pays   your rate plus whatever the channel adds on top
 *   You keep     your rate less commission, bank charges and VAT
 *
 * Pricing decisions are made against the middle one — a guest comparing
 * your flat with the one next door is comparing what they are charged,
 * not what you are paid — while the number you type is the first, and
 * the number that matters to you is the third. Showing only one of them
 * is how a rate that looks competitive turns out not to be.
 *
 * ## Two directions, two fields
 *
 * The commission columns are money coming *out* of what you receive.
 * The markup columns are money going *on top* for the guest. They are
 * not the same number in different clothes, and Airbnb's split fee is
 * both at once — a few percent off the host and a larger service fee
 * added to the guest. A single percentage cannot say that, which is why
 * `guest_markup_*` exists beside `commission_*` rather than instead of
 * it.
 *
 * ## What you keep is not computed here
 *
 * It is handed to `calcDeductions`, the one function that knows how
 * commission, bank charges and VAT stack up — VAT applies to the fees
 * rather than to the rate, which is the sort of detail that goes wrong
 * the second time somebody writes it. A nightly rate is dressed up as
 * the booking row that function expects and passed straight through, so
 * this screen and the revenue reports cannot disagree about a rand.
 */

const { calcDeductions } = require('./analytics-calc');

/**
 * The channels, and the columns that describe each one.
 *
 * `platform` is the string calcDeductions matches on, so the fake row
 * below lands in the right branch of it.
 */
const CHANNELS = [
  { key: 'airbnb', label: 'Airbnb', platform: 'Airbnb' },
  { key: 'booking', label: 'Booking.com', platform: 'Booking.com' },
  { key: 'vrbo', label: 'VRBO', platform: 'Vrbo' },
];

const pct = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * What the guest is charged for a night priced at `rate`.
 *
 * Rounded, because a channel shows a guest whole rand and a price with
 * cents on it is a price nobody recognises.
 */
function guestPrice(rate, markupPercent) {
  return Math.round(rate * (1 + pct(markupPercent) / 100));
}

/**
 * The rate that produces a given guest price — the inverse, by division.
 *
 * It has to be `guest / 1.205`, never `guest * 0.795`. A markup is a
 * fraction of the base and a discount is a fraction of the guest price,
 * so the two are not the same number and reversing one with the other is
 * silently wrong: 2,109.67 back through 20.5% gives 1,750.76 by division
 * and 1,677.19 by multiplication, seventy-four rand adrift on one night.
 *
 * It exists so nobody has to work that out again. Every percentage in
 * this app is a markup on the base; this is the only place the sum runs
 * backwards.
 */
function rateForGuestPrice(guest, markupPercent) {
  const g = Number(guest);
  if (!Number.isFinite(g) || g <= 0) return 0;
  return Math.round(g / (1 + pct(markupPercent) / 100));
}

/**
 * What reaches you from a night priced at `rate` on this channel.
 *
 * Through calcDeductions rather than around it. The fake booking carries
 * the same column names the real queries alias, so the fees applied here
 * are the fees applied everywhere else.
 */
function netForChannel(rate, property = {}, channelKey) {
  const row = {
    converted_total_price: rate,
    platform: (CHANNELS.find((c) => c.key === channelKey) || {}).platform || '',
    prop_commission_airbnb: property.commission_airbnb,
    prop_commission_booking: property.commission_booking,
    prop_commission_vrbo: property.commission_vrbo,
    bank_charge_airbnb: property.bank_charge_airbnb,
    bank_charge_booking: property.bank_charge_booking,
    bank_charge_vrbo: property.bank_charge_vrbo,
    vat_airbnb: property.vat_airbnb,
    vat_booking: property.vat_booking,
    vat_vrbo: property.vat_vrbo,
    property_vat_rate: property.vat_rate,
    // No Smoobu figure to fall back on: this is a rate nobody has booked
    // yet, so there is no per-booking commission for it to use.
    converted_commission: 0,
  };
  return Math.round(rate - calcDeductions(row));
}

/**
 * Every way of looking at one rate.
 *
 * Returned per channel rather than for a chosen one, so a screen can let
 * somebody switch between them without asking the server again.
 */
function viewsFor(rate, property = {}) {
  const channels = {};
  for (const c of CHANNELS) {
    channels[c.key] = {
      label: c.label,
      markup: pct(property[`guest_markup_${c.key}`]),
      guest: guestPrice(rate, property[`guest_markup_${c.key}`]),
      net: netForChannel(rate, property, c.key),
    };
  }
  return { base: Math.round(rate), channels };
}

/** The channel list, for a form that has to name them. */
function channelList(property = {}) {
  return CHANNELS.map((c) => ({
    key: c.key,
    label: c.label,
    markup: pct(property[`guest_markup_${c.key}`]),
    commission: pct(property[`commission_${c.key}`]),
  }));
}

module.exports = {
  CHANNELS, guestPrice, rateForGuestPrice, netForChannel, viewsFor, channelList,
};
