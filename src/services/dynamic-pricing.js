/**
 * Automatic pricing: every open night priced against the market, every
 * day, by itself.
 *
 * Three answers for each night, from one model:
 *
 *   Most money        the price with the most money expected
 *   Balanced          a sale weighted twice: a little cheaper, surer to sell
 *   Most nights sold  a sale weighted four times: cheaper, near certain
 *
 * Each maximises price × chance^α, with α = 1, 2 and 4. One curve, three
 * attitudes to an empty night — and the screen shows what each would
 * earn and how many nights it would sell, so the choice is made on the
 * numbers rather than on the names.
 *
 * ## The model
 *
 * For a night, the market is the competitors' nightly rate for that date
 * (their quotes for the nearest stay of the same kind, weekend or
 * weekday, the price leader left out, each with its own cleaning fee and
 * the service fee taken off) and how full they are that night. Our rate
 * is set against it as a ratio, r = our nightly rate / market.
 *
 * The chance of selling is  P · 1 / (1 + (r / r50)^S).
 *
 *   P    the most a night can be expected to sell: higher when the market
 *        is full and there is time left to find somebody
 *   r50  where the chance has halved; it rises with how full the market
 *        is (a full market leaves guests little else) and drops when the
 *        night is close and the market still empty
 *   S    how sharply guests turn away from a dearer place
 *
 * With S fixed the three answers keep their distance from each other —
 * balanced about 12% under the most-money price, most-nights about 22% —
 * and the market moves all three. Set so that a typical market (60%
 * full) puts the most money at the market price, a full one about a
 * third above it, an empty one about a sixth below. The constants are
 * named in one place so they can be moved as the record shows how
 * nights actually sell.
 *
 * ## Guardrails, in the runner
 *
 * The model proposes; the runner disposes. A price never goes below the
 * property's floor for that month (or its general floor) or above its
 * ceiling, never moves more than the daily
 * step from what it is now, and a booked or blocked night is never
 * touched. Every change is logged with its reason, and the owner is told
 * what changed. A property is off until somebody chooses a mode for it.
 */

const { getAll, getOne, run } = require('../db/database');

const MODES = {
  occupancy: { label: 'Most nights sold', alpha: 4 },
  balanced: { label: 'Balanced', alpha: 2 },
  revenue: { label: 'Most money', alpha: 1 },
};

const MODEL = {
  S: 6,
  // Where the most money sits against the market: REV_BASE + REV_FULL · fullness².
  REV_BASE: 0.8,
  REV_FULL: 0.55,
  // Close and still empty: pulled down by up to this much.
  CLOSE_DAYS: 14,
  CLOSE_CUT: 0.1,
  // The most a night can sell: fullness, plus a share of what is left
  // that time can still sell.
  P_LEFT_BASE: 0.3,
  P_LEFT_TIME: 0.6,
  TIME_DAYS: 45,
  P_MIN: 0.1,
  P_MAX: 0.97,
  // Searched between these multiples of the market, inside floor and ceiling.
  R_MIN: 0.4,
  R_MAX: 3,
  R_STEP: 0.01,
};

const DEFAULTS = { mode: 'off', floor: null, floors: {}, ceiling: null, max_step: 15, horizon: 180 };

/**
 * The floor for a night: its month's, where one is set, else the general
 * floor. December in Cape Town and June are not the same night, and one
 * floor for both is either too low for summer or too high for winter.
 */
function floorFor(date, s) {
  const month = Number(String(date).slice(5, 7));
  const own = s.floors && Number(s.floors[month]);
  return own > 0 ? own : s.floor || null;
}
const hasFloor = (s) => Boolean(s.floor) || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].every((m) => Number(s.floors && s.floors[m]) > 0);
const MIN_COMPETITORS = 3;
const STAY_NIGHTS = 2;
const DAY = 86400000;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Where the chance of selling has halved, as a multiple of the market. */
function halfway(fullness, lead) {
  let rev = MODEL.REV_BASE + MODEL.REV_FULL * fullness ** 2;
  if (lead < MODEL.CLOSE_DAYS) rev -= MODEL.CLOSE_CUT * (1 - fullness) * (1 - Math.max(0, lead) / MODEL.CLOSE_DAYS);
  // The most money sits at r50 · (S − 1)^(−1/S); turned round, r50.
  return rev / (MODEL.S - 1) ** (-1 / MODEL.S);
}
function mostLikely(fullness, lead) {
  const time = Math.min(1, Math.max(0, lead) / MODEL.TIME_DAYS);
  return clamp(fullness + (1 - fullness) * (MODEL.P_LEFT_BASE + MODEL.P_LEFT_TIME * time), MODEL.P_MIN, MODEL.P_MAX);
}
function chanceAt(r, fullness, lead) {
  return mostLikely(fullness, lead) / (1 + (r / halfway(fullness, lead)) ** MODEL.S);
}

/**
 * The three prices for one night, in guest terms (what the guest sees on
 * Airbnb), each with its chance of selling.
 */
function recommendNight({ market, fullness, lead, floor = 0, ceiling = Infinity }) {
  if (!(market > 0)) return null;
  const lo = Math.max(MODEL.R_MIN, floor / market);
  const hi = Math.min(MODEL.R_MAX, ceiling / market);
  if (lo > hi) return null;
  const out = {};
  for (const [mode, { alpha }] of Object.entries(MODES)) {
    let best = null;
    for (let r = lo; r <= hi + 1e-9; r += MODEL.R_STEP) {
      const chance = chanceAt(r, fullness, lead);
      const score = r * chance ** alpha;
      if (!best || score > best.score) best = { r, chance, score };
    }
    out[mode] = { price: best.r * market, chance: best.chance };
  }
  return out;
}

/** Rand prices in tens; anything else in fives. */
const roundTo = (currency) => (n) => {
  const unit = currency === 'ZAR' ? 10 : 5;
  return Math.round(n / unit) * unit;
};

async function settingsFor(propertyId) {
  const row = await getOne('SELECT mode, floor, floors, ceiling, max_step, horizon FROM auto_pricing WHERE property_id = $1', [propertyId]);
  const floorRule = await getOne(`SELECT params FROM rate_strategies WHERE property_id = $1 AND strategy = 'floor'`, [propertyId]);
  const ruleFloor = Number(floorRule && floorRule.params && floorRule.params.min_price) || null;
  const s = { ...DEFAULTS, ...(row || {}) };
  return {
    mode: MODES[s.mode] ? s.mode : 'off',
    floor: s.floor != null ? Number(s.floor) : ruleFloor,
    floors: Object.fromEntries(Object.entries(s.floors || {}).filter(([m, v]) => Number(m) >= 1 && Number(m) <= 12 && Number(v) > 0).map(([m, v]) => [Number(m), Number(v)])),
    ceiling: s.ceiling != null ? Number(s.ceiling) : null,
    max_step: Number(s.max_step),
    horizon: Number(s.horizon),
  };
}

/**
 * Every open night of one property in the horizon, with the market
 * around it and the three recommendations, in our own rate (what is sent
 * to Smoobu) as well as in guest terms.
 */
async function pricePlan(propertyId, { today = new Date().toISOString().slice(0, 10), settings } = {}) {
  const property = await getOne('SELECT id, name, smoobu_id, COALESCE(base_currency, \'ZAR\') AS currency, guest_markup_airbnb FROM properties WHERE id = $1', [propertyId]);
  if (!property) return null;
  const s = settings || await settingsFor(propertyId);
  const first = addDays(today, 1);
  const last = addDays(today, s.horizon);

  const listings = await getAll('SELECT id, is_own FROM peer_listings WHERE property_id = $1 AND active', [propertyId]);
  const peers = listings.filter((l) => !l.is_own).map((l) => l.id);
  const own = listings.find((l) => l.is_own);

  const quotes = peers.length ? await getAll(
    `SELECT listing_id, to_char(check_in, 'YYYY-MM-DD') AS check_in, kind, nightly, nights FROM peer_prices
      WHERE listing_id = ANY($1::int[]) AND check_in BETWEEN $2::date - 10 AND $3::date + 10`,
    [peers, first, last]
  ) : [];
  // A competitor asking more than twice the others is in another market;
  // left out of the price, as everywhere else.
  const perListing = new Map();
  for (const q of quotes) (perListing.get(q.listing_id) || perListing.set(q.listing_id, []).get(q.listing_id)).push(q.nightly);
  const typical = median([...perListing.values()].map(median));
  const leaders = new Set([...perListing.entries()].filter(([, v]) => typical && median(v) > typical * 2).map(([id]) => id));

  const calendar = peers.length ? await getAll(
    `SELECT listing_id, to_char(date, 'YYYY-MM-DD') AS date, available FROM peer_calendar
      WHERE listing_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date`,
    [peers, first, last]
  ) : [];
  // Past the end of a listing's booking window its calendar is closed,
  // which is not the same as full; it leaves the count there.
  const windowEnd = new Map((peers.length ? await getAll(
    `SELECT listing_id, to_char(MAX(date), 'YYYY-MM-DD') AS last FROM peer_calendar
      WHERE listing_id = ANY($1::int[]) AND available GROUP BY listing_id`, [peers]
  ) : []).map((r) => [r.listing_id, r.last]));
  const takenOn = new Map();
  for (const c of calendar) {
    if (windowEnd.has(c.listing_id) && c.date > windowEnd.get(c.listing_id)) continue;
    const t = takenOn.get(c.date) || { taken: 0, of: 0 };
    t.of += 1;
    if (!c.available) t.taken += 1;
    takenOn.set(c.date, t);
  }

  // Prices compared as nightly rates, theirs and ours alike. Airbnb shows
  // a stay all-in — the nights, the cleaning fee and its own fees — so a
  // quote is taken apart the same way for everybody: the one-off cleaning
  // fee off, the rest over the nights, the service fee off. What is left
  // is the nightly rate, the number we set in Smoobu; for us, the cleaning
  // and the markup are added back on the way to the guest.
  //
  // Each competitor's own cleaning fee, measured weekly; one not yet
  // measured takes the competitors' average, and failing that ours.
  const markup = 1 + (Number(property.guest_markup_airbnb) || 0) / 100;
  const { cleaningFees } = require('./peer-cleaning');
  const fees = await cleaningFees([Number(propertyId)]);
  const ownQuotes = own ? await getAll(
    `SELECT pr.nightly, pr.nights, (d1.price + COALESCE(d2.price, d1.price)) / 2.0 AS rate
       FROM peer_prices pr
       JOIN daily_rates d1 ON d1.property_id = $1 AND d1.date = to_char(pr.check_in, 'YYYY-MM-DD')
       LEFT JOIN daily_rates d2 ON d2.property_id = $1 AND d2.date = to_char(pr.check_in + 1, 'YYYY-MM-DD')
      WHERE pr.listing_id = $2 AND d1.price > 0 AND pr.quoted_at > NOW() - INTERVAL '3 days'`, [propertyId, own.id]
  ) : [];
  const fromQuotes = median(ownQuotes.map((q) => (q.nightly - q.rate * markup) * q.nights));
  const ownCleaning = own && fees.byListing.has(own.id) ? fees.byListing.get(own.id).fee
    : fromQuotes && fromQuotes > 0 ? fromQuotes : 0;
  const peerAverage = fees.average.get(Number(propertyId));
  const cleaningOf = (listingId) => (fees.byListing.has(listingId) ? fees.byListing.get(listingId).fee
    : peerAverage ? peerAverage.average : ownCleaning);
  const nightlyRate = (q) => Math.max(0, (q.nightly * q.nights - cleaningOf(q.listing_id)) / q.nights / markup);
  // What a guest sees a night of ours at, on a two-night stay.
  const guestNight = (rate) => rate * markup + ownCleaning / STAY_NIGHTS;

  const rates = await getAll(
    `SELECT date, price, available FROM daily_rates WHERE property_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
    [propertyId, first, last]
  );
  const booked = new Set();
  for (const b of await getAll(
    `SELECT substring(check_in, 1, 10) AS a, substring(check_out, 1, 10) AS b FROM bookings
      WHERE property_id = $1 AND status = 'confirmed' AND substring(check_out, 1, 10) > $2 AND substring(check_in, 1, 10) <= $3`,
    [propertyId, first, last]
  )) for (let d = b.a; d < b.b; d = addDays(d, 1)) booked.add(d);

  const round = roundTo(property.currency);
  const nights = [];
  for (const r of rates) {
    const date = String(r.date).slice(0, 10);
    if (!Number(r.available) || booked.has(date)) continue;
    const kind = [5, 6].includes(weekday(date)) ? 'weekend' : 'weekday';
    // Each competitor's quote for the nearest stay of the same kind.
    const near = new Map();
    for (const q of quotes) {
      if (q.kind !== kind || leaders.has(q.listing_id)) continue;
      const gap = Math.abs(daysBetween(q.check_in, date));
      if (gap > 10) continue;
      const seen = near.get(q.listing_id);
      if (!seen || gap < seen.gap) near.set(q.listing_id, { gap, nightly: q.nightly, rate: nightlyRate(q) });
    }
    const market = median([...near.values()].map((v) => v.rate));
    const marketAllIn = median([...near.values()].map((v) => v.nightly));
    const full = takenOn.get(date);
    const current = Number(r.price) || null;
    const base = { date, kind, current, competitors: near.size, floor: floorFor(date, s) };
    if (!market || near.size < MIN_COMPETITORS || !full || full.of < MIN_COMPETITORS) {
      nights.push({ ...base, skip: 'too little market data' });
      continue;
    }
    const fullness = full.taken / full.of;
    const lead = daysBetween(today, date);
    const rec = recommendNight({ market, fullness, lead, floor: floorFor(date, s) || 0, ceiling: s.ceiling || Infinity });
    if (!rec) { nights.push({ ...base, skip: 'floor above ceiling' }); continue; }
    nights.push({
      ...base,
      lead,
      market: round(marketAllIn),
      market_rate: round(market),
      fullness: Math.round(fullness * 100),
      current_chance: current ? chanceAt(current / market, fullness, lead) : null,
      recommended: Object.fromEntries(Object.entries(rec).map(([m, v]) => [m, {
        rate: round(v.price), guest: round(guestNight(v.price)), chance: Math.round(v.chance * 100) / 100,
      }])),
    });
  }

  // What each choice is worth over the horizon, in our own rate.
  const priced = nights.filter((n) => n.recommended);
  const totals = { current: { nights: 0, money: 0 } };
  for (const m of Object.keys(MODES)) totals[m] = { nights: 0, money: 0 };
  for (const n of priced) {
    if (n.current && n.current_chance != null) {
      totals.current.nights += n.current_chance;
      totals.current.money += n.current * n.current_chance;
    }
    for (const m of Object.keys(MODES)) {
      totals[m].nights += n.recommended[m].chance;
      totals[m].money += n.recommended[m].rate * n.recommended[m].chance;
    }
  }
  for (const t of Object.values(totals)) { t.nights = Math.round(t.nights); t.money = Math.round(t.money); }

  return {
    property, settings: s,
    conversion: {
      markup: Math.round((markup - 1) * 1000) / 10,
      cleaning: Math.round(ownCleaning),
      competitors_cleaning: peerAverage ? peerAverage.average : null,
      competitors_measured: peerAverage ? peerAverage.measured : 0,
    },
    nights, totals, open_nights: nights.length, priced_nights: priced.length,
  };
}

/**
 * The night's new rate under the chosen mode, within the guardrails, or
 * null when it should stay as it is.
 */
function targetFor(night, s, currency) {
  if (!night.recommended || !MODES[s.mode]) return null;
  const round = roundTo(currency);
  let target = night.recommended[s.mode].rate;
  if (night.current) {
    const step = s.max_step / 100;
    target = clamp(target, night.current * (1 - step), night.current * (1 + step));
  }
  const floor = night.floor !== undefined ? night.floor : floorFor(night.date, s);
  if (floor) target = Math.max(target, floor);
  if (s.ceiling) target = Math.min(target, s.ceiling);
  target = round(target);
  if (night.current && Math.abs(target - night.current) < Math.max(round(night.current * 0.02), currency === 'ZAR' ? 10 : 5)) return null;
  return target;
}

/**
 * Price every property that has a mode, and send what changed.
 *
 * `setRates(property, dates, price)` sends one group to Smoobu; injected
 * so tests never reach it.
 */
async function runAutoPricing({ today = new Date().toISOString().slice(0, 10), propertyId = null, setRates, notifyImpl } = {}) {
  const send = setRates || defaultSetRates;
  const notify = notifyImpl || require('./notify').notify;
  const props = await getAll(
    `SELECT property_id FROM auto_pricing WHERE mode <> 'off' AND ($1::int IS NULL OR property_id = $1)`, [propertyId]
  );
  const results = [];
  for (const { property_id: id } of props) {
    const s = await settingsFor(id);
    if (s.mode === 'off' || !hasFloor(s)) { results.push({ id, skipped: 'no floor set' }); continue; }
    const plan = await pricePlan(id, { today, settings: s });
    if (!plan) continue;
    const changes = [];
    for (const n of plan.nights) {
      const target = targetFor(n, s, plan.property.currency);
      if (target != null) changes.push({ ...n, target });
    }
    const groups = new Map();
    for (const c of changes) (groups.get(c.target) || groups.set(c.target, []).get(c.target)).push(c);
    let sent = 0;
    let error = null;
    for (const [price, list] of groups) {
      try {
        await send(plan.property, list.map((c) => c.date), price);
      } catch (err) {
        error = err.message;
        break;
      }
      for (const c of list) {
        await run(
          `INSERT INTO daily_rates (property_id, date, price, fetched_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT(property_id, date) DO UPDATE SET price = EXCLUDED.price, fetched_at = NOW()`,
          [id, c.date, price]
        );
        await run(
          `INSERT INTO price_changes (property_id, date, old_price, new_price, mode, market, fullness, chance, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto')`,
          [id, c.date, c.current, price, s.mode, c.market_rate, c.fullness, c.recommended[s.mode].chance]
        );
        sent += 1;
      }
    }
    const up = changes.filter((c) => c.current && c.target > c.current).length;
    const down = changes.filter((c) => c.current && c.target < c.current).length;
    if (sent || error) {
      await notify({
        event: error ? 'prices_failed' : 'prices_updated',
        title: error
          ? `${plan.property.name}: automatic pricing stopped after ${sent} night${sent === 1 ? '' : 's'}`
          : `${plan.property.name}: ${sent} night${sent === 1 ? '' : 's'} repriced (${MODES[s.mode].label.toLowerCase()})`,
        body: error ? `Smoobu refused a change: ${error}` : `${up} up, ${down} down, against the market. Floor and daily limits held.`,
        propertyId: id,
        link: '/rates',
      });
    }
    results.push({ id, mode: s.mode, changed: sent, up, down, error });
  }
  return results;
}

async function defaultSetRates(property, dates, price) {
  const smoobu = require('./smoobu');
  const { getApiKeyForProperty } = require('./api-key-resolver');
  const apiKey = await getApiKeyForProperty(property.id);
  if (!apiKey) throw new Error('No Smoobu API key configured');
  return smoobu.setRatesForDates(property.smoobu_id, dates, price, apiKey);
}

module.exports = { MODES, MODEL, DEFAULTS, floorFor, hasFloor, recommendNight, chanceAt, halfway, mostLikely, pricePlan, targetFor, runAutoPricing, settingsFor };
