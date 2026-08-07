/**
 * Holiday lookup with a cache-then-API-then-rules resolution chain.
 *
 * Mirrors the shape of services/exchange-rates.js, and for the same
 * reason: a third-party service we don't control must not be able to
 * blank out a panel.
 *
 *   1. DB cache      — a (country, year) fetched before is served from
 *                      Postgres, no network.
 *   2. Nager.Date    — authoritative, and free of the rule-maintenance
 *                      burden. Cross-checking against it during
 *                      development caught a genuine bug in our Dutch
 *                      rules, which is why it leads the computed rules
 *                      rather than backing them up.
 *   3. Computed rules — services/holidays.js. Used when the API is
 *                      unreachable and the cache is cold. Verified
 *                      against the API for 2025–2027 across all six
 *                      countries.
 *
 * Holiday data for a given year never changes once published, so cached
 * rows are never invalidated — only future years are ever missing.
 */

const axios = require('axios');
const { getAll, run } = require('../db/database');
const { holidaysForCountry, HOME_COUNTRY, COUNTRY_NAMES, DEFAULT_COUNTRIES } = require('./holidays');

const API_BASE = 'https://date.nager.at/api/v3/PublicHolidays';
const API_TIMEOUT_MS = 5000;

/**
 * Nager splits some holidays by region: `global: false` with a `counties`
 * list. Those are kept when they cover the country's main population —
 * England & Wales for the UK, most cantons for Switzerland — because the
 * point of this list is travel demand, not a payroll calendar. Purely
 * local observances are dropped.
 */
const REGIONAL_KEEP = {
  GB: ['GB-ENG', 'GB-WLS'],
  CH: null, // keep all — Swiss holidays are cantonal almost by definition
};

function shouldKeep(country, entry) {
  if (entry.global) return true;
  if (!(country in REGIONAL_KEEP)) return false;
  const wanted = REGIONAL_KEEP[country];
  if (wanted === null) return true;
  return (entry.counties || []).some((c) => wanted.includes(c));
}

async function fetchFromApi(country, year) {
  const res = await axios.get(`${API_BASE}/${year}/${country}`, { timeout: API_TIMEOUT_MS });
  const rows = Array.isArray(res.data) ? res.data : [];
  // Deduplicate — Nager lists some cantonal holidays once per canton group.
  const seen = new Set();
  const out = [];
  for (const h of rows) {
    if (!shouldKeep(country, h)) continue;
    const name = h.localName || h.name;
    const key = `${h.date}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: h.date, name });
  }
  return out;
}

async function readCache(country, year) {
  return getAll(
    'SELECT date, name FROM holidays WHERE country = $1 AND year = $2 ORDER BY date',
    [country, year]
  );
}

async function writeCache(country, year, entries, source) {
  for (const e of entries) {
    await run(
      `INSERT INTO holidays (country, year, date, name, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (country, date, name) DO NOTHING`,
      [country, year, e.date, e.name, source]
    );
  }
}

/**
 * Holidays for one country and year, resolving cache → API → rules.
 * Successful API responses are cached; computed fallbacks are not, so a
 * later request can still pick up the authoritative data.
 */
async function getHolidays(country, year) {
  const cached = await readCache(country, year);
  if (cached.length > 0) return cached;

  try {
    const fetched = await fetchFromApi(country, year);
    if (fetched.length > 0) {
      await writeCache(country, year, fetched, 'api');
      return fetched;
    }
    console.warn(`Holiday API returned nothing for ${country} ${year}; using computed rules`);
  } catch (err) {
    console.warn(`Holiday API failed for ${country} ${year} (${err.message}); using computed rules`);
  }

  // Deliberately not cached — we want the API to win on a later attempt.
  return holidaysForCountry(country, year).map((h) => ({ date: h.date, name: h.name }));
}

function addDays(dateStr, days) {
  const ms = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Holidays in `[fromStr, fromStr + days)` across `countries`, sorted by
 * date then country. Spans the year boundary by resolving both years.
 */
async function getUpcomingHolidays(fromStr, { countries = DEFAULT_COUNTRIES, days = 90 } = {}) {
  const toStr = addDays(fromStr, days);
  const years = [...new Set([Number(fromStr.slice(0, 4)), Number(toStr.slice(0, 4))])];

  // Resolve country-years concurrently. On a cold cache this is up to
  // twelve API round trips; sequentially that would stall the dashboard's
  // first load for several seconds. Writes are idempotent (ON CONFLICT DO
  // NOTHING) so concurrent inserts are safe.
  const jobs = [];
  for (const country of countries) {
    for (const year of years) {
      jobs.push(
        getHolidays(country, year).then((entries) =>
          entries.map((e) => ({
            date: e.date,
            name: e.name,
            country,
            country_name: COUNTRY_NAMES[country] || country,
            is_local: country === HOME_COUNTRY,
          }))
        )
      );
    }
  }
  const all = (await Promise.all(jobs)).flat();

  return all
    .filter((h) => h.date >= fromStr && h.date < toStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
}

module.exports = { getHolidays, getUpcomingHolidays };
