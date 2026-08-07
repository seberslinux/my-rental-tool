/**
 * Nightly rates — the price shown on an open calendar day.
 *
 * The calendar has to answer "what am I asking for this night?" for every
 * day nobody has booked. Until now it answered by inventing: it took
 * `properties.base_price` and multiplied weekends by 1.3. Both halves are
 * wrong. `base_price` is Smoobu's *minimum-price floor* — the number below
 * which its dynamic pricing may not go — not a rate anyone is charged; on
 * The loft it is R80 against real nightly prices around R3,000. And no
 * weekend multiplier exists anywhere in the system; 1.3 was a guess.
 *
 * Smoobu publishes the actual per-day rate, and `daily_rates` has always
 * had somewhere to put it. The table was empty because the only writer was
 * POST /api/analytics/sync-rates, which nothing ever called. This module is
 * that writer, extracted so the booking sync can run it too.
 *
 * Where a day has no synced rate the calendar shows nothing. An empty cell
 * says "unknown"; R80 said "eighty rand", which was worse.
 */

const smoobu = require('./smoobu');
const { getAll, transaction } = require('../db/database');

// Matches the booking sync's forward window, so the calendar's rates and
// its bookings run out on the same day rather than at different horizons.
const SYNC_DAYS = 180;

function isoDay(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Smoobu keys rates by apartment id, but nests them under `data` on some
 * responses and not others. Accept both rather than betting on one.
 */
function ratesForApartment(payload, smoobuId) {
  return payload?.data?.[smoobuId] || payload?.[smoobuId] || {};
}

/** Field names likewise vary by response; `available` may be absent entirely. */
function normalizeRate(info) {
  return {
    price: Number(info?.price ?? info?.daily_price ?? 0) || 0,
    minStay: Number(info?.min_length_of_stay ?? info?.minLengthOfStay ?? 1) || 1,
    available: info?.available === undefined ? 1 : info.available ? 1 : 0,
  };
}

/**
 * Pull rates for every property into `daily_rates`.
 *
 * `apiKeyForProperty(property)` resolves the key to use — the two callers
 * differ, one holding a single user's key and one resolving per property.
 *
 * A property that fails is logged and skipped: one apartment's bad key
 * must not cost the others their rates. Returns per-property outcomes so
 * a caller can surface a partial failure instead of reporting success.
 */
async function syncRates({ apiKeyForProperty, days = SYNC_DAYS, today = new Date() } = {}) {
  const properties = await getAll('SELECT id, name, smoobu_id FROM properties');
  const from = isoDay(today);
  const to = isoDay(new Date(today.getTime() + days * 24 * 60 * 60 * 1000));

  let synced = 0;
  const failures = [];

  for (const p of properties) {
    try {
      const apiKey = await apiKeyForProperty(p);
      const payload = await smoobu.getRates(p.smoobu_id, from, to, apiKey);
      const byDate = ratesForApartment(payload, p.smoobu_id);

      await transaction(async (client) => {
        for (const [date, info] of Object.entries(byDate)) {
          const { price, minStay, available } = normalizeRate(info);
          await client.query(
            `INSERT INTO daily_rates (property_id, date, price, min_stay, available)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT(property_id, date) DO UPDATE SET
               price = EXCLUDED.price,
               min_stay = EXCLUDED.min_stay,
               available = EXCLUDED.available,
               fetched_at = NOW()`,
            [p.id, date, price, minStay, available]
          );
          synced++;
        }
      });
    } catch (err) {
      console.error(`Rate sync failed for ${p.name}: ${err.message}`);
      failures.push({ property: p.name, error: err.message });
    }
  }

  return { synced, failures };
}

module.exports = { syncRates, ratesForApartment, normalizeRate, SYNC_DAYS };
