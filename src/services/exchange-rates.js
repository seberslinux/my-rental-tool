/**
 * Exchange rate service using Frankfurter API (ECB data, free, no key).
 * Caches rates in SQLite to minimize API calls.
 */

const axios = require('axios');
const { getDb } = require('../db/database');

const API_BASE = 'https://api.frankfurter.app';

// Hardcoded fallback rates (approximate, used only when API + cache both fail)
const FALLBACK_RATES = {
  'EUR_ZAR': 20.5,
  'ZAR_EUR': 1 / 20.5,
  'USD_ZAR': 18.5,
  'ZAR_USD': 1 / 18.5,
  'GBP_ZAR': 23.5,
  'ZAR_GBP': 1 / 23.5,
  'EUR_USD': 1.08,
  'USD_EUR': 1 / 1.08,
  'EUR_GBP': 0.86,
  'GBP_EUR': 1 / 0.86,
  'USD_GBP': 0.80,
  'GBP_USD': 1 / 0.80,
};

/**
 * Get exchange rate for a specific date.
 * Checks cache first, then API, then fallbacks.
 */
async function getRate(fromCurrency, toCurrency, date) {
  if (fromCurrency === toCurrency) return 1;

  const db = getDb();

  // 1. Check cache
  const cached = db.prepare(
    'SELECT rate FROM exchange_rates WHERE base_currency = ? AND target_currency = ? AND rate_date = ?'
  ).get(fromCurrency, toCurrency, date);
  if (cached) return cached.rate;

  // 2. Try API
  try {
    const res = await axios.get(`${API_BASE}/${date}`, {
      params: { from: fromCurrency, to: toCurrency },
      timeout: 5000,
    });
    const rate = res.data?.rates?.[toCurrency];
    if (rate) {
      db.prepare(
        'INSERT OR IGNORE INTO exchange_rates (base_currency, target_currency, rate, rate_date) VALUES (?, ?, ?, ?)'
      ).run(fromCurrency, toCurrency, rate, date);
      return rate;
    }
  } catch (err) {
    console.warn(`FX API failed for ${fromCurrency}->${toCurrency} on ${date}: ${err.message}`);
  }

  // 3. Fallback: most recent cached rate for this pair
  const recent = db.prepare(
    'SELECT rate FROM exchange_rates WHERE base_currency = ? AND target_currency = ? ORDER BY rate_date DESC LIMIT 1'
  ).get(fromCurrency, toCurrency);
  if (recent) {
    console.warn(`Using most recent cached rate for ${fromCurrency}->${toCurrency}: ${recent.rate}`);
    return recent.rate;
  }

  // 4. Hardcoded fallback
  const key = `${fromCurrency}_${toCurrency}`;
  if (FALLBACK_RATES[key]) {
    console.warn(`Using hardcoded fallback rate for ${key}: ${FALLBACK_RATES[key]}`);
    return FALLBACK_RATES[key];
  }

  console.error(`No exchange rate available for ${fromCurrency}->${toCurrency}`);
  return 1; // Last resort: no conversion
}

/**
 * Convert an amount, using today's date if the given date is in the future.
 */
async function convertAmount(amount, fromCurrency, toCurrency, date) {
  if (!amount || fromCurrency === toCurrency) return amount;

  const today = new Date().toISOString().split('T')[0];
  const effectiveDate = date > today ? today : date;

  const rate = await getRate(fromCurrency, toCurrency, effectiveDate);
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Batch convert bookings. Groups by (currency, month) to minimize API calls.
 * Adds converted_total_price, converted_price_per_night, converted_commission to each booking.
 */
async function bulkConvert(bookings, toCurrency) {
  const today = new Date().toISOString().split('T')[0];

  // Group unique (currency, month) pairs to batch rate lookups
  const rateCache = new Map(); // "EUR|2024-08" -> rate
  const pairs = new Set();

  for (const b of bookings) {
    const curr = b.currency || 'ZAR';
    if (curr === toCurrency) continue;
    const dateStr = b.check_in || today;
    const effectiveDate = dateStr > today ? today : dateStr;
    // Use first of month for batching
    const monthKey = effectiveDate.substring(0, 7);
    pairs.add(`${curr}|${monthKey}`);
  }

  // Fetch rates for each unique pair
  for (const pair of pairs) {
    const [curr, month] = pair.split('|');
    // Use the 1st of the month as representative date
    const rateDate = `${month}-01`;
    const effectiveDate = rateDate > today ? today : rateDate;
    try {
      const rate = await getRate(curr, toCurrency, effectiveDate);
      rateCache.set(pair, rate);
    } catch (err) {
      console.error(`Failed to get rate for ${pair}:`, err.message);
      rateCache.set(pair, 1);
    }
  }

  // Apply conversion to each booking
  for (const b of bookings) {
    const curr = b.currency || 'ZAR';
    if (curr === toCurrency) {
      b.converted_total_price = b.total_price || 0;
      b.converted_price_per_night = b.price_per_night || 0;
      b.converted_commission = b.commission || 0;
      continue;
    }

    const dateStr = b.check_in || today;
    const effectiveDate = dateStr > today ? today : dateStr;
    const monthKey = effectiveDate.substring(0, 7);
    const rate = rateCache.get(`${curr}|${monthKey}`) || 1;

    b.converted_total_price = Math.round((b.total_price || 0) * rate * 100) / 100;
    b.converted_price_per_night = Math.round((b.price_per_night || 0) * rate * 100) / 100;
    b.converted_commission = Math.round((b.commission || 0) * rate * 100) / 100;
  }
}

/**
 * Convert an array of expense objects. Adds converted_amount field.
 */
async function bulkConvertExpenses(expenses, toCurrency) {
  const today = new Date().toISOString().split('T')[0];
  const rateCache = new Map();

  for (const e of expenses) {
    const curr = e.currency || 'ZAR';
    if (curr === toCurrency) {
      e.converted_amount = e.amount || 0;
      continue;
    }

    const dateStr = e.expense_date || today;
    const effectiveDate = dateStr > today ? today : dateStr;
    const monthKey = effectiveDate.substring(0, 7);
    const cacheKey = `${curr}|${monthKey}`;

    if (!rateCache.has(cacheKey)) {
      const rateDate = `${monthKey}-01`;
      const rd = rateDate > today ? today : rateDate;
      rateCache.set(cacheKey, await getRate(curr, toCurrency, rd));
    }

    const rate = rateCache.get(cacheKey) || 1;
    e.converted_amount = Math.round((e.amount || 0) * rate * 100) / 100;
  }
}

/**
 * Read display currency from app_settings.
 */
function getDisplayCurrency() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'display_currency'").get();
  return row?.value || 'ZAR';
}

module.exports = {
  getRate,
  convertAmount,
  bulkConvert,
  bulkConvertExpenses,
  getDisplayCurrency,
};
