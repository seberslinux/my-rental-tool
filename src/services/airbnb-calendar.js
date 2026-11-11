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

/**
 * What Airbnb asks for a stay, as the listing page's booking box shows it.
 *
 * `StaysPdpBookItQuery`, logged out, 2 adults, in rand. The nightly rate
 * is read from Airbnb's own line ("2 nights x R 2,544.00") so cleaning
 * and service fees stay out of it; the total falls back to that line
 * when the line is missing. `null` means Airbnb would not quote — the
 * dates are taken or do not meet the stay rules.
 *
 * Its hash rotates like the calendar's and is replaced the same way,
 * through the `airbnb_price_hash` setting (DevTools → Network →
 * StaysPdpBookItQuery on a listing page with dates).
 */
const DEFAULT_PRICE_HASH = 'b4e68e2374e453d598e4cdf9dad60447bd1b64372e8d6deb80df3cd11d3e84db';

async function priceHash() {
  try {
    const row = await getOne("SELECT value FROM app_settings WHERE key = 'airbnb_price_hash'");
    return (row && row.value && row.value.trim()) || DEFAULT_PRICE_HASH;
  } catch {
    return DEFAULT_PRICE_HASH;
  }
}

const rands = (s) => {
  const m = String(s || '').match(/R\s?([\d,  ]+(?:\.\d+)?)/);
  return m ? Math.round(Number(m[1].replace(/[,  ]/g, ''))) : null;
};

async function fetchQuote(listingId, checkIn, checkOut, { key, hash, fetchImpl = fetch } = {}) {
  const range = { startDate: checkIn, endDate: checkOut };
  const variables = {
    id: Buffer.from(`DemandStayListing:${listingId}`).toString('base64'),
    dateRange: range,
    guestCounts: { numberOfAdults: 2 },
    includePdpMigrationBookItCalendarSheetFragment: true,
    includePdpMigrationBookItFloatingFooterFragment: true,
    includePdpMigrationBookItNavFragment: true,
    includePdpMigrationBookItSidebarFragment: true,
    includeGalleryBookItCtaFragment: true,
    includeOverviewMerchandisingTipsFragment: true,
    includeStaysPdpPriceHeatmapFragment: false,
    priceHeatmapDateRange: range,
    selectedCancellationPolicyId: null,
    causeId: null,
    selectedGuestOptionId: null,
    federatedSearchId: null,
    interactionType: null,
    logEntityPricingViewEvent: false,
  };
  const extensions = { persistedQuery: { version: 1, sha256Hash: hash } };
  const url = `${BASE}/api/v3/StaysPdpBookItQuery/${hash}` +
    `?operationName=StaysPdpBookItQuery&locale=en&currency=ZAR` +
    `&variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, 'X-Airbnb-API-Key': key, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    const why = body.error_message || body.errors?.[0]?.message || `status ${res.status}`;
    throw new Error(`Airbnb price: ${why}`);
  }
  const price = body?.data?.node?.pdpPresentation?.bookIt?.structuredDisplayPrice;
  if (!price) return null;

  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
  const line = price.explanationData?.priceDetails?.[0]?.items?.[0]?.description || '';
  const perNight = /x\s*R/.test(line) ? rands(line.split(/x/)[1]) : null;
  const total = rands(price.primaryLine?.price || price.primaryLine?.accessibilityLabel);
  const nightly = perNight || (total && nights ? Math.round(total / nights) : null);
  return nightly ? { nightly, total } : null;
}

module.exports = { fetchCalendar, fetchQuote, webKey, calendarHash, priceHash, DEFAULT_HASH, DEFAULT_PRICE_HASH };
