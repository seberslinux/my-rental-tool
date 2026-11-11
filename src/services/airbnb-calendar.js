/**
 * A listing's availability, as Airbnb's own listing page reads it.
 *
 * There is no public Airbnb API for this. The listing page calls
 * `PdpAvailabilityCalendarV2Query` for twelve months of nights — open or
 * not, and the minimum stay — and this makes the same call, logged out,
 * with the web key the page itself carries. No prices: that endpoint has
 * none.
 *
 * Two things rotate every few months: the persisted-query hash and the
 * key. The key is read fresh from a listing page each run. The hash can
 * be replaced without a deploy through the `airbnb_calendar_hash`
 * setting; take it from DevTools → Network → PdpAvailabilityCalendar on
 * any listing page.
 */

const { getOne } = require('../db/database');

const DEFAULT_HASH = '4d4724885b57d91f65be3c50c8b792b92a0dc723a871affb6ee358a0caf6d694';
const BASE = 'https://www.airbnb.co.za';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function calendarHash() {
  try {
    const row = await getOne("SELECT value FROM app_settings WHERE key = 'airbnb_calendar_hash'");
    return (row && row.value && row.value.trim()) || DEFAULT_HASH;
  } catch {
    return DEFAULT_HASH;
  }
}

/** The web key embedded in every listing page. */
async function webKey(listingId, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE}/rooms/${listingId}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`Airbnb listing page answered ${res.status}`);
  const html = await res.text();
  const key = (html.match(/"api_config":\{"key":"([a-z0-9]+)"/) || html.match(/"key":"([a-z0-9]{32})"/) || [])[1];
  if (!key) throw new Error('No Airbnb web key on the listing page — the page layout has changed');
  return key;
}

/**
 * Twelve months of nights from the current month: `{ date, available,
 * minNights }`, dates as YYYY-MM-DD.
 */
async function fetchCalendar(listingId, { key, hash, fetchImpl = fetch, now = new Date() } = {}) {
  const variables = {
    listingId: Buffer.from(`DemandStayListing:${listingId}`).toString('base64'),
    input: { count: 12, month: now.getMonth() + 1, year: now.getFullYear(), returnPropertyLevelCalendarIfApplicable: false },
  };
  const extensions = { persistedQuery: { version: 1, sha256Hash: hash } };
  const url = `${BASE}/api/v3/PdpAvailabilityCalendarV2Query/${hash}` +
    `?operationName=PdpAvailabilityCalendarV2Query&locale=en&currency=ZAR` +
    `&variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, 'X-Airbnb-API-Key': key, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = body.error_message || body.errors?.[0]?.message || `status ${res.status}`;
    throw new Error(`Airbnb calendar: ${why}`);
  }
  const months = body?.data?.node?.pdpAvailabilityCalendar?.calendarMonths;
  if (!Array.isArray(months)) {
    // Usually a rotated hash: Airbnb answers 200 with an error list.
    const why = body.errors?.[0]?.message || 'no calendar in the answer';
    throw new Error(`Airbnb calendar: ${why}`);
  }
  return months.flatMap((m) => m.days || []).map((d) => ({
    date: d.calendarDate,
    available: Boolean(d.available),
    minNights: Number.isFinite(d.minNights) ? d.minNights : null,
  }));
}

module.exports = { fetchCalendar, webKey, calendarHash, DEFAULT_HASH };
