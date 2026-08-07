/**
 * School holidays — the inbound-demand signal.
 *
 * Public holidays and school holidays answer different questions, and only
 * one of them predicts a long-haul booking. Nobody flies eleven hours to
 * Cape Town for German Unity Day; families come during the school break.
 *
 * ## Scope
 *
 *   ZA  nationwide. The properties are here, so the school calendar drives
 *       domestic travel as well as cleaner availability.
 *   DE  Hamburg and Bavaria only — the German regions worth watching for
 *       this portfolio, and Germany is its second-largest source market
 *       after South Africa.
 *
 * Naming two German states rather than aggregating all sixteen is what
 * makes this readable. The sixteen stagger their dates deliberately, so a
 * national view collapses to an eleven-week smear ("29 Jun – 14 Sep,
 * staggered") that says only "sometime in summer". Hamburg's summer is
 * 9 July to 19 August and Bavaria's is 3 August to 14 September; those are
 * dates you can price against.
 *
 * ## Known limitation
 *
 * South Africa really does run two school calendars — inland and coastal,
 * with the Western Cape on the coastal one — differing by a few days at
 * term boundaries. This source publishes no provincial breakdown at all
 * (its Subdivisions endpoint returns nothing for ZA), so the nationwide
 * dates are used. They are right to within a few days, and inventing
 * coastal dates would be worse than saying so.
 *
 * ## Source
 *
 * openholidaysapi.org — an EU-backed open dataset. It does not cover the
 * United Kingdom: English term dates are set by ~150 local authorities
 * with no central publication.
 */

const axios = require('axios');
const { getAll, run } = require('../db/database');

const API_BASE = 'https://openholidaysapi.org/SchoolHolidays';
const API_TIMEOUT_MS = 8000;

// The regions worth watching, and the label each carries in the UI.
// `code: null` means query the country as a whole.
const TRACKED_REGIONS = [
  { country: 'ZA', code: null, label: 'South Africa' },
  { country: 'DE', code: 'DE-HH', label: 'Hamburg' },
  { country: 'DE', code: 'DE-BY', label: 'Bavaria' },
];

/**
 * A break only counts if it is long enough and broad enough to move a
 * long-haul booking.
 *
 * Germany publishes far more than the big breaks: single-day
 * administrative closures with names like "day off", "variable holiday",
 * "additional holiday" and "repentance day", often in one state. Listing
 * them buried the four or five breaks that actually matter under a dozen
 * that never sent anyone to Cape Town.
 */
// Long enough to travel on. Both calendars carry single-day closures —
// Hamburg's "Mid-Year Break", Bavaria's "Repentance Day" — which are
// school-admin days, not travel windows.
const MIN_BREAK_NIGHTS = 5;

// Two entries belong to the same break if they nearly touch. Germany's
// states stagger their start dates by up to a few weeks, so pure overlap
// is too strict — but an unbounded gap merged May and November into one
// six-month "holiday".
const SAME_BREAK_GAP_DAYS = 21;

const MS_PER_DAY = 86400000;

function toMs(dateStr) {
  return Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
}

function nightsBetween(startStr, endStr) {
  return Math.round((toMs(endStr) - toMs(startStr)) / MS_PER_DAY) + 1;
}

/**
 * Merge the rows the API returns for one region into breaks.
 *
 * Even a single region can return a break as several adjacent rows, and
 * grouping by name alone fused unrelated occurrences: two "Special School
 * Holiday" days in June and September became one three-month span. Rows
 * must share a name AND nearly touch.
 */
function mergeBreaks(entries) {
  const rows = [];
  for (const e of entries) {
    const rawName = Array.isArray(e.name) ? e.name[0]?.text : e.name;
    if (!rawName || !e.startDate) continue;
    rows.push({
      key: rawName.trim().toLowerCase(),
      name: rawName.trim(),
      start: e.startDate,
      end: e.endDate || e.startDate,
    });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key) || a.start.localeCompare(b.start));

  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    const gap = prev && prev.key === r.key
      ? Math.round((toMs(r.start) - toMs(prev.end)) / MS_PER_DAY)
      : Infinity;
    if (prev && prev.key === r.key && gap <= SAME_BREAK_GAP_DAYS) {
      if (r.end > prev.end) prev.end = r.end;
    } else {
      out.push({ ...r });
    }
  }

  return out
    .filter((w) => nightsBetween(w.start, w.end) >= MIN_BREAK_NIGHTS)
    .map(({ name, start, end }) => ({ name, start, end }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

async function fetchFromApi(region, year) {
  const params = {
    countryIsoCode: region.country,
    languageIsoCode: 'EN',
    validFrom: `${year}-01-01`,
    validTo: `${year}-12-31`,
  };
  if (region.code) params.subdivisionCode = region.code;

  const res = await axios.get(API_BASE, { timeout: API_TIMEOUT_MS, params });
  return mergeBreaks(Array.isArray(res.data) ? res.data : []);
}

// Cached under the region label so Hamburg and Bavaria stay distinct.
async function readCache(regionKey, year) {
  const rows = await getAll(
    `SELECT date AS start, end_date AS end, name
       FROM holidays
      WHERE country = $1 AND year = $2 AND kind = 'school'
      ORDER BY date`,
    [regionKey, year]
  );
  return rows.map((r) => ({ name: r.name, start: r.start, end: r.end || r.start }));
}

async function writeCache(regionKey, year, entries) {
  for (const e of entries) {
    await run(
      `INSERT INTO holidays (country, year, date, end_date, name, kind, source)
       VALUES ($1, $2, $3, $4, $5, 'school', 'api')
       ON CONFLICT (country, date, name) DO NOTHING`,
      [regionKey, year, e.start, e.end, e.name]
    );
  }
}

/**
 * Breaks for one region and year, cache first then API.
 *
 * There is no computed fallback, unlike public holidays: term dates follow
 * no derivable rule — each ministry publishes them annually — so an
 * unreachable API yields nothing rather than something wrong.
 */
async function getSchoolHolidays(region, year) {
  const regionKey = region.code || region.country;
  const cached = await readCache(regionKey, year);
  if (cached.length > 0) return cached;

  try {
    const fetched = await fetchFromApi(region, year);
    if (fetched.length > 0) {
      await writeCache(regionKey, year, fetched);
      return fetched;
    }
  } catch (err) {
    console.warn(`School holiday API failed for ${regionKey} ${year}: ${err.message}`);
  }
  return [];
}

function addDays(dateStr, days) {
  return new Date(toMs(dateStr) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Breaks OVERLAPPING `[fromStr, fromStr + days)`, across tracked regions.
 *
 * Overlap rather than containment: a German summer already under way still
 * explains this week's arrivals, and one ending just inside the window
 * still matters.
 */
async function getUpcomingSchoolHolidays(fromStr, { regions = TRACKED_REGIONS, days = 150 } = {}) {
  const toStr = addDays(fromStr, days);
  const years = [...new Set([Number(fromStr.slice(0, 4)), Number(toStr.slice(0, 4))])];

  const jobs = [];
  for (const region of regions) {
    for (const year of years) {
      jobs.push(
        getSchoolHolidays(region, year).then((entries) =>
          entries.map((e) => ({
            ...e,
            country: region.country,
            region: region.label,
          }))
        )
      );
    }
  }

  const all = (await Promise.all(jobs)).flat();

  // The two-year fetch can return the same break twice where it straddles
  // New Year.
  const seen = new Set();
  return all
    .filter((h) => {
      if (!(h.start < toStr && h.end >= fromStr)) return false;
      const key = `${h.region}|${h.start}|${h.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.region.localeCompare(b.region));
}

module.exports = {
  getSchoolHolidays,
  getUpcomingSchoolHolidays,
  mergeBreaks,
  TRACKED_REGIONS,
};
