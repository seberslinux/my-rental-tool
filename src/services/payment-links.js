/**
 * Direct bookings paid through a link.
 *
 *   quote → link → guest pays on Paystack → Smoobu booking
 *
 * The owner picks a property, dates and guests; the quote is what the stay
 * costs on Airbnb (the Smoobu rates with the Airbnb markup, plus cleaning)
 * and a direct price 10% below it, which the owner may overwrite. The link
 * is sent to the guest, who pays the whole amount on Paystack. Once
 * Paystack confirms the payment the booking is created in Smoobu as a paid
 * direct booking, and from there reaches every channel's calendar.
 *
 * The dates are not held while the link is open: they are checked when the
 * link is made, again when the guest starts to pay, and once more before
 * the booking is created. A payment whose dates were taken in between is
 * kept as "paid, not booked" and the owner is told at once.
 *
 * Each property is paid into its own Paystack account; a property with
 * none can have links made, but they cannot be paid.
 *
 * Statuses: open → pending (checkout started) → booking → booked, or
 * paid_unbooked; open/pending → cancelled; past expires_at an open or
 * pending link reads as expired.
 */

const crypto = require('crypto');
const { getAll, getOne, run } = require('../db/database');
const smoobu = require('./smoobu');
const paystack = require('./paystack');
const { keyFor } = require('./payment-accounts');
const { getApiKeyForProperty } = require('./api-key-resolver');

const comparable = require('../pricing/comparable');

const DEFAULT_DISCOUNT = 10;
const DEFAULT_HOURS = 48;
const DAY = 86400000;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const roundTo10 = (n) => Math.round(n / 10) * 10;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function propertyFor(propertyId) {
  const p = await getOne(
    `SELECT id, name, smoobu_id, COALESCE(base_currency, 'ZAR') AS currency, COALESCE(guest_markup_airbnb, 0) AS airbnb_markup
       FROM properties WHERE id = $1`, [propertyId]
  );
  if (!p) throw fail('Property not found', 404);
  if (!p.smoobu_id) throw fail('This property is not linked to Smoobu');
  return p;
}

/** The cleaning fee our own Airbnb listing charges, as last measured; 0 if never. */
async function ownCleaning(propertyId) {
  const row = await getOne(
    `SELECT f.fee FROM peer_listings l
       JOIN peer_cleaning_fees f ON f.listing_id = l.id AND f.fee IS NOT NULL
      WHERE l.property_id = $1 AND l.is_own ORDER BY f.measured_at DESC LIMIT 1`, [propertyId]
  );
  return row ? Number(row.fee) : 0;
}

/** Each night of the stay as Smoobu has it: price, open or not, minimum stay. */
async function nightsInSmoobu(p, checkIn, checkOut) {
  const apiKey = await getApiKeyForProperty(p.id);
  const res = await smoobu.getRates(p.smoobu_id, checkIn, addDays(checkOut, -1), apiKey);
  const days = (res && res.data && res.data[p.smoobu_id]) || {};
  const out = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
    const v = days[d];
    out.push({ date: d, price: v ? Number(v.price) || 0 : 0, available: Boolean(v && Number(v.available)), minStay: v ? Number(v.min_length_of_stay) || null : null });
  }
  return out;
}

function checkDates(checkIn, checkOut) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn || '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || '')) throw fail('Dates must be YYYY-MM-DD');
  const n = nightsBetween(checkIn, checkOut);
  if (n < 1) throw fail('Check-out must be after check-in');
  if (n > 60) throw fail('At most 60 nights');
  if (checkIn < new Date().toISOString().slice(0, 10)) throw fail('Check-in is in the past');
  return n;
}

/**
 * What the stay costs on Airbnb and the direct price below it, with what
 * stands in the way: nights already taken, or a stay shorter than Smoobu's
 * minimum (a warning only — a direct deal may allow it).
 */
async function quote({ propertyId, checkIn, checkOut, discountPercent = DEFAULT_DISCOUNT }) {
  const nights = checkDates(checkIn, checkOut);
  const p = await propertyFor(propertyId);
  const days = await nightsInSmoobu(p, checkIn, checkOut);
  const taken = days.filter((d) => !d.available).map((d) => d.date);
  const unpriced = days.filter((d) => d.available && !d.price).map((d) => d.date);
  const rates = days.reduce((a, d) => a + d.price, 0);
  const cleaning = await ownCleaning(p.id);
  // What the stay costs an Airbnb guest, from the one comparable-price
  // module: each night's rate with the markup (rounded up, as Airbnb
  // does), plus our cleaning fee.
  // Nights Smoobu has no price for are left out (the quote is then not
  // available anyway).
  const priced = days.filter((d) => d.price > 0).map((d) => d.price);
  const price = priced.length ? comparable.fromRates({ rates: priced, markupPercent: Number(p.airbnb_markup), cleaning }) : null;
  const airbnb = price ? roundTo10(comparable.stayTotal(price)) : 0;
  const discount = Number.isFinite(Number(discountPercent)) ? Number(discountPercent) : DEFAULT_DISCOUNT;
  const minStay = days[0] ? days[0].minStay : null;
  return {
    payments_ready: Boolean(await keyFor(p.id)),
    property: { id: p.id, name: p.name }, currency: p.currency,
    check_in: checkIn, check_out: checkOut, nights,
    rates: Math.round(rates), rates_basis: comparable.BASE_RATE_BASIS, cleaning, airbnb_markup: Number(p.airbnb_markup),
    airbnb_price: price,
    airbnb_total: airbnb,
    discount_percent: discount,
    direct_total: roundTo10(airbnb * (1 - discount / 100)),
    available: taken.length === 0 && unpriced.length === 0,
    taken, unpriced,
    min_stay: minStay,
    below_min_stay: Boolean(minStay && nights < minStay),
  };
}

const PUBLIC_FIELDS = `id, token, property_id, to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out,
  adults, children, first_name, last_name, email, phone, amount_cents, airbnb_cents, currency, note, status,
  expires_at, paystack_reference, paid_at, smoobu_reservation_id, error, created_at, source`;

/** An open or pending link past its expiry reads as expired. */
function shape(row) {
  if (!row) return null;
  const expired = ['open', 'pending'].includes(row.status) && new Date(row.expires_at) < new Date();
  return { ...row, status: expired ? 'expired' : row.status, amount: row.amount_cents / 100, airbnb: row.airbnb_cents == null ? null : row.airbnb_cents / 100 };
}

async function createLink({ propertyId, checkIn, checkOut, adults = 2, children = 0, firstName, lastName = '', email, phone = null, amount, note = null, hours = DEFAULT_HOURS, createdBy = null, source = 'owner' }) {
  const q = await quote({ propertyId, checkIn, checkOut });
  if (!q.available) throw fail(q.taken.length ? `Not available: ${q.taken.join(', ')}` : `No price in Smoobu for ${q.unpriced.join(', ')}`, 409);
  if (!firstName || !String(firstName).trim()) throw fail('The guest\'s first name is needed');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw fail('A valid email is needed: Paystack sends the receipt there');
  const total = Number(amount);
  if (!Number.isFinite(total) || total < 100) throw fail('The amount must be at least 100');
  const a = Number(adults), c = Number(children);
  if (!Number.isInteger(a) || a < 1 || a > 20 || !Number.isInteger(c) || c < 0 || c > 20) throw fail('Check the number of guests');
  const h = Math.min(Math.max(Number(hours) || DEFAULT_HOURS, 1), 24 * 14);
  const token = crypto.randomBytes(18).toString('base64url');
  const row = await getOne(
    `INSERT INTO payment_links (token, property_id, check_in, check_out, adults, children, first_name, last_name, email, phone,
                                amount_cents, airbnb_cents, currency, note, expires_at, created_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW() + make_interval(hours => $15), $16, $17)
     RETURNING ${PUBLIC_FIELDS}`,
    [token, propertyId, checkIn, checkOut, a, c, String(firstName).trim(), String(lastName || '').trim(), String(email).trim(),
      phone ? String(phone).trim() : null, Math.round(total * 100), Math.round(q.airbnb_total * 100), q.currency,
      note ? String(note).slice(0, 500) : null, h, createdBy, source === 'website' ? 'website' : 'owner']
  );
  return { ...shape(row), quote: q };
}

async function listLinks(propertyIds = null) {
  const rows = await getAll(
    `SELECT ${PUBLIC_FIELDS}, (SELECT name FROM properties p WHERE p.id = l.property_id) AS property_name
       FROM payment_links l WHERE ($1::int[] IS NULL OR property_id = ANY($1::int[]))
      ORDER BY created_at DESC LIMIT 200`, [propertyIds]
  );
  return rows.map(shape);
}

const byId = async (id) => shape(await getOne(`SELECT ${PUBLIC_FIELDS} FROM payment_links WHERE id = $1`, [id]));
const byToken = async (token) => shape(await getOne(`SELECT ${PUBLIC_FIELDS} FROM payment_links WHERE token = $1`, [token]));

async function cancelLink(id) {
  const row = await getOne(
    `UPDATE payment_links SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('open', 'pending') RETURNING id`, [id]
  );
  if (!row) throw fail('Only a link not yet paid can be cancelled', 409);
  return byId(id);
}

/** What the guest's page shows: the stay and its price, nothing of anyone else's. */
async function publicView(token) {
  const l = await byToken(token);
  if (!l) return null;
  const p = await getOne('SELECT name FROM properties WHERE id = $1', [l.property_id]);
  return {
    status: l.status, property: p ? p.name : '', first_name: l.first_name,
    check_in: l.check_in, check_out: l.check_out, nights: nightsBetween(l.check_in, l.check_out),
    adults: l.adults, children: l.children, amount: l.amount, currency: l.currency, expires_at: l.expires_at,
  };
}

/**
 * Send the guest to Paystack. The dates are checked again first. One
 * payment per link: a guest who comes back is sent to the same checkout.
 */
async function startPayment(token, baseUrl) {
  const l = await byToken(token);
  if (!l) throw fail('Link not found', 404);
  if (l.status === 'pending' && l.paystack_reference) {
    const row = await getOne('SELECT authorization_url FROM payment_links WHERE id = $1', [l.id]);
    if (row.authorization_url) return row.authorization_url;
  }
  if (l.status !== 'open') throw fail('This link can no longer be paid', 409);
  const p = await propertyFor(l.property_id);
  const key = await keyFor(p.id);
  if (!key) throw fail('Payments are not set up for this property yet', 503);
  const days = await nightsInSmoobu(p, l.check_in, l.check_out);
  if (days.some((d) => !d.available)) throw fail('These dates have just been booked by someone else', 409);
  const reference = `dl${l.id}-${crypto.randomBytes(6).toString('hex')}`;
  const checkout = await paystack.initialize(key, {
    email: l.email, amountCents: l.amount_cents, currency: l.currency, reference,
    callbackUrl: `${baseUrl}/pay/${encodeURIComponent(token)}/return`,
    metadata: { payment_link: l.id, property: p.name, check_in: l.check_in, check_out: l.check_out },
  });
  const row = await getOne(
    `UPDATE payment_links SET status = 'pending', paystack_reference = $2, authorization_url = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'open' RETURNING id`, [l.id, reference, checkout.authorizationUrl]
  );
  if (!row) throw fail('This link can no longer be paid', 409);
  return checkout.authorizationUrl;
}

/**
 * Turn a confirmed payment into a Smoobu booking — once. Called from the
 * guest's return from Paystack and from Paystack's webhook, in either
 * order or both at once: Paystack is asked first, then one caller claims
 * the link and the other finds it claimed.
 */
async function settle(reference, { notifyImpl } = {}) {
  const notify = notifyImpl || require('./notify').notify;
  const l = shape(await getOne(`SELECT ${PUBLIC_FIELDS} FROM payment_links WHERE paystack_reference = $1`, [reference]));
  if (!l) return null;
  if (!['open', 'pending', 'expired'].includes(l.status)) return l;
  const paid = await paystack.verify(await keyFor(l.property_id), reference);
  if (paid.status !== 'success') return l;
  if (paid.amountCents !== l.amount_cents || paid.currency !== l.currency) {
    await run(`UPDATE payment_links SET status = 'paid_unbooked', paid_at = NOW(), error = $2, updated_at = NOW() WHERE id = $1 AND status IN ('open', 'pending')`,
      [l.id, `Paid ${paid.amountCents / 100} ${paid.currency}, expected ${l.amount} ${l.currency}`]);
    await tell(notify, l, 'direct_booking_failed', 'Direct payment does not match', `The amount paid differs from the link. Check Paystack before confirming.`);
    return byId(l.id);
  }
  const claimed = await getOne(
    `UPDATE payment_links SET status = 'booking', paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND status IN ('open', 'pending') RETURNING id`, [l.id]
  );
  if (!claimed) return byId(l.id);
  return book(l, notify);
}

async function book(l, notify) {
  const p = await propertyFor(l.property_id);
  try {
    const days = await nightsInSmoobu(p, l.check_in, l.check_out);
    const taken = days.filter((d) => !d.available).map((d) => d.date);
    if (taken.length) throw new Error(`Paid, but these nights were booked meanwhile: ${taken.join(', ')}`);
    const apiKey = await getApiKeyForProperty(p.id);
    const channelId = await smoobu.directChannelId(apiKey);
    const res = await smoobu.createReservation({
      apartmentId: p.smoobu_id, channelId, arrivalDate: l.check_in, departureDate: l.check_out,
      firstName: l.first_name, lastName: l.last_name, email: l.email, phone: l.phone || undefined,
      adults: l.adults, children: l.children, price: l.amount,
      notice: `${l.source === 'website' ? 'Booked on the website. ' : ''}Paid in full via Paystack, reference ${l.paystack_reference}.${l.note ? ` ${l.note}` : ''}`,
    }, apiKey);
    const id = res && (res.id || (res.reservation && res.reservation.id));
    await run(`UPDATE payment_links SET status = 'booked', smoobu_reservation_id = $2, error = NULL, updated_at = NOW() WHERE id = $1`, [l.id, id || null]);
    await tell(notify, l, 'direct_booking_paid', `Direct booking paid: ${p.name}`,
      `${l.first_name} paid ${money(l)} for ${l.check_in} to ${l.check_out}. Booked in Smoobu.`);
  } catch (err) {
    const why = (err.response && err.response.data && (err.response.data.detail || err.response.data.title)) || err.message;
    await run(`UPDATE payment_links SET status = 'paid_unbooked', error = $2, updated_at = NOW() WHERE id = $1`, [l.id, String(why).slice(0, 500)]);
    await tell(notify, l, 'direct_booking_failed', `Paid but not booked: ${p.name}`,
      `${l.first_name} paid ${money(l)} for ${l.check_in} to ${l.check_out}, but the booking could not be created: ${why}`);
  }
  return byId(l.id);
}

/** Try the Smoobu booking again for a payment that is in but did not book. */
async function retryBooking(id, { notifyImpl } = {}) {
  const notify = notifyImpl || require('./notify').notify;
  const claimed = await getOne(`UPDATE payment_links SET status = 'booking', updated_at = NOW() WHERE id = $1 AND status = 'paid_unbooked' RETURNING id`, [id]);
  if (!claimed) throw fail('Only a paid link that did not book can be retried', 409);
  return book(await byId(id), notify);
}

const money = (l) => `${l.currency === 'ZAR' ? 'R' : `${l.currency} `}${Math.round(l.amount).toLocaleString('en-ZA')}`;

async function tell(notify, l, event, title, body) {
  try {
    await notify({ event, title, body, propertyId: l.property_id, link: '/direct' });
  } catch (err) {
    console.error('payment-links: notify failed:', err.message);
  }
}

/** The link a Paystack reference belongs to, for the webhook to find the account. */
const byReference = async (reference) => getOne('SELECT id, property_id FROM payment_links WHERE paystack_reference = $1', [reference]);

module.exports = { byReference, quote, createLink, listLinks, byId, cancelLink, publicView, startPayment, settle, retryBooking, DEFAULT_DISCOUNT };
