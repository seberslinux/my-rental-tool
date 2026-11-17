/**
 * What each listing charges for cleaning, measured rather than assumed.
 *
 * Airbnb shows a stay all-in: the nights, the cleaning fee and its own
 * fees in one figure. The cleaning fee is charged once per stay, so two
 * back-to-back stays cost it twice and the same nights as one stay cost
 * it once:
 *
 *   cleaning = (nights 1–2) + (nights 3–4) − (nights 1–4)
 *
 * Three quotes per listing, once a week. The result is the cleaning fee
 * as a guest pays it — with whatever Airbnb adds to it — which is what
 * has to come off an all-in price to leave the nights.
 *
 * Kept for good in peer_cleaning_fees, one row per measurement, with the
 * three totals behind it, so a number that looks wrong can be checked.
 * A measurement that cannot be right — a long minimum stay where monthly
 * discounts swamp the sum, a fee bigger than half a stay — is recorded
 * with its reason and no fee, and the last good one stands.
 */

const { getAll, getOne, run } = require('../db/database');

const DAY = 86400000;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The long stay is twice this: kept under a week, where weekly discounts
// would take a share of the sum and pass it off as cleaning.
const MAX_NIGHTS = 3;
const LEAD_DAYS = 7;
const WINDOWS_TRIED = 3;

/** The fee from the three totals, or why there is none. */
function feeFrom(a, b, both) {
  if (![a, b, both].every((x) => Number.isFinite(x) && x > 0)) return { fee: null, note: 'a quote came back empty' };
  const fee = a + b - both;
  if (fee < -50) return { fee: null, note: 'the longer stay cost more than the two short ones' };
  if (fee > Math.min(a, b) * 0.5) return { fee: null, note: 'more than half a stay: a discount, not a cleaning fee' };
  return { fee: Math.max(0, Math.round(fee)), note: null };
}

/**
 * The first stretches far enough ahead to quote: 2n open nights from a
 * start where n (two, or the minimum stay) fits on both halves.
 */
function windows(calendar, from, count = WINDOWS_TRIED) {
  const byDate = new Map(calendar.map((c) => [c.date, c]));
  const out = [];
  for (const c of calendar) {
    if (c.date < from) continue;
    const n = Math.max(2, c.min_nights || 2);
    if (n > MAX_NIGHTS) continue;
    let ok = true;
    for (let i = 0; i < 2 * n; i++) {
      const x = byDate.get(addDays(c.date, i));
      if (!x || !x.available || (i === n && Math.max(2, x.min_nights || 2) > n)) { ok = false; break; }
    }
    if (ok) {
      out.push({ checkIn: c.date, nights: n });
      if (out.length >= count) break;
    }
  }
  return out;
}

/**
 * Measure every listing whose last good measurement is older than
 * `maxAgeDays`. Run daily, that is once a week each.
 */
async function measureCleaningFees({ fetchQuote, today = new Date().toISOString().slice(0, 10), maxAgeDays = 6, pauseMs = 700, listingIds = null } = {}) {
  const due = await getAll(
    `SELECT l.id, l.airbnb_id, l.name, COALESCE(p.base_currency, 'ZAR') AS currency, COALESCE(p.peer_guests, 2) AS guests
       FROM peer_listings l LEFT JOIN properties p ON p.id = l.property_id
      WHERE l.active AND ($2::int[] IS NULL OR l.id = ANY($2::int[]))
        AND NOT EXISTS (SELECT 1 FROM peer_cleaning_fees f WHERE f.listing_id = l.id AND f.fee IS NOT NULL
                          AND f.measured_at > NOW() - make_interval(days => $1))
      ORDER BY l.is_own DESC, l.is_benchmark DESC, l.id`,
    [maxAgeDays, listingIds]
  );
  let quote = fetchQuote;
  if (!quote && due.length) {
    const airbnb = require('./airbnb-calendar');
    const hash = await airbnb.priceHash();
    const key = await airbnb.webKey(due[0].airbnb_id);
    quote = (id, a, b, opts) => airbnb.fetchQuote(id, a, b, { key, hash, ...opts });
  }

  const results = [];
  for (const l of due) {
    const calendar = await getAll(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, available, min_nights FROM peer_calendar
        WHERE listing_id = $1 AND date >= $2::date ORDER BY date`,
      [l.id, addDays(today, LEAD_DAYS)]
    );
    const tries = windows(calendar, addDays(today, LEAD_DAYS));
    let saved = null;
    for (const w of tries) {
      const opts = { currency: l.currency, adults: l.guests };
      const mid = addDays(w.checkIn, w.nights), end = addDays(w.checkIn, 2 * w.nights);
      const get = async (a, b) => {
        try { const q = await quote(l.airbnb_id, a, b, opts); return q && q.total; } catch (err) {
          if (/\b(429|403)\b/.test(err.message)) throw err;
          return null;
        } finally { if (pauseMs) await sleep(pauseMs); }
      };
      const a = await get(w.checkIn, mid);
      const b = await get(mid, end);
      const both = await get(w.checkIn, end);
      const { fee, note } = feeFrom(a, b, both);
      await run(
        `INSERT INTO peer_cleaning_fees (listing_id, check_in, nights, total_first, total_second, total_both, fee, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [l.id, w.checkIn, w.nights, a, b, both, fee, note]
      );
      saved = { listing: l.name, fee, note };
      if (fee != null) break;
    }
    results.push(saved || { listing: l.name, fee: null, note: 'no open stretch to quote' });
  }
  return { due: due.length, measured: results.filter((r) => r.fee != null).length, results };
}

/**
 * Each listing's latest good fee, and the competitors' average, per
 * property: what the pricing subtracts and what the pages show.
 */
async function cleaningFees(propertyIds = null) {
  const rows = await getAll(
    `SELECT l.id AS listing_id, l.property_id, l.is_own, f.fee, to_char(f.measured_at, 'YYYY-MM-DD') AS measured_on
       FROM peer_listings l
       JOIN LATERAL (
         SELECT fee, measured_at FROM peer_cleaning_fees f
          WHERE f.listing_id = l.id AND f.fee IS NOT NULL ORDER BY measured_at DESC LIMIT 1
       ) f ON TRUE
      WHERE l.active AND ($1::int[] IS NULL OR l.property_id = ANY($1::int[]))`,
    [propertyIds]
  );
  const byListing = new Map(rows.map((r) => [r.listing_id, { fee: Number(r.fee), measured_on: r.measured_on }]));
  const byProperty = new Map();
  for (const r of rows) {
    if (r.is_own) continue;
    const fees = byProperty.get(r.property_id) || [];
    fees.push(Number(r.fee));
    byProperty.set(r.property_id, fees);
  }
  const average = new Map([...byProperty.entries()].map(([id, fees]) => [id, {
    average: Math.round(fees.reduce((a, b) => a + b, 0) / fees.length),
    measured: fees.length,
    without: fees.filter((f) => f === 0).length,
  }]));
  return { byListing, average };
}

module.exports = { measureCleaningFees, cleaningFees, feeFrom, windows, MAX_NIGHTS };
