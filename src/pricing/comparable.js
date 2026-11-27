/**
 * One comparable price: `comparable_gross_nightly`.
 *
 * What a guest pays on Airbnb per night, cleaning included and spread over
 * the stay, with no Airbnb guest service fee:
 *
 *   comparable_gross_nightly = base_nightly × (1 + channel_markup) + cleaning_fee / stay_nights
 *
 * Every price the app compares — ours against a competitor's, an asking
 * price against what sold, a rate against a quote — goes through this
 * module and nowhere else, so two numbers side by side are always on the
 * same basis. Every result carries `basis`, a short line saying what it is.
 *
 * ## What the sources actually are (checked 25–27 Nov 2026)
 *
 * **Airbnb quotes** (src/services/airbnb-calendar.js, `fetchQuote`): the
 * nightly is Airbnb's own line "2 nights x R 3,106.00", logged out. For a
 * listing like ours (host-only fee, which Airbnb requires of listings run
 * through a channel manager) the guest pays no service fee, and Airbnb
 * shows the price all-in: the line *includes* the cleaning fee, spread
 * over the quoted nights — 2 × R3,106 is the whole R6,212, there is no
 * separate cleaning or fee line. Hill Top Lodge, 7–9 Dec 2026, base
 * R2,370: 2 × ⌈2,370 × 1.205⌉ + R500 = R6,212 = 2 × R3,106. A competitor
 * on split fees has its guest service fee shown as a line of its own, so
 * the "x nights" figure leaves it out there too.
 *
 * Airbnb rounds each night's marked-up price **up** to the whole rand
 * before adding cleaning: Lodge 15–17 Jan 2027, R3,280 + R3,210 →
 * 3,953 + 3,869 + 500 = R8,322 (by plain arithmetic it would be
 * R8,320.45). `channelNight` does the same.
 *
 * A quote covers max(2, the listing's minimum stay) nights (peer-check
 * `planQuotes`), so its cleaning share is cleaning ÷ that — a listing with
 * a 30-night minimum carries cleaning ÷ 30. `fromQuote` takes the quote
 * apart with the listing's measured cleaning fee and puts it back
 * together over the stay length asked for (2 nights by default), so every
 * listing is compared over the same stay.
 *
 * **Smoobu gross** (`bookings.total_price`, Smoobu's reservation `price`):
 * the amount the guest pays for the stay — rates with the channel markup,
 * plus cleaning — before the channel's commission. Airbnb: R6,044 for the
 * Loft 3–5 Dec 2026 = 2 × ⌈2,300 × 1.205⌉ + 500, Airbnb's own total;
 * Smoobu's commission on it (17.8%) is Airbnb's 15.5% host-only fee plus
 * VAT, taken from the payout, not added for the guest. Booking.com: the
 * reservation amount the guest pays Booking.com (its 15–18% commission is
 * invoiced afterwards). Direct: what the guest paid us. Vrbo: Smoobu
 * often has no price (0) — see `fromBooking`, which says so instead of
 * guessing.
 *
 * **VAT.** The owning company is a VAT vendor. Every guest price here is
 * VAT-inclusive, as charged to the guest — the 15% output VAT is inside
 * the gross, not on top, and is not taken out by this module. Net revenue
 * (analytics-calc `calcDeductions`) takes off commission, bank charges and
 * VAT on those fees only.
 *
 * **Channel markups** are the property's `guest_markup_*` settings, the
 * percentage Smoobu adds to the base rate for that channel: Airbnb 20.5%,
 * Booking.com 25%, Vrbo 0% today. Direct bookings carry no markup.
 */

const DEFAULT_STAY_NIGHTS = 2;

const CHANNELS = {
  airbnb: { label: 'airbnb', column: 'guest_markup_airbnb' },
  booking: { label: 'booking.com', column: 'guest_markup_booking' },
  vrbo: { label: 'vrbo', column: 'guest_markup_vrbo' },
  direct: { label: 'direct', column: null },
};

/** The channel a Smoobu platform name belongs to. */
function channelOf(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('direct')) return 'direct'; // Smoobu's "Direct booking"
  if (p.includes('airbnb')) return 'airbnb';
  if (p.includes('booking')) return 'booking';
  if (p.includes('vrbo') || p.includes('homeaway')) return 'vrbo';
  return 'direct';
}

/** The property's markup for a channel, in percent (20.5 means +20.5%). */
function markupFor(property, channel = 'airbnb') {
  const c = CHANNELS[channel] || CHANNELS.direct;
  const v = c.column && property ? Number(property[c.column]) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

const known = (x) => x !== null && x !== undefined && Number.isFinite(Number(x));
const rand = (x) => (known(x) ? Math.round(Number(x)) : null);

/**
 * One night's price on the channel: the base with the markup, rounded up
 * to the rand as Airbnb does. Rounded to the cent first, so 2,300 × 1.205
 * (2,771.4999… in floating point) is 2,771.50 and goes up to 2,772.
 */
function channelNight(base, markupPercent = 0) {
  const exact = Math.round(Number(base) * (1 + Number(markupPercent || 0) / 100) * 100) / 100;
  return Math.ceil(exact);
}

function basisLine({ channel = 'airbnb', stayNights, cleaningKnown = true, source }) {
  const label = (CHANNELS[channel] || CHANNELS.direct).label;
  const cleaning = cleaningKnown ? `cleaning over ${stayNights} night${stayNights === 1 ? '' : 's'}` : 'cleaning unknown, not included';
  return [label, cleaning, 'excl. guest service fee', source].filter(Boolean).join(', ');
}

function result({ base, channelTotal, cleaning, nights, channel, source, cleaningKnown = true }) {
  const comparable = (channelTotal + (cleaningKnown ? cleaning : 0)) / nights;
  return {
    base_nightly: base,
    channel_nightly: rand(channelTotal / nights),
    cleaning_per_night: cleaningKnown ? rand(cleaning / nights) : null,
    comparable_gross_nightly: rand(comparable),
    stay_nights: nights,
    stay_total: rand(channelTotal + (cleaningKnown ? cleaning : 0)),
    basis: basisLine({ channel, stayNights: nights, cleaningKnown, source }),
  };
}

/**
 * Our own asking price from Smoobu base rates.
 *
 * `rates` is the base rate of each night of the stay; a single number is
 * used for every night. `stayNights` defaults to the number of rates, or
 * 2. `cleaning` is the listing's measured fee; null means unknown.
 */
function fromRates({ rates, stayNights, markupPercent = 0, cleaning = null, channel = 'airbnb' }) {
  const list = Array.isArray(rates) ? rates.map(Number) : [];
  const nights = Math.max(1, Math.round(stayNights || list.length || DEFAULT_STAY_NIGHTS));
  const nightly = Array.isArray(rates)
    ? Array.from({ length: nights }, (_, i) => list[Math.min(i, list.length - 1)])
    : Array.from({ length: nights }, () => Number(rates));
  if (!nightly.length || nightly.some((r) => !Number.isFinite(r) || r <= 0)) return null;
  const channelTotal = nightly.reduce((sum, r) => sum + channelNight(r, markupPercent), 0);
  const base = rand(nightly.reduce((a, b) => a + b, 0) / nights);
  return result({ base, channelTotal, cleaning: Number(cleaning) || 0, nights, channel, cleaningKnown: known(cleaning), source: 'from smoobu base rate' });
}

/**
 * A price Airbnb quoted (ours or a competitor's): `nightly` over `nights`
 * nights, cleaning spread in. Taken apart with the listing's cleaning fee
 * and put back together over `stayNights` (2 by default).
 *
 * Without a measured cleaning fee the quote cannot be taken apart: it is
 * returned over the nights it was quoted for, and the basis says so.
 */
function fromQuote({ nightly, nights = DEFAULT_STAY_NIGHTS, cleaning = null, stayNights = DEFAULT_STAY_NIGHTS }) {
  if (!known(nightly) || Number(nightly) <= 0) return null;
  const quoted = Math.max(1, Math.round(Number(nights) || DEFAULT_STAY_NIGHTS));
  if (!known(cleaning)) {
    return result({ base: null, channelTotal: Number(nightly) * quoted, cleaning: 0, nights: quoted, channel: 'airbnb', cleaningKnown: false, source: `airbnb quote over ${quoted} nights` });
  }
  const want = Math.max(1, Math.round(Number(stayNights) || DEFAULT_STAY_NIGHTS));
  const perNight = Math.max(0, (Number(nightly) * quoted - Number(cleaning)) / quoted);
  return result({ base: null, channelTotal: perNight * want, cleaning: Number(cleaning), nights: want, channel: 'airbnb', source: 'from airbnb quote' });
}

/**
 * One of our own bookings, from Smoobu's gross: gross ÷ nights, which is
 * already cleaning-inclusive. `gross_ex_cleaning_nightly` takes our
 * cleaning fee off, for comparing with listings that charge none.
 *
 * A booking with no price (gross 0, common for Vrbo) is `price_unknown`,
 * with every figure null — never filled in from a base price.
 */
function fromBooking({ gross, nights, cleaning = null, platform }) {
  const n = Math.max(1, Math.round(Number(nights) || 1));
  const channel = channelOf(platform);
  if (!known(gross) || Number(gross) <= 0) {
    return { comparable_gross_nightly: null, gross_ex_cleaning_nightly: null, stay_nights: n, price_unknown: true, basis: `${(CHANNELS[channel]).label} booking, price unknown in smoobu` };
  }
  return {
    comparable_gross_nightly: rand(Number(gross) / n),
    gross_ex_cleaning_nightly: known(cleaning) ? rand(Math.max(0, Number(gross) - Number(cleaning)) / n) : null,
    stay_nights: n,
    price_unknown: false,
    basis: `${(CHANNELS[channel]).label} booking, smoobu gross over ${n} night${n === 1 ? '' : 's'}, cleaning included, excl. guest service fee`,
  };
}

/** A whole stay at a comparable nightly: what the guest pays for `nights` nights. */
const stayTotal = (c) => (!c ? null : c.stay_total != null ? c.stay_total : c.comparable_gross_nightly * c.stay_nights);

/**
 * The base rate that gives a wanted comparable nightly over a stay —
 * the inverse of `fromRates` for one rate across every night (dynamic
 * pricing). By division, never by subtracting a percentage.
 */
function baseForComparable({ comparable, stayNights = DEFAULT_STAY_NIGHTS, markupPercent = 0, cleaning = 0 }) {
  const n = Math.max(1, Math.round(stayNights));
  const perNight = (Number(comparable) * n - (Number(cleaning) || 0)) / n;
  return Math.max(0, perNight / (1 + Number(markupPercent || 0) / 100));
}

/** A raw Smoobu base rate, labelled as such where one is shown on its own. */
const BASE_RATE_BASIS = 'smoobu base rate: before channel markup, without cleaning';

module.exports = {
  DEFAULT_STAY_NIGHTS, CHANNELS, BASE_RATE_BASIS,
  channelOf, markupFor, channelNight, fromRates, fromQuote, fromBooking, stayTotal, baseForComparable,
};

/**
 * A quote as the API returns it: the labelled fields, plus `nightly`
 * (deprecated, kept one release for old readers) equal to the comparable.
 */
function quoteFields({ nightly, nights, cleaning, stayNights = DEFAULT_STAY_NIGHTS }) {
  const c = fromQuote({ nightly, nights, cleaning, stayNights });
  return c ? { ...c, nightly: c.comparable_gross_nightly, nightly_deprecated: 'use comparable_gross_nightly' } : null;
}
module.exports.quoteFields = quoteFields;
