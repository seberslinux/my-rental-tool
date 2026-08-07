const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { pool } = require('../../src/db/database');
const { getHolidays, getUpcomingHolidays } = require('../../src/services/holidays-store');

/**
 * Holiday resolution chain: DB cache → Nager.Date → computed rules.
 *
 * Same shape as the exchange-rate fallback chain, and tested the same way:
 * no test ever reaches the network — `axios.get` is replaced for the
 * duration of each one.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// Replace axios.get for the duration of `fn`, then restore.
async function withAxios(fake, fn) {
  const orig = axios.get;
  axios.get = fake;
  try {
    return await fn();
  } finally {
    axios.get = orig;
  }
}

const apiRows = (rows) => ({
  data: rows.map((r) => ({ global: true, counties: null, ...r })),
});

// --- cache layer ---------------------------------------------------------

test('a cache miss fetches from the API and stores the result', async () => {
  let calls = 0;
  await withAxios(
    async () => {
      calls++;
      return apiRows([
        { date: '2026-01-01', localName: "New Year's Day", name: "New Year's Day" },
        { date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day' },
      ]);
    },
    async () => {
      const out = await getHolidays('ZA', 2026);
      assert.equal(calls, 1);
      assert.equal(out.length, 2);
    }
  );

  const cached = await pool.query(
    "SELECT date, name, source FROM holidays WHERE country = 'ZA' AND year = 2026 ORDER BY date"
  );
  assert.equal(cached.rowCount, 2);
  assert.equal(cached.rows[0].source, 'api');
});

test('a warm cache is served without touching the API', async () => {
  await withAxios(
    async () => apiRows([{ date: '2026-01-01', localName: "New Year's Day", name: "New Year's Day" }]),
    () => getHolidays('ZA', 2026)
  );

  // Any API call now would throw, proving the cache served the request.
  await withAxios(
    async () => { throw new Error('API must not be called on a cache hit'); },
    async () => {
      const out = await getHolidays('ZA', 2026);
      assert.equal(out.length, 1);
      assert.equal(out[0].name, "New Year's Day");
    }
  );
});

test('re-fetching the same year does not duplicate rows', async () => {
  const fake = async () => apiRows([
    { date: '2026-01-01', localName: "New Year's Day", name: "New Year's Day" },
  ]);
  await withAxios(fake, () => getHolidays('ZA', 2026));
  // Clear the in-DB rows' year so the second call misses cache but writes
  // the same (country, date, name) — the UNIQUE constraint must absorb it.
  await pool.query("UPDATE holidays SET year = 1900 WHERE country = 'ZA'");
  await withAxios(fake, () => getHolidays('ZA', 2026));

  const rows = await pool.query("SELECT count(*)::int FROM holidays WHERE country = 'ZA'");
  assert.equal(rows.rows[0].count, 1, 'ON CONFLICT DO NOTHING should prevent a duplicate');
});

// --- fallback to computed rules -----------------------------------------

test('API failure falls back to the computed rules', async () => {
  await withAxios(
    async () => { throw new Error('ECONNREFUSED'); },
    async () => {
      const out = await getHolidays('ZA', 2026);
      // The computed South African calendar has 12 entries, including the
      // Sunday-shifted Women's Day.
      assert.equal(out.length, 12);
      assert.ok(
        out.some((h) => h.date === '2026-08-10' && h.name === "National Women's Day"),
        'expected the Sunday-shifted Women\'s Day from the computed rules'
      );
    }
  );
});

test('an empty API response falls back to the computed rules', async () => {
  await withAxios(
    async () => ({ data: [] }),
    async () => {
      const out = await getHolidays('ZA', 2026);
      assert.equal(out.length, 12);
    }
  );
});

test('computed fallbacks are NOT cached, so the API can win later', async () => {
  await withAxios(
    async () => { throw new Error('down'); },
    () => getHolidays('ZA', 2026)
  );

  const cached = await pool.query("SELECT count(*)::int FROM holidays WHERE country = 'ZA'");
  assert.equal(cached.rows[0].count, 0, 'a fallback must not poison the cache');

  // With the API back, the authoritative data is fetched and stored.
  await withAxios(
    async () => apiRows([{ date: '2026-08-10', localName: "National Women's Day", name: "National Women's Day" }]),
    () => getHolidays('ZA', 2026)
  );
  const after = await pool.query("SELECT source FROM holidays WHERE country = 'ZA'");
  assert.equal(after.rowCount, 1);
  assert.equal(after.rows[0].source, 'api');
});

// --- regional filtering --------------------------------------------------

test('GB: England & Wales regional holidays are kept, Scotland-only dropped', async () => {
  await withAxios(
    async () => ({
      data: [
        { date: '2026-04-03', localName: 'Good Friday', name: 'Good Friday', global: true, counties: null },
        { date: '2026-04-06', localName: 'Easter Monday', name: 'Easter Monday', global: false, counties: ['GB-ENG', 'GB-WLS', 'GB-NIR'] },
        { date: '2026-08-03', localName: 'Summer Bank Holiday', name: 'Summer Bank Holiday', global: false, counties: ['GB-SCT'] },
        { date: '2026-11-30', localName: "Saint Andrew's Day", name: "Saint Andrew's Day", global: false, counties: ['GB-SCT'] },
      ],
    }),
    async () => {
      const out = await getHolidays('GB', 2026);
      const dates = out.map((h) => h.date);
      assert.ok(dates.includes('2026-04-03'), 'global holiday kept');
      assert.ok(dates.includes('2026-04-06'), 'England & Wales holiday kept');
      assert.ok(!dates.includes('2026-08-03'), 'Scotland-only holiday dropped');
      assert.ok(!dates.includes('2026-11-30'), 'Scotland-only holiday dropped');
    }
  );
});

test('regional holidays outside the kept regions are dropped', () => {
  // Switzerland is no longer tracked; the rule that matters now is that a
  // regional entry from an untracked country never slips through.
  const { getHolidays } = require('../../src/services/holidays-store');
  return withAxios(
    async () => ({
      data: [
        { date: '2026-04-06', localName: 'Ostermontag', name: 'Easter Monday', global: false, counties: ['CH-ZH'] },
        { date: '2026-08-01', localName: 'Bundesfeier', name: 'Swiss National Day', global: true, counties: null },
      ],
    }),
    async () => {
      const out = await getHolidays('CH', 2026);
      assert.deepEqual(out.map((h) => h.date), ['2026-08-01'], 'only the nationwide entry survives');
    }
  );
});

// --- window query --------------------------------------------------------

test('getUpcomingHolidays filters to the window and tags local vs inbound', async () => {
  await withAxios(
    async (url) => {
      if (url.includes('/ZA')) {
        return apiRows([
          { date: '2026-08-10', localName: "National Women's Day", name: "National Women's Day" },
          { date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day' },
        ]);
      }
      return apiRows([{ date: '2026-08-31', localName: 'Summer Bank Holiday', name: 'Summer Bank Holiday' }]);
    },
    async () => {
      const out = await getUpcomingHolidays('2026-08-07', { countries: ['ZA', 'GB'], days: 30 });
      assert.deepEqual(out.map((h) => h.date), ['2026-08-10', '2026-08-31']);

      const za = out.find((h) => h.country === 'ZA');
      assert.equal(za.is_local, true, 'SA holidays are local — they affect cleaners');
      assert.equal(za.country_name, 'South Africa');

      const gb = out.find((h) => h.country === 'GB');
      assert.equal(gb.is_local, false, 'other countries signal inbound demand');
    }
  );
});

test('getUpcomingHolidays spans the year boundary', async () => {
  await withAxios(
    async (url) => {
      if (url.includes('/2026/')) {
        return apiRows([{ date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day' }]);
      }
      return apiRows([{ date: '2027-01-01', localName: "New Year's Day", name: "New Year's Day" }]);
    },
    async () => {
      const out = await getUpcomingHolidays('2026-12-20', { countries: ['ZA'], days: 30 });
      assert.deepEqual(out.map((h) => h.date), ['2026-12-25', '2027-01-01']);
    }
  );
});
