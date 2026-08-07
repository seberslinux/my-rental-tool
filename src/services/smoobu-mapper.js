/**
 * Smoobu payload → bookings row. The single place that decision is made.
 *
 * Smoobu is the source of truth and its payloads are correct; every data
 * problem this app has had at the booking level came from ingestion, not
 * from Smoobu. The cause was structural: three write paths — the routine
 * sync, the historical resync, and the webhook — each carried its own
 * hand-written column list, and they drifted.
 *
 * That drift was not merely additive. The routine sync deletes and
 * re-inserts its whole window, so a field it omitted was not just missing
 * on new rows: it was erased from rows the historical resync had already
 * filled. `commission`, `children`, `language` and `guest_country` were all
 * lost this way.
 *
 * So the mapping lives here, once, and the write paths call it. Adding a
 * field means editing one function, and every path picks it up.
 *
 * ## Dialects
 *
 * Smoobu sends two shapes depending on the endpoint and event: kebab-case
 * (`guest-name`, `created-at`) and camelCase (`guestName`, `createdAt`).
 * Both are accepted for every field, so callers never have to care which
 * one they received.
 *
 * ## Deliberately not mapped
 *
 * `special_requirements` — read by the cleaner portal and by the WhatsApp
 * job reminders, but left alone here. The closest Smoobu field, `notice`,
 * carries OTA boilerplate ("Booking Number: …", "Payment charge is ZAR …",
 * "booker_is_genius"); piping that into a cleaner's message would make it
 * worse, not better. It stays a field a human fills in.
 */

const { detectCurrency } = require('./currency-detect');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Dialling code → country, longest prefix wins. Used to infer guest origin
// when Smoobu gives a phone number but no country.
const PHONE_COUNTRY_MAP = {
  '27': 'South Africa', '1': 'United States', '44': 'United Kingdom',
  '49': 'Germany', '33': 'France', '31': 'Netherlands', '32': 'Belgium',
  '34': 'Spain', '39': 'Italy', '41': 'Switzerland', '43': 'Austria',
  '45': 'Denmark', '46': 'Sweden', '47': 'Norway', '48': 'Poland',
  '351': 'Portugal', '353': 'Ireland', '358': 'Finland', '420': 'Czech Republic',
  '36': 'Hungary', '30': 'Greece', '90': 'Turkey', '7': 'Russia',
  '61': 'Australia', '64': 'New Zealand', '81': 'Japan', '82': 'South Korea',
  '86': 'China', '91': 'India', '55': 'Brazil', '52': 'Mexico',
  '54': 'Argentina', '56': 'Chile', '57': 'Colombia', '971': 'UAE',
  '966': 'Saudi Arabia', '972': 'Israel', '20': 'Egypt', '234': 'Nigeria',
  '254': 'Kenya', '255': 'Tanzania', '256': 'Uganda', '263': 'Zimbabwe',
  '267': 'Botswana', '258': 'Mozambique', '260': 'Zambia', '264': 'Namibia',
  '230': 'Mauritius', '262': 'Reunion', '261': 'Madagascar',
  '65': 'Singapore', '60': 'Malaysia', '66': 'Thailand', '62': 'Indonesia',
  '63': 'Philippines', '84': 'Vietnam', '852': 'Hong Kong', '886': 'Taiwan',
  '354': 'Iceland', '372': 'Estonia', '371': 'Latvia', '370': 'Lithuania',
  '385': 'Croatia', '386': 'Slovenia', '421': 'Slovakia', '40': 'Romania',
  '359': 'Bulgaria', '381': 'Serbia', '387': 'Bosnia', '355': 'Albania',
};

function countryFromPhone(phone) {
  if (!phone) return '';
  const cleaned = String(phone).replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) return '';
  const digits = cleaned.substring(1);
  // Longest prefix first: '27' (South Africa) must not shadow '271'.
  for (const len of [3, 2, 1]) {
    const prefix = digits.substring(0, len);
    if (PHONE_COUNTRY_MAP[prefix]) return PHONE_COUNTRY_MAP[prefix];
  }
  return '';
}

/** First non-empty value among the given keys — handles both dialects. */
function pick(payload, ...keys) {
  for (const k of keys) {
    const v = payload[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Map a Smoobu booking payload to the columns of a `bookings` row.
 *
 * `propertyCurrencyBySmoobuId` supplies the per-property fallback currency
 * when the payload's price details don't name one.
 *
 * Returns plain values only — no DB access — so it is exercised directly by
 * unit tests without a database.
 */
function mapSmoobuBooking(payload, { propertyCurrencyBySmoobuId = {} } = {}) {
  const b = payload || {};

  const apartmentId = b.apartment?.id ?? b.apartmentId;
  const checkIn = pick(b, 'arrival', 'arrivalDate') || '';
  const checkOut = pick(b, 'departure', 'departureDate') || '';
  const createdAt = pick(b, 'created-at', 'createdAt') || '';
  const modifiedAt = pick(b, 'modified-at', 'modifiedAt') || '';

  // A stay must be at least one night: check_in === check_out would
  // otherwise divide by zero when deriving the nightly rate.
  const nights = checkIn && checkOut
    ? Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / MS_PER_DAY))
    : 1;

  const price = b.price || 0;

  // A booking made after arrival is nonsense but does occur; clamp rather
  // than let a negative drag the average lead time down.
  const leadTimeDays = createdAt && checkIn
    ? Math.max(0, Math.round((new Date(checkIn) - new Date(createdAt)) / MS_PER_DAY))
    : 0;

  const phone = pick(b, 'phone', 'guest-phone', 'guestPhone') || '';

  return {
    smoobu_id: b.id,
    apartment_smoobu_id: apartmentId,
    guest_name: pick(b, 'guest-name', 'guestName') || '',
    check_in: checkIn,
    check_out: checkOut,
    platform: b.channel?.name || (typeof b.channel === 'string' ? b.channel : '') || '',
    total_price: price,
    status: b.type === 'cancellation' ? 'cancelled' : 'confirmed',
    // Adults only — children are counted separately, and displays that
    // want the whole party add the two.
    num_guests: b.adults || 1,
    children: b.children || 0,
    created_at: createdAt,
    modified_at: modifiedAt,
    lead_time_days: leadTimeDays,
    length_of_stay: nights,
    price_per_night: nights > 0 ? Math.round((price / nights) * 100) / 100 : 0,
    currency: detectCurrency(b) || propertyCurrencyBySmoobuId[apartmentId] || 'ZAR',
    // The OTA's cut, already inside `price`: the guest paid the full amount
    // to the channel, which keeps this and remits the rest.
    commission: pick(b, 'commission-included', 'commissionIncluded') || 0,
    language: b.language || '',
    guest_country: countryFromPhone(phone),
    // Everything Smoobu sent, kept verbatim. Costs a column and buys back
    // every field we did not think to map — guest email and phone, arrival
    // and departure times, the OTA reference, payment and deposit state,
    // city tax. Smoobu's API only serves a limited window, so a field not
    // captured now cannot be fetched later; from here it can be backfilled
    // without touching the network.
    raw_payload: b,
  };
}

module.exports = { mapSmoobuBooking, countryFromPhone, PHONE_COUNTRY_MAP };
