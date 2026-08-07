/**
 * School holidays — the inbound-demand signal.
 *
 * Public holidays and school holidays answer different questions, and only
 * one of them predicts a long-haul booking. Nobody flies eleven hours to
 * Cape Town for German Unity Day; families come during the six-week
 * Sommerferien. So the two are used for different countries:
 *
 *   South Africa (home)    public holidays — cleaner availability, local
 *                          weekend demand — and school holidays, which
 *                          drive domestic travel.
 *   Guest-source countries school holidays only. A single public holiday
 *                          abroad moves nothing here.
 *
 * ## Source
 *
 * openholidaysapi.org — an EU-backed open dataset with one schema for
 * public and school holidays across 36 countries. Notably it does NOT
 * cover the United Kingdom: English term dates are set by ~150 local
 * authorities with no central publication, so no free source exists. The
 * UK therefore keeps public holidays only, and that gap is deliberate
 * rather than an oversight.
 *
 * ## Aggregation
 *
 * German school holidays are staggered by design — the sixteen states
 * rotate their dates so the whole country doesn't travel at once. The API
 * returns one row per state, so summer 2026 arrives as sixteen entries
 * spanning 29 June to 14 September.
 *
 * Sixteen rows is noise; the eleven-week window is the signal. Entries
 * sharing a name are collapsed into a single span from the earliest start
 * to the latest end, carrying the number of regions so the reader knows
 * the window is staggered rather than one solid national shutdown.
 */

const axios = require('axios');
const { getAll, run } = require('../db/database');

const API_BASE = 'https://openholidaysapi.org/SchoolHolidays';
const API_TIMEOUT_MS = 8000;

// Countries whose school holidays we track, and why. The UK is absent
// because the data does not exist — see the header.
const SCHOOL_HOLIDAY_COUNTRIES = ['ZA', 'DE'];

/**
 * Collapse per-region rows into one span per holiday name.
 *
 * Germany's sixteen staggered state entries for "Summer Holidays" become a
 * single 29 Jun – 14 Sep window with regions: 16.
 */
function aggregateByName(entries) {
  const byName = new Map();

  for (const e of entries) {
    // The API returns names as a list of translations; take the first.
    const rawName = Array.isArray(e.name) ? e.name[0]?.text : e.name;
    if (!rawName || !e.startDate) continue;

    // Casing varies between rows for the same holiday ("Summer Holidays"
    // vs "Summer holidays"), which would otherwise split one window in two.
    const key = rawName.trim().toLowerCase();

    const existing = byName.get(key);
    const regionCount = (e.subdivisions || []).length || (e.nationwide ? 1 : 0);

    if (!existing) {
      byName.set(key, {
        name: rawName.trim(),
        start: e.startDate,
        end: e.endDate || e.startDate,
        regions: regionCount,
        nationwide: !!e.nationwide,
      });
      continue;
    }

    if (e.startDate < existing.start) existing.start = e.startDate;
    const end = e.endDate || e.startDate;
    if (end > existing.end) existing.end = end;
    existing.regions += regionCount;
    existing.nationwide = existing.nationwide || !!e.nationwide;
  }

  return [...byName.values()].sort((a, b) => a.start.localeCompare(b.start));
}

async function fetchFromApi(country, year) {
  const res = await axios.get(API_BASE, {
    timeout: API_TIMEOUT_MS,
    params: {
      countryIsoCode: country,
      languageIsoCode: 'EN',
      validFrom: `${year}-01-01`,
      validTo: `${year}-12-31`,
    },
  });
  return aggregateByName(Array.isArray(res.data) ? res.data : []);
}

async function readCache(country, year) {
  const rows = await getAll(
    `SELECT date AS start, end_date AS end, name, regions
       FROM holidays
      WHERE country = $1 AND year = $2 AND kind = 'school'
      ORDER BY date`,
    [country, year]
  );
  return rows.map((r) => ({
    name: r.name,
    start: r.start,
    end: r.end || r.start,
    regions: r.regions || 0,
  }));
}

async function writeCache(country, year, entries) {
  for (const e of entries) {
    await run(
      `INSERT INTO holidays (country, year, date, end_date, name, kind, regions, source)
       VALUES ($1, $2, $3, $4, $5, 'school', $6, 'api')
       ON CONFLICT (country, date, name) DO NOTHING`,
      [country, year, e.start, e.end, e.name, e.regions]
    );
  }
}

/**
 * School holidays for a country and year, cache first then API.
 *
 * There is no computed fallback here, unlike public holidays: term dates
 * follow no rule that can be derived — each ministry publishes them
 * annually — so an unreachable API means an empty list rather than a
 * wrong one.
 */
async function getSchoolHolidays(country, year) {
  const cached = await readCache(country, year);
  if (cached.length > 0) return cached;

  try {
    const fetched = await fetchFromApi(country, year);
    if (fetched.length > 0) {
      await writeCache(country, year, fetched);
      return fetched;
    }
  } catch (err) {
    console.warn(`School holiday API failed for ${country} ${year}: ${err.message}`);
  }
  return [];
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
 * School-holiday windows that OVERLAP `[fromStr, fromStr + days)`.
 *
 * Overlap rather than containment: an eleven-week German summer that has
 * already started still matters, and one ending just inside the window
 * still explains the arrivals in it.
 */
async function getUpcomingSchoolHolidays(fromStr, { countries = SCHOOL_HOLIDAY_COUNTRIES, days = 120 } = {}) {
  const toStr = addDays(fromStr, days);
  const years = [...new Set([Number(fromStr.slice(0, 4)), Number(toStr.slice(0, 4))])];

  const jobs = [];
  for (const country of countries) {
    for (const year of years) {
      jobs.push(
        getSchoolHolidays(country, year).then((entries) =>
          entries.map((e) => ({ ...e, country }))
        )
      );
    }
  }

  const all = (await Promise.all(jobs)).flat();

  return all
    .filter((h) => h.start < toStr && h.end >= fromStr)
    .sort((a, b) => a.start.localeCompare(b.start) || a.country.localeCompare(b.country));
}

module.exports = {
  getSchoolHolidays,
  getUpcomingSchoolHolidays,
  aggregateByName,
  SCHOOL_HOLIDAY_COUNTRIES,
};
