const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { pool } = require('../../src/db/database');
const { getRate, convertAmount } = require('../../src/services/exchange-rates');
const axios = require('axios');

/**
 * FX exchange-rate fallback chain.
 *
 * `getRate(from, to, date)` walks a 4-step chain:
 *
 *   1. Cache: exchange_rates row for exact (from, to, date)
 *   2. API:   GET https://api.frankfurter.app/{date}?from&to  (5s timeout)
 *   3. Fallback A: most recent cached rate for (from, to), any date
 *   4. Fallback B: hardcoded FALLBACK_RATES[`${from}_${to}`]
 *   5. Last resort: return 1 (identity, so amounts round-trip unchanged)
 *
 * If any step returns a rate, later steps are skipped.
 *
 * These tests never hit Frankfurter — every test replaces `axios.get`
 * for its own scope. The DB provides the cache table.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// Utility: replace axios.get for the duration of `fn`, restore after.
async function withAxios(fake, fn) {
  const orig = axios.get;
  axios.get = fake;
  try {
    return await fn();
  } finally {
    axios.get = orig;
  }
}

// --- step 0: same-currency short-circuit --------------------------------

test('getRate: same currency returns 1 without touching cache or API', async () => {
  let apiCalled = false;
  await withAxios(async () => { apiCalled = true; }, async () => {
    const rate = await getRate('ZAR', 'ZAR', '2025-06-01');
    assert.equal(rate, 1);
    assert.equal(apiCalled, false, 'API must not be hit for same-currency');
  });
});

// --- step 1: cache hit ---------------------------------------------------

test('getRate: exact cache hit returns cached rate, no API call', async () => {
  await pool.query(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_date)
     VALUES ('EUR', 'ZAR', 21.42, '2025-06-01')`
  );

  let apiCalled = false;
  await withAxios(async () => { apiCalled = true; throw new Error('should not be called'); }, async () => {
    const rate = await getRate('EUR', 'ZAR', '2025-06-01');
    assert.equal(Number(rate), 21.42);
    assert.equal(apiCalled, false, 'cache hit must not trigger the API');
  });
});

// --- step 2: API success (writes to cache) -----------------------------

test('getRate: API success returns and caches the rate', async () => {
  await withAxios(async () => ({ data: { rates: { ZAR: 22.5 } } }), async () => {
    const rate = await getRate('EUR', 'ZAR', '2025-07-01');
    assert.equal(rate, 22.5);
  });

  const cached = await pool.query(
    `SELECT rate FROM exchange_rates WHERE base_currency='EUR' AND target_currency='ZAR' AND rate_date='2025-07-01'`
  );
  assert.equal(cached.rowCount, 1);
  assert.equal(Number(cached.rows[0].rate), 22.5);
});

// --- step 3: API fails → most-recent cached fallback -------------------

test('getRate: API fails, historical cache exists → returns most recent rate', async () => {
  // Seed two historical rates for the same pair, different dates.
  await pool.query(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_date) VALUES
     ('EUR', 'ZAR', 20.0, '2025-05-01'),
     ('EUR', 'ZAR', 21.0, '2025-06-15')`
  );

  await withAxios(async () => { throw new Error('Frankfurter is down'); }, async () => {
    // Requested date has no exact cache row → falls back to most recent.
    const rate = await getRate('EUR', 'ZAR', '2025-08-01');
    assert.equal(Number(rate), 21.0, 'should return the most recent (2025-06-15) rate');
  });
});

// --- step 4: API fails + no cache → hardcoded fallback -----------------

test('getRate: API fails, no cache, but hardcoded pair exists → hardcoded value', async () => {
  await withAxios(async () => { throw new Error('offline'); }, async () => {
    // FALLBACK_RATES['EUR_ZAR'] = 20.5.
    const rate = await getRate('EUR', 'ZAR', '2025-08-01');
    assert.equal(rate, 20.5);
  });
});

test('getRate: API fails, no cache, no hardcoded pair → returns 1 as last resort', async () => {
  await withAxios(async () => { throw new Error('offline'); }, async () => {
    // JPY→ZAR is NOT in FALLBACK_RATES; should return 1.
    const rate = await getRate('JPY', 'ZAR', '2025-08-01');
    assert.equal(rate, 1);
  });
});

// --- step 4 preferred over step 5 -------------------------------------

test('getRate: historical cache wins over hardcoded fallback', async () => {
  // If both a historical cache row AND a hardcoded pair exist, historical
  // should win (it's real data, hardcoded is guessy).
  await pool.query(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_date)
     VALUES ('EUR', 'ZAR', 99.99, '2020-01-01')`
  );

  await withAxios(async () => { throw new Error('offline'); }, async () => {
    const rate = await getRate('EUR', 'ZAR', '2025-08-01');
    assert.equal(Number(rate), 99.99, 'historical cache 99.99 should beat hardcoded 20.5');
  });
});

// --- convertAmount uses effective date for future dates ---------------

test('convertAmount: same currency returns amount unchanged, no API', async () => {
  let apiCalled = false;
  await withAxios(async () => { apiCalled = true; }, async () => {
    const out = await convertAmount(1000, 'ZAR', 'ZAR', '2025-06-01');
    assert.equal(out, 1000);
    assert.equal(apiCalled, false);
  });
});

test('convertAmount: applies rate and rounds to 2dp', async () => {
  // 100 EUR × 21.42 = 2142
  await pool.query(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, rate_date)
     VALUES ('EUR', 'ZAR', 21.42, '2025-06-01')`
  );
  const out = await convertAmount(100, 'EUR', 'ZAR', '2025-06-01');
  assert.equal(out, 2142);
});

test('convertAmount: falsy amount short-circuits', async () => {
  let apiCalled = false;
  await withAxios(async () => { apiCalled = true; }, async () => {
    assert.equal(await convertAmount(0, 'EUR', 'ZAR', '2025-06-01'), 0);
    assert.equal(await convertAmount(null, 'EUR', 'ZAR', '2025-06-01'), null);
    assert.equal(apiCalled, false);
  });
});
