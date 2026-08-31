const express = require('express');
const router = express.Router();
const { getAll, getOne, run, inParams, transaction } = require('../db/database');
// One answer to "is it clean", shared with the planner.
const { propertyStatus, ymd } = require('../services/cleaning-status');
const { scopeProperties, denyIfOutOfScope, requireRole } = require('../middleware/auth');
const smoobu = require('../services/smoobu');
const { CATEGORIES, LABEL, planNights } = require('../services/rate-plan');
// The rules that read the diary — see that module for why they multiply
// rather than take turns overwriting each other.
const { catalogue, defaultsFor, readParams, applyStrategies, STRATEGIES, FLOOR } =
  require('../services/rate-strategies');
const { occupancyByProperty } = require('../services/dashboard-calc');
// One rate, three numbers — what you set, what the guest is charged,
// what reaches you. See that module for why markup and commission are
// separate fields rather than one number in different clothes.
const { viewsFor, channelList } = require('../services/channel-price');
// What Smoobu's markup has been doing, read off the bookings it made.
// Offered as a suggestion; Smoobu remains the authority.
const { observedMarkup } = require('../services/observed-markup');
const { getUpcomingHolidays } = require('../services/holidays-store');
const { getUpcomingSchoolHolidays } = require('../services/school-holidays');
const { getApiKeyForProperty } = require('../services/api-key-resolver');
// One place decides who gets told what.
const { notify } = require('../services/notify');

// Apply property scoping to all routes
router.use(scopeProperties);

// Get all properties
router.get('/', async (req, res) => {
  let properties;
  if (req.accessiblePropertyIds === null) {
    properties = await getAll('SELECT * FROM properties ORDER BY name ASC');
  } else {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json([]);
    const ph = inParams(ids, 1);
    properties = await getAll(`SELECT * FROM properties WHERE id IN (${ph}) ORDER BY name ASC`, ids);
  }
  res.json(properties);
});

// Get a single property
/**
 * How every property stands, cleaning-wise, right now.
 *
 * One question the home screen asks and the planner asks — computed from
 * the same jobs and stays either of them would look at, so the number on
 * the screen and the decision behind the scenes can never disagree.
 */
router.get('/cleaning-status', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const properties = await getAll(
    req.accessiblePropertyIds === null ?
    'SELECT * FROM properties ORDER BY name' :
    `SELECT * FROM properties WHERE id = ANY($1) ORDER BY name`,
    req.accessiblePropertyIds === null ? [] : [req.accessiblePropertyIds]
  );
  if (properties.length === 0) return res.json([]);

  const ids = properties.map((p) => p.id);
  const stays = await getAll(
    `SELECT * FROM bookings WHERE property_id = ANY($1) AND check_out >= $2 AND check_in <= $3`,
    [ids, since, horizon]
  );
  const jobs = await getAll(
    `SELECT * FROM cleaning_jobs WHERE property_id = ANY($1) AND cleaning_date >= $2 AND cleaning_date <= $3`,
    [ids, since, horizon]
  );
  const blocks = await getAll(
    `SELECT * FROM blocked_dates WHERE property_id = ANY($1) AND released_at IS NULL`,
    [ids]
  );

  res.json(properties.map((property) => {
    const mine = (rows) => rows.filter((r) => r.property_id === property.id);
    const state = propertyStatus({
      property, stays: mine(stays), jobs: mine(jobs), today,
    });
    const nextClean = mine(jobs).
    filter((j) => !j.completed_at && ymd(j.cleaning_date) >= today).
    map((j) => ymd(j.cleaning_date)).
    sort()[0] || null;

    return {
      id: property.id, name: property.name,
      ...state,
      next_clean: nextClean,
      blocks: mine(blocks).map((b) => ({
        id: b.id, from: ymd(b.date), to: ymd(b.end_date), reason: b.reason,
        can_release: Boolean(b.smoobu_reservation_id),
      })),
    };
  }));
});

router.get('/:id', async (req, res) => {
  if (req.accessiblePropertyIds !== null && !req.accessiblePropertyIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'Access denied to this property' });
  }
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  res.json(property);
});

// Get property performance summary
router.get('/:id/summary', async (req, res) => {
  if (req.accessiblePropertyIds !== null && !req.accessiblePropertyIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'Access denied to this property' });
  }
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const id = req.params.id;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // --- KPIs (last 30 days) ---

  // Revenue: sum of total_price for confirmed bookings overlapping last 30 days
  const revenue30dRow = await getOne(`
    SELECT COALESCE(SUM(total_price), 0) AS val FROM bookings
    WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);
  const revenue30d = revenue30dRow.val;

  // Booked nights in last 30 days
  const bookings30d = await getAll(`
    SELECT check_in, check_out FROM bookings
    WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);

  let bookedNights = 0;
  for (const b of bookings30d) {
    const start = new Date(Math.max(new Date(b.check_in).getTime(), new Date(thirtyDaysAgo).getTime()));
    const end = new Date(Math.min(new Date(b.check_out).getTime(), new Date(today).getTime()));
    const nights = Math.max(0, Math.round((end - start) / 86400000));
    bookedNights += nights;
  }
  const occupancy30d = Math.min(100, (bookedNights / 30) * 100);

  // Average nightly rate
  const avgRate30dRow = await getOne(`
    SELECT COALESCE(AVG(price_per_night), 0) AS val FROM bookings
    WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3 AND price_per_night > 0
  `, [id, today, thirtyDaysAgo]);
  const avgRate30d = avgRate30dRow.val;

  // Net profit: revenue - expenses in last 30 days
  const expenses30dRow = await getOne(`
    SELECT COALESCE(SUM(amount), 0) AS val FROM expenses
    WHERE property_id = $1 AND expense_date >= $2 AND expense_date <= $3
  `, [id, thirtyDaysAgo, today]);
  const expenses30d = expenses30dRow.val;
  const netProfit30d = revenue30d - expenses30d;

  // Cancellation rate
  const totalBookings30dRow = await getOne(`
    SELECT COUNT(*) AS val FROM bookings
    WHERE property_id = $1 AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);
  const totalBookings30d = totalBookings30dRow.val;
  const cancelledBookings30dRow = await getOne(`
    SELECT COUNT(*) AS val FROM bookings
    WHERE property_id = $1 AND status = 'cancelled' AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);
  const cancelledBookings30d = cancelledBookings30dRow.val;
  const cancellationRate30d = totalBookings30d > 0 ? (cancelledBookings30d / totalBookings30d) * 100 : 0;

  // --- Monthly data (last 12 months) ---
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const monthStr = `${year}-${month}`;
    const monthStart = `${monthStr}-01`;
    // End of month
    const nextMonth = new Date(year, d.getMonth() + 1, 1);
    const monthEnd = new Date(nextMonth - 86400000).toISOString().slice(0, 10);
    const daysInMonth = new Date(nextMonth - 86400000).getDate();

    const mRev = await getOne(`
      SELECT COALESCE(SUM(total_price), 0) AS revenue, COUNT(*) AS booking_count,
             COALESCE(AVG(CASE WHEN price_per_night > 0 THEN price_per_night END), 0) AS avg_rate
      FROM bookings
      WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
    `, [id, monthEnd, monthStart]);

    // Occupancy for this month
    const mBookings = await getAll(`
      SELECT check_in, check_out FROM bookings
      WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
    `, [id, monthEnd, monthStart]);
    let mNights = 0;
    for (const b of mBookings) {
      const s = new Date(Math.max(new Date(b.check_in).getTime(), new Date(monthStart).getTime()));
      const e = new Date(Math.min(new Date(b.check_out).getTime(), nextMonth.getTime()));
      mNights += Math.max(0, Math.round((e - s) / 86400000));
    }

    monthly.push({
      month: monthStr,
      revenue: mRev.revenue,
      occupancy_pct: Math.min(100, (mNights / daysInMonth) * 100),
      avg_rate: mRev.avg_rate,
      booking_count: mRev.booking_count,
    });
  }

  // --- Upcoming bookings ---
  const upcomingBookings = await getAll(`
    SELECT guest_name, check_in, check_out, length_of_stay AS nights, platform, total_price
    FROM bookings
    WHERE property_id = $1 AND status = 'confirmed' AND check_in >= $2
    ORDER BY check_in ASC
  `, [id, today]);

  // --- Recent reviews ---
  const recentReviews = await getAll(`
    SELECT guest_name, rating, comment, review_date, platform
    FROM reviews
    WHERE property_id = $1
    ORDER BY review_date DESC
    LIMIT 5
  `, [id]);

  res.json({
    property,
    kpis: {
      revenue_30d: revenue30d,
      occupancy_30d: Math.round(occupancy30d * 100) / 100,
      avg_nightly_rate_30d: Math.round(avgRate30d * 100) / 100,
      net_profit_30d: Math.round(netProfit30d * 100) / 100,
      cancellation_rate_30d: Math.round(cancellationRate30d * 100) / 100,
    },
    monthly,
    upcoming_bookings: upcomingBookings,
    recent_reviews: recentReviews,
  });
});

// Update property settings
/**
 * Set the nightly rate for a night, or a run of nights.
 *
 * This is the number the owner actually manages. Smoobu takes a rate per
 * date and applies each channel's percentage on top before pushing it to
 * Airbnb and the rest, so one figure per night is the whole input.
 *
 * Until now nothing in the app could write one. Rates were pulled from
 * Smoobu into `daily_rates` and shown, and the only thing that ever tried
 * to write them was a nightly engine pricing from `base_price` — Smoobu's
 * minimum-price floor, R80 on a flat that sells for R3,300.
 *
 * Smoobu first, then us. A rate we stored but failed to send would put a
 * price on the calendar that no guest can book, which is worse than
 * refusing the edit: the calendar is only worth reading if it agrees with
 * the channel.
 */
/**
 * The rate plan: what each kind of night is worth.
 *
 * Five categories, most specific first. Stored, previewed, and only then
 * applied — never on a schedule. The engine this replaces ran every
 * morning against a number nobody could see, and the only thing that
 * stopped it repricing two listings to R80 was an unrelated API bug.
 */
router.get('/:id/rate-plan', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const rows = await getAll(
    'SELECT category, price, min_stay FROM rate_plans WHERE property_id = $1',
    [req.params.id]
  );
  const plan = {};
  for (const r of rows) plan[r.category] = { price: r.price, min_stay: r.min_stay };
  res.json({ plan, categories: CATEGORIES, labels: LABEL });
});

router.put('/:id/rate-plan', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const plan = (req.body && req.body.plan) || {};

  for (const [category, rule] of Object.entries(plan)) {
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Unknown category: ${category}` });
    }
    // A blank price means "no rule here", which is not the same as free.
    if (rule == null || rule.price === '' || rule.price == null) continue;
    const price = Number(rule.price);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: `${LABEL[category]} needs a positive rate` });
    }
    const minStay = rule.min_stay == null || rule.min_stay === '' ? null : Number(rule.min_stay);
    if (minStay != null && (!Number.isInteger(minStay) || minStay < 1 || minStay > 30)) {
      return res.status(400).json({ error: `${LABEL[category]} needs a minimum stay of 1 to 30 nights` });
    }
  }

  for (const category of CATEGORIES) {
    const rule = plan[category];
    const blank = rule == null || rule.price === '' || rule.price == null;
    if (blank) {
      await run('DELETE FROM rate_plans WHERE property_id = $1 AND category = $2',
        [req.params.id, category]);
      continue;
    }
    await run(
      `INSERT INTO rate_plans (property_id, category, price, min_stay, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT(property_id, category) DO UPDATE SET
         price = EXCLUDED.price, min_stay = EXCLUDED.min_stay, updated_at = NOW()`,
      [req.params.id, category, Number(rule.price),
       rule.min_stay === '' || rule.min_stay == null ? null : Number(rule.min_stay)]
    );
  }

  res.json({ ok: true });
});

/**
 * What the plan would do, and then doing it.
 *
 * Preview and apply share one function so they cannot disagree — the
 * list you approve is the list that gets sent. A preview computed one
 * way and an apply another is how somebody ends up agreeing to one thing
 * and getting a different one.
 */
/**
 * Whatever the caller wants tried, or whatever is saved.
 *
 * The screen sends a config it has not saved so somebody can try a
 * setting, look at what it does and change their mind — which is most of
 * what that page is for. Absent one, the property's own saved strategies
 * are used, so apply and the nightly view agree without the client
 * having to remember to send anything.
 */
async function strategyConfigFor(propertyId, override) {
  if (override && typeof override === 'object') return override;
  const rows = await getAll(
    'SELECT strategy, enabled, params FROM rate_strategies WHERE property_id = $1',
    [propertyId]
  );
  const config = {};
  for (const r of rows) config[r.strategy] = { enabled: r.enabled, params: r.params || {} };
  return config;
}

async function planFor(propertyId, from, to, strategyOverride) {
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [propertyId]);

  const planRows = await getAll(
    'SELECT category, price, min_stay FROM rate_plans WHERE property_id = $1', [propertyId]
  );
  const plan = {};
  for (const r of planRows) plan[r.category] = { price: r.price, min_stay: r.min_stay };

  /**
   * Bookings around the window, not merely inside it.
   *
   * A gap is defined by the two bookings on either side of it, and one of
   * those can easily sit outside the range being priced — a guest who
   * checks out on the first night of the window was excluded by
   * `check_out > from`, so the hole they leave behind was invisible and
   * the orphan-gap rule had nothing to work with.
   *
   * The padding is a month, comfortably more than any gap worth filling.
   * Nothing else is affected by the extra rows: a night is sold only if a
   * booking actually spans it, and occupancy clips to the window itself.
   */
  const PAD_DAYS = 31;
  const pad = (date, n) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

  const bookings = await getAll(
    `SELECT check_in, check_out, status FROM bookings
      WHERE property_id = $1 AND status = 'confirmed' AND check_out > $2 AND check_in <= $3`,
    [propertyId, pad(from, -PAD_DAYS), pad(to, PAD_DAYS)]
  );

  const rateRows = await getAll(
    'SELECT date, price, min_stay FROM daily_rates WHERE property_id = $1 AND date >= $2 AND date <= $3',
    [propertyId, from, to]
  );
  const currentRates = {};
  for (const r of rateRows) currentRates[r.date] = { price: r.price, min_stay: r.min_stay };

  // Holidays must never take the page down; without them every night is
  // simply a weekday or a weekend, which is wrong but not dangerous.
  let holidays = [];
  try {
    const [publicDays, schoolBreaks] = await Promise.all([
      getUpcomingHolidays(from, { countries: ['ZA'], days: 400 }),
      getUpcomingSchoolHolidays(from, { days: 400 }),
    ]);
    holidays = [
      ...publicDays.map((h) => ({ start: h.date, end: h.date, kind: 'public', name: h.name })),
      ...schoolBreaks.map((h) => ({ start: h.start, end: h.end, kind: 'school', name: h.name })),
    ];
  } catch (err) {
    console.error('Holiday lookup failed for the rate plan:', err.message);
  }

  const planned = planNights({ from, to, plan, holidays, currentRates, bookings });

  /**
   * How full the window being priced already is.
   *
   * Counted by the function the dashboard uses rather than a second one
   * here, so "60% booked" means the same thing on both screens. Over the
   * window itself, not a fixed thirty days: the question the pace rule
   * asks is about the stretch you are pricing.
   */
  const nights = Math.max(1, Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1);
  const [occ] = occupancyByProperty(
    bookings.map((b) => ({ ...b, property_id: Number(propertyId) })),
    [Number(propertyId)], from, nights
  );
  const occupancy = occ ? Math.min(1, occ.booked_nights / nights) : null;

  const config = await strategyConfigFor(propertyId, strategyOverride);
  const rows = applyStrategies({
    rows: planned, config, today: new Date().toISOString().slice(0, 10), bookings, occupancy,
  });

  return { property, plan, config, occupancy, rows };
}

router.post('/:id/rate-plan/preview', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const { from, to } = req.body || {};
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(String(from)) || !day.test(String(to))) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }

  // `strategies` in the body is a config the screen is trying out and has
  // not saved. That is the point of the page: change a number, see what
  // it would do, change it back.
  const { rows: priced, occupancy, property } = await planFor(
    req.params.id, from, to, req.body && req.body.strategies
  );

  /**
   * Each night in all three of its forms.
   *
   * What you set is not what the guest is charged and is not what
   * reaches you. Computed here rather than in the client because "what
   * you keep" runs through calcDeductions — VAT applies to the fees, not
   * to the rate, and that is not arithmetic worth writing twice.
   */
  const rows = priced.map((r) => ({ ...r, views: viewsFor(r.new_price, property) }));
  const changing = rows.filter((r) => r.changes);

  // What it is worth, so the comparison is in money rather than in a
  // count of nights that moved. Only over nights the plan actually
  // covers — a night with no rule is not revenue anybody is choosing.
  const planTotal = rows.reduce((n, r) => n + (r.plan_price || 0), 0);
  const newTotal = rows.reduce((n, r) => n + r.new_price, 0);
  const currentTotal = rows.reduce((n, r) => n + (r.current_price || r.plan_price || 0), 0);

  res.json({
    nights: rows.length,
    changing: changing.length,
    occupancy,
    // Named here so the screen can label a toggle without knowing which
    // channels exist or what this property charges on each.
    channels: channelList(property),
    totals: {
      current: Math.round(currentTotal),
      plan: Math.round(planTotal),
      strategies: Math.round(newTotal),
    },
    rows,
  });
});

/**
 * The algorithms on offer, and which of them this property uses.
 *
 * The catalogue is served rather than hard-coded in the client so a new
 * strategy appears on the page by existing — its label, its blurb and
 * the parameters it takes all come from the one place that defines it.
 */
/**
 * What the channel markup appears to be, from the bookings it produced.
 *
 * Smoobu owns this setting and is the only authority on it — whatever
 * comes back here, the guest pays what Smoobu decides. But every booking
 * records what the guest was charged and daily_rates records what was
 * being asked for those nights, so the ratio is the markup observed
 * rather than declared.
 *
 * Offered, never applied. It fills a suggestion on the screen that
 * somebody accepts or overrules; nothing writes guest_markup_* but a
 * person.
 *
 * Only nights that still carry a synced rate can be measured, and
 * daily_rates runs from today forward, so in practice this reads future
 * bookings. A property with none returns an empty object, which the
 * screen shows as nothing rather than as zero.
 */
router.get('/:id/observed-markup', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;

  const rateRows = await getAll(
    'SELECT date, price FROM daily_rates WHERE property_id = $1', [req.params.id]
  );
  if (rateRows.length === 0) return res.json({ observed: {}, rated_nights: 0 });

  const rates = {};
  for (const r of rateRows) rates[String(r.date).slice(0, 10)] = r.price;

  const dates = Object.keys(rates).sort();
  const bookings = await getAll(
    `SELECT check_in, check_out, total_price, platform, status FROM bookings
      WHERE property_id = $1 AND status = 'confirmed'
        AND check_out > $2 AND check_in <= $3`,
    [req.params.id, dates[0], dates[dates.length - 1]]
  );

  res.json({ observed: observedMarkup({ bookings, rates }), rated_nights: dates.length });
});

router.get('/:id/rate-strategies', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const rows = await getAll(
    'SELECT strategy, enabled, params FROM rate_strategies WHERE property_id = $1',
    [req.params.id]
  );
  const config = {};
  for (const r of rows) config[r.strategy] = { enabled: r.enabled, params: r.params || {} };

  // Anything never configured comes back with its defaults filled in, so
  // the form has something to show and turning a strategy on does not
  // require setting every field first.
  const list = catalogue();
  for (const s of list) {
    if (!config[s.key]) config[s.key] = { enabled: false, params: defaultsFor(s.key) };
    else config[s.key].params = readParams(s.key, config[s.key].params);
  }
  res.json({ catalogue: list, config });
});

router.put('/:id/rate-strategies', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const given = (req.body && req.body.config) || {};
  const known = new Set([...Object.keys(STRATEGIES), FLOOR.key]);

  for (const key of Object.keys(given)) {
    if (!known.has(key)) return res.status(400).json({ error: `Unknown strategy: ${key}` });
  }

  for (const key of known) {
    const entry = given[key];
    if (!entry) continue;
    // Read through the catalogue on the way in, so a number typed past
    // its bounds is stored as the bound rather than kept and clamped
    // differently by every later reader.
    await run(
      `INSERT INTO rate_strategies (property_id, strategy, enabled, params, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT(property_id, strategy) DO UPDATE SET
         enabled = EXCLUDED.enabled, params = EXCLUDED.params, updated_at = NOW()`,
      [req.params.id, key, Boolean(entry.enabled), JSON.stringify(readParams(key, entry.params))]
    );
  }
  res.json({ ok: true });
});

router.post('/:id/rate-plan/apply', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const { from, to } = req.body || {};
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(String(from)) || !day.test(String(to))) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }

  // Apply reads the same override the preview did, so pressing the
  // button sends the list on screen rather than the saved settings the
  // screen may have been changed away from.
  const { property, rows } = await planFor(req.params.id, from, to, req.body && req.body.strategies);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const changing = rows.filter((r) => r.changes);
  if (changing.length === 0) return res.json({ ok: true, applied: 0, skipped: rows.length });

  const apiKey = await getApiKeyForProperty(property.id);
  if (!apiKey) return res.status(400).json({ error: 'No Smoobu API key configured' });

  // One request per distinct price-and-minimum, which is what the plan
  // produces: five categories at most, not one call per night.
  const groups = new Map();
  for (const r of changing) {
    const key = `${r.new_price}|${r.new_min_stay || ''}`;
    if (!groups.has(key)) groups.set(key, { price: r.new_price, minStay: r.new_min_stay, dates: [] });
    groups.get(key).dates.push(r.date);
  }

  let applied = 0;
  for (const g of groups.values()) {
    try {
      await smoobu.setRatesForDates(property.smoobu_id, g.dates, g.price, apiKey, g.minStay);
    } catch (err) {
      const detail = err.response && err.response.data ?
      (err.response.data.detail || JSON.stringify(err.response.data)) : err.message;
      return res.status(502).json({ error: `Smoobu refused it: ${detail}`, applied });
    }
    for (const date of g.dates) {
      await run(
        `INSERT INTO daily_rates (property_id, date, price, min_stay, fetched_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT(property_id, date) DO UPDATE SET
           price = EXCLUDED.price,
           min_stay = COALESCE(EXCLUDED.min_stay, daily_rates.min_stay),
           fetched_at = NOW()`,
        [property.id, date, g.price, g.minStay]
      );
      applied += 1;
    }
  }

  res.json({ ok: true, applied, skipped: rows.length - applied });
});

router.put('/:id/rates', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const { from, to, price, min_stay: minStayRaw } = req.body || {};
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(String(from)) || !day.test(String(to || from))) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }
  const last = to || from;
  if (last < from) return res.status(400).json({ error: 'That range ends before it starts' });

  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'A nightly rate must be a positive number' });
  }

  // Optional. Left out, the nights keep whatever minimum they had —
  // sending a default would quietly rewrite a restriction nobody touched.
  let minStay = null;
  if (minStayRaw !== undefined && minStayRaw !== null && minStayRaw !== '') {
    minStay = Number(minStayRaw);
    if (!Number.isInteger(minStay) || minStay < 1 || minStay > 30) {
      return res.status(400).json({ error: 'A minimum stay must be a whole number of nights, 1 to 30' });
    }
  }
  // A typo of an extra zero is the expensive direction, and the floor is
  // the one number Smoobu already holds an opinion about.
  if (property.base_price > 0 && amount < property.base_price) {
    return res.status(400).json({
      error: `Below the minimum of ${Math.round(property.base_price)} set in Smoobu`,
    });
  }

  // Nights somebody has already bought are not for repricing. The guest
  // paid what they paid, and a range dragged across a month should not
  // quietly rewrite the middle of a stay. They are reported back so the
  // count on screen is the number of nights that actually changed.
  const nightsIn = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${last}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    nightsIn.push(d.toISOString().slice(0, 10));
  }

  const sold = await getAll(
    `SELECT check_in, check_out FROM bookings
      WHERE property_id = $1 AND status = 'confirmed'
        AND check_out > $2 AND check_in <= $3`,
    [property.id, from, last]
  );
  const isSold = (date) =>
  sold.some((b) => String(b.check_in) <= date && date < String(b.check_out));

  const dates = nightsIn.filter((d) => !isSold(d));
  const skipped = nightsIn.length - dates.length;

  if (dates.length === 0) {
    return res.status(400).json({
      error: skipped ? 'Every night in that range is already booked' : 'No nights in that range',
    });
  }

  const apiKey = await getApiKeyForProperty(property.id);
  if (!apiKey) return res.status(400).json({ error: 'No Smoobu API key configured' });

  try {
    await smoobu.setRatesForDates(property.smoobu_id, dates, amount, apiKey, minStay);
  } catch (err) {
    const detail = err.response && err.response.data ?
    (err.response.data.detail || JSON.stringify(err.response.data)) :
    err.message;
    return res.status(502).json({ error: `Smoobu refused it: ${detail}` });
  }

  // Smoobu took it, so our copy can follow.
  for (const date of dates) {
    await run(
      minStay == null ?
      `INSERT INTO daily_rates (property_id, date, price, fetched_at)
         VALUES ($1, $2, $3, NOW())
       ON CONFLICT(property_id, date) DO UPDATE SET price = EXCLUDED.price, fetched_at = NOW()` :
      `INSERT INTO daily_rates (property_id, date, price, min_stay, fetched_at)
         VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT(property_id, date) DO UPDATE SET
         price = EXCLUDED.price, min_stay = EXCLUDED.min_stay, fetched_at = NOW()`,
      minStay == null ? [property.id, date, amount] : [property.id, date, amount, minStay]
    );
  }

  res.json({ ok: true, nights: dates.length, skipped, price: amount, min_stay: minStay });
});

router.put('/:id', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const fields = ['address','cleaning_hours_required','base_price','base_currency','airbnb_url','airbnb_id','booking_url','booking_id_ext','vrbo_url','vrbo_id','commission_airbnb','commission_booking','commission_vrbo','guest_markup_airbnb','guest_markup_booking','guest_markup_vrbo','bank_charge_airbnb','bank_charge_booking','bank_charge_vrbo','vat_rate','vat_airbnb','vat_booking','vat_vrbo','property_type','bedrooms','bathrooms','max_guests','location','neighbourhood','wifi_network','wifi_password','access_code','checkin_instructions','checkout_instructions','supply_checklist','emergency_contact'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${values.length + 1}`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    await run(`UPDATE properties SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  }

  const updated = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  res.json(updated);
});

// --- Property Sharing ---

// GET /api/properties/:id/users — list users with access
router.get('/:id/users', async (req, res) => {
  try {
    const rows = await getAll(
      `SELECT up.user_id, up.role, u.name, u.email
       FROM user_properties up JOIN users u ON up.user_id = u.id
       WHERE up.property_id = $1 ORDER BY up.role ASC, u.name ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/:id/share — share property with a user
router.post('/:id/share', async (req, res) => {
  try {
    const propertyId = parseInt(req.params.id);
    const { user_id, role } = req.body;
    if (!user_id || !['manager', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'user_id and role (manager/viewer) required' });
    }

    // Only owner or admin can share
    const isOwner = req.propertyRoles && req.propertyRoles.get(propertyId) === 'owner';
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the property owner can share access' });
    }

    await run(
      `INSERT INTO user_properties (user_id, property_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, property_id) DO UPDATE SET role = EXCLUDED.role`,
      [user_id, propertyId, role]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/properties/:id/share/:userId — remove a user's access
router.delete('/:id/share/:userId', async (req, res) => {
  try {
    const propertyId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);

    // Cannot remove owner
    const existing = await getOne(
      'SELECT role FROM user_properties WHERE user_id = $1 AND property_id = $2',
      [userId, propertyId]
    );
    if (existing && existing.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove the property owner' });
    }

    // Only owner or admin can remove
    const isOwner = req.propertyRoles && req.propertyRoles.get(propertyId) === 'owner';
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the property owner can remove access' });
    }

    await run(
      'DELETE FROM user_properties WHERE user_id = $1 AND property_id = $2',
      [userId, propertyId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * A manager saying what the jobs cannot: it is clean, or it is not.
 *
 * The same kind of fact as a cleaner tapping Finished, so it feeds the
 * same calculation rather than sitting beside it as a competing status.
 */
router.post('/:id/mark-clean', requireRole('admin', 'property_manager'), async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const dirty = req.body && req.body.dirty;
  await run(
    dirty ?
    'UPDATE properties SET marked_dirty_at = NOW(), marked_clean_by = $2 WHERE id = $1' :
    'UPDATE properties SET marked_clean_at = NOW(), marked_dirty_at = NULL, marked_clean_by = $2 WHERE id = $1',
    [req.params.id, req.user ? req.user.name : null]
  );
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  res.json({ ok: true, marked_clean_at: property.marked_clean_at, marked_dirty_at: property.marked_dirty_at });
});

/**
 * Who the manager would rather send here, in order.
 *
 * Assignment walks this list. Everybody sits at 0 until somebody says
 * otherwise, which is the arbitrary order it had before.
 */
router.put('/:id/cleaner-order', requireRole('admin', 'property_manager'), async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const order = Array.isArray(req.body.cleaner_ids) ? req.body.cleaner_ids : null;
  if (!order) return res.status(400).json({ error: 'cleaner_ids must be an array' });

  await transaction(async (client) => {
    for (let i = 0; i < order.length; i++) {
      await client.query(
        'UPDATE cleaner_properties SET priority = $1 WHERE property_id = $2 AND cleaner_id = $3',
        [i, req.params.id, order[i]]
      );
    }
  });
  res.json({ ok: true });
});

/**
 * Take nights off sale, and put them back.
 *
 * Assignment used to do the first of these by itself when nobody could
 * clean — silently, and with no way to undo it: unblockDates() has
 * existed since the beginning and nothing ever recorded which reservation
 * to cancel. It now tells the manager instead, and this is what they
 * press.
 *
 * The Smoobu reservation id is kept, which is the whole difference
 * between a block you can lift and one you cannot.
 */
router.post('/:id/block', requireRole('admin', 'property_manager'), async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const { from, to, reason } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) {
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  }
  if (to < from) return res.status(400).json({ error: 'to is before from' });

  const property = await getOne('SELECT id, smoobu_id, name FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  let reservation = null;
  try {
    const apiKey = await getApiKeyForProperty(property.id);
    reservation = await smoobu.blockDates(
      property.smoobu_id, from, to, reason || 'No cleaner available', apiKey
    );
  } catch (err) {
    // Said plainly rather than half-done. A row written here without a
    // reservation behind it is a block that exists in this app and
    // nowhere a guest can see.
    return res.status(502).json({ error: `Smoobu refused the block: ${err.message}` });
  }

  const row = await getOne(
    `INSERT INTO blocked_dates (property_id, date, end_date, reason, smoobu_reservation_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [property.id, from, to, reason || 'No cleaner available',
     reservation && (reservation.id || (reservation.data && reservation.data.id)) || null]
  );

  await notify({
    event: 'property_blocked',
    title: `${property.name} is off sale from ${from} to ${to}`,
    body: reason || 'No cleaner available.',
    propertyId: property.id,
    link: '/calendar',
  });

  res.status(201).json(row);
});

router.delete('/:id/block/:blockId', requireRole('admin', 'property_manager'), async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const block = await getOne(
    'SELECT * FROM blocked_dates WHERE id = $1 AND property_id = $2',
    [req.params.blockId, req.params.id]
  );
  if (!block) return res.status(404).json({ error: 'Block not found' });

  // Blocks written before this feature have no reservation id — they
  // cannot be lifted from here, and saying so beats pretending.
  if (!block.smoobu_reservation_id) {
    return res.status(409).json({
      error: 'This block was made before the app recorded what to cancel. Remove it in Smoobu.',
    });
  }

  try {
    const apiKey = await getApiKeyForProperty(block.property_id);
    await smoobu.unblockDates(block.smoobu_reservation_id, apiKey);
  } catch (err) {
    return res.status(502).json({ error: `Smoobu refused: ${err.message}` });
  }

  await run('UPDATE blocked_dates SET released_at = NOW() WHERE id = $1', [block.id]);
  res.json({ released: true });
});

module.exports = router;
