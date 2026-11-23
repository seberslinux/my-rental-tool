/**
 * Booking on the website: a guest picks dates, sees the price and pays,
 * with nobody in between.
 *
 * It is a payment link the guest makes for themselves: the same quote,
 * the same Paystack checkout, the same Smoobu booking once paid. What a
 * guest can choose is narrower than what the owner can — the price is
 * always the quote's direct price (never sent by the browser), the stay
 * must meet Smoobu's minimum and the property's guest limit, it starts
 * tomorrow at the earliest, and the link lasts an hour.
 *
 * A property is on the website when an admin has switched it on and it
 * has a Paystack account to be paid into.
 */

const { getOne, run } = require('../db/database');
const smoobu = require('./smoobu');
const links = require('./payment-links');
const { keyFor } = require('./payment-accounts');
const { getApiKeyForProperty } = require('./api-key-resolver');

const DAY = 86400000;
const HORIZON_DAYS = 365;
const MIN_LEAD_DAYS = 1;
const LINK_HOURS = 1;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugify = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** The property behind a website address, if it takes bookings there. */
async function bySlug(slug) {
  if (!SLUG.test(String(slug || ''))) return null;
  const p = await getOne(
    `SELECT id, name, smoobu_id, max_guests, check_in_time, check_out_time, booking_slug, booking_terms, public_booking
       FROM properties WHERE booking_slug = $1`, [slug]
  );
  if (!p || !p.public_booking || !(await keyFor(p.id))) return null;
  return p;
}

/**
 * Which nights are free over the next year, for the calendar. Cached for
 * a few minutes: the page asks on every month it shows, and Smoobu is
 * asked again anyway before anything is paid.
 */
const cache = new Map();
async function availability(p) {
  const hit = cache.get(p.id);
  if (hit && hit.at > Date.now() - 5 * 60 * 1000) return hit.value;
  const from = addDays(today(), MIN_LEAD_DAYS);
  const to = addDays(today(), HORIZON_DAYS);
  const res = await smoobu.getRates(p.smoobu_id, from, to, await getApiKeyForProperty(p.id));
  const days = (res && res.data && res.data[p.smoobu_id]) || {};
  const open = [];
  const minStay = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = days[d];
    if (v && Number(v.available) && Number(v.price) > 0) {
      open.push(d);
      if (Number(v.min_length_of_stay) > 1) minStay[d] = Number(v.min_length_of_stay);
    }
  }
  const value = { from, to, open, min_stay: minStay };
  cache.set(p.id, { at: Date.now(), value });
  return value;
}

function checkStay(p, { checkIn, checkOut, adults, children }) {
  if (!checkIn || checkIn < addDays(today(), MIN_LEAD_DAYS)) throw fail('The earliest check-in is tomorrow');
  if (checkOut > addDays(today(), HORIZON_DAYS + 1)) throw fail('Bookings open up to a year ahead');
  const a = Number(adults), c = Number(children || 0);
  if (!Number.isInteger(a) || a < 1 || !Number.isInteger(c) || c < 0) throw fail('Check the number of guests');
  if (p.max_guests && a + c > Number(p.max_guests)) throw fail(`${p.name} sleeps up to ${p.max_guests}`);
}

/** The price of a stay as the guest sees it, or why it cannot be booked. */
async function price(p, { checkIn, checkOut, adults = 2, children = 0 }) {
  checkStay(p, { checkIn, checkOut, adults, children });
  const q = await links.quote({ propertyId: p.id, checkIn, checkOut });
  const why = !q.available ? 'Those dates are not available'
    : q.below_min_stay ? `The minimum stay from that date is ${q.min_stay} nights` : null;
  return {
    bookable: !why, reason: why,
    check_in: q.check_in, check_out: q.check_out, nights: q.nights,
    total: q.direct_total, airbnb_total: q.airbnb_total, discount_percent: q.discount_percent, currency: q.currency,
  };
}

/** The guest's booking: a payment link of their own, handed straight to Paystack. */
async function reserve(p, { checkIn, checkOut, adults = 2, children = 0, firstName, lastName, email, phone, agreed }, baseUrl) {
  if (p.booking_terms && !agreed) throw fail('Please accept the booking terms');
  const quoted = await price(p, { checkIn, checkOut, adults, children });
  if (!quoted.bookable) throw fail(quoted.reason, 409);
  const link = await links.createLink({
    propertyId: p.id, checkIn, checkOut, adults: Number(adults), children: Number(children || 0),
    firstName, lastName, email, phone, amount: quoted.total, hours: LINK_HOURS, source: 'website',
  });
  try {
    return { checkout_url: await links.startPayment(link.token, baseUrl), token: link.token };
  } catch (err) {
    await links.cancelLink(link.id).catch(() => {});
    throw err;
  }
}

/** For the owner: each property's website settings. */
async function settings(propertyId) {
  const p = await getOne('SELECT id, name, public_booking, booking_slug, booking_terms FROM properties WHERE id = $1', [propertyId]);
  if (!p) return null;
  return { property_id: p.id, enabled: p.public_booking, slug: p.booking_slug || slugify(p.name), terms: p.booking_terms || '', paystack: Boolean(await keyFor(p.id)) };
}

async function saveSettings(propertyId, { enabled, slug, terms }) {
  const s = String(slug || '').trim().toLowerCase();
  if (!SLUG.test(s) || s.length > 40) throw fail('The address may use a–z, 0–9 and dashes, e.g. the-loft');
  const taken = await getOne('SELECT id FROM properties WHERE booking_slug = $1 AND id <> $2', [s, propertyId]);
  if (taken) throw fail('Another property already uses that address', 409);
  if (enabled && !(await keyFor(propertyId))) throw fail('Connect a Paystack account for this property first', 409);
  await run('UPDATE properties SET public_booking = $2, booking_slug = $3, booking_terms = $4 WHERE id = $1',
    [propertyId, Boolean(enabled), s, terms ? String(terms).slice(0, 4000) : null]);
  cache.delete(propertyId);
  return settings(propertyId);
}

module.exports = { bySlug, availability, price, reserve, settings, saveSettings, slugify, MIN_LEAD_DAYS, HORIZON_DAYS };
