/**
 * The competitor comparison.
 *
 * For each property: how much of each coming month every tracked
 * listing has sold, ours included and read the same way — a night is
 * sold when Airbnb no longer offers it. That counts host blocks as sold,
 * for us and for them alike, which is what the analysis does too.
 */

const express = require('express');
const router = express.Router();
const { getAll, getOne } = require('../db/database');
const { scopeProperties, requireRole } = require('../middleware/auth');

const MONTHS_AHEAD = 6;

function median(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * Occupancy against the competitors, in one line per property.
 *
 * The share of nights not open over the next 30 and 90 days, for our own
 * listing, the benchmark and the competitors' median — all read from
 * Airbnb the same way, so blocks count as taken for everybody. Home and
 * the top of the Competitors page both show this.
 */
const WINDOWS = [30, 90];

async function occupancySummary(scope, today) {
  const rows = await getAll(
    `SELECT l.id, l.name, l.property_id, l.is_own, l.is_benchmark, w.days,
            ROUND(100.0 * COUNT(*) FILTER (WHERE NOT c.available) / NULLIF(COUNT(*), 0))::int AS taken
       FROM peer_listings l
       CROSS JOIN unnest($2::int[]) AS w(days)
       JOIN peer_calendar c ON c.listing_id = l.id
        AND c.date >= $1::date AND c.date < $1::date + w.days
      WHERE l.active AND l.property_id IS NOT NULL
        AND ($3::int[] IS NULL OR l.property_id = ANY($3::int[]))
      GROUP BY l.id, w.days`,
    [today, WINDOWS, scope]
  );
  const props = await getAll(
    `SELECT id, name, COALESCE(base_currency, 'ZAR') AS currency, COALESCE(peer_guests, 2) AS guests FROM properties
      WHERE ($1::int[] IS NULL OR id = ANY($1::int[]))
        AND EXISTS (SELECT 1 FROM peer_listings l WHERE l.property_id = properties.id AND l.active)
      ORDER BY name`,
    [scope]
  );
  // The average asking price per night over the stays quoted in the next
  // five weeks: the price axis of the chart, one figure per listing.
  // The money on the books for the nights the chart counts as taken, the
  // bubble size. Competitors: each taken night at the listing's nearest
  // quote by date, so nights sold before the watch began count too.
  // Ours: what guests pay for those nights, from Smoobu.
  const days = WINDOWS[0];
  const booked = new Map((await getAll(
    `SELECT c.listing_id, SUM(est.nightly)::int AS revenue
       FROM peer_calendar c
       JOIN peer_listings l ON l.id = c.listing_id AND l.active AND NOT l.is_own
       CROSS JOIN LATERAL (
         SELECT h.nightly FROM peer_price_history h WHERE h.listing_id = c.listing_id
          ORDER BY abs(h.check_in - c.date), h.quoted_at DESC LIMIT 1
       ) est
      WHERE NOT c.available AND c.date >= $1::date AND c.date < $1::date + $2::int
      GROUP BY c.listing_id`,
    [today, days]
  )).map((r) => [r.listing_id, r.revenue]));
  const ownBooked = new Map((await getAll(
    `SELECT b.property_id,
            ROUND(SUM(b.total_price / GREATEST(substring(b.check_out, 1, 10)::date - substring(b.check_in, 1, 10)::date, 1)))::int AS revenue
       FROM bookings b
       CROSS JOIN LATERAL generate_series(substring(b.check_in, 1, 10)::date, substring(b.check_out, 1, 10)::date - 1, interval '1 day') n(d)
      WHERE b.status = 'confirmed' AND COALESCE(b.platform, '') NOT ILIKE 'blocked%'
        AND n.d >= $1::date AND n.d < $1::date + $2::int
      GROUP BY b.property_id`,
    [today, days]
  )).map((r) => [r.property_id, r.revenue]));
  const asking = new Map((await getAll(
    `SELECT listing_id, ROUND(AVG(nightly))::int AS price FROM peer_prices
      WHERE check_in > $1::date AND check_in <= $1::date + 35 GROUP BY listing_id`,
    [today]
  )).map((r) => [r.listing_id, r.price]));

  return props.map((p) => {
    const mine = rows.filter((r) => r.property_id === p.id);
    const benchmark = mine.find((r) => r.is_benchmark);
    const near = mine.filter((r) => r.days === WINDOWS[0]);
    // Price against occupancy, one point per listing. A listing with no
    // quote in the window — full, or not yet priced — has no price to
    // place it by, so it is left off rather than put at zero.
    const points = near
      .filter((r) => asking.has(r.id))
      .map((r) => ({
        name: r.name, occupancy: r.taken, price: asking.get(r.id), is_own: r.is_own, is_benchmark: r.is_benchmark,
        revenue: r.is_own ? ownBooked.get(p.id) || 0 : booked.get(r.id) || 0,
      }));
    const competitors = points.filter((x) => !x.is_own);
    return {
      id: p.id,
      name: p.name,
      currency: p.currency,
      benchmark_name: benchmark ? benchmark.name : null,
      revenue_days: days,
      points,
      median_price: median(competitors.map((x) => x.price)),
      windows: WINDOWS.map((days) => {
        const at = mine.filter((r) => r.days === days);
        const own = at.find((r) => r.is_own);
        const bench = at.find((r) => r.is_benchmark);
        return {
          days,
          own: own ? own.taken : null,
          benchmark: bench ? bench.taken : null,
          median: median(at.filter((r) => !r.is_own).map((r) => r.taken)),
        };
      }),
    };
  }).filter((p) => p.windows.some((w) => w.own != null || w.median != null));
}

router.get('/summary', scopeProperties, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lastRun = await getOne('SELECT finished_at FROM peer_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1');
    res.json({ properties: await occupancySummary(req.accessiblePropertyIds, today), read_at: lastRun ? lastRun.finished_at : null });
  } catch (err) {
    console.error('Peer summary failed:', err.message);
    res.status(500).json({ error: 'Could not load the competitor summary' });
  }
});

router.get('/', scopeProperties, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const scope = req.accessiblePropertyIds; // null = all
    const properties = await getAll(
      `SELECT id, name, COALESCE(base_currency, 'ZAR') AS currency, COALESCE(peer_guests, 2) AS guests,
              COALESCE(guest_markup_airbnb, 0) AS airbnb_markup FROM properties
        WHERE ($1::int[] IS NULL OR id = ANY($1::int[]))
          AND EXISTS (SELECT 1 FROM peer_listings l WHERE l.property_id = properties.id AND l.active)
        ORDER BY name`,
      [scope]
    );

    // Share of nights not open, per listing per month, from today on.
    const shares = await getAll(
      `SELECT l.id AS listing_id, to_char(c.date, 'YYYY-MM') AS month,
              ROUND(100.0 * COUNT(*) FILTER (WHERE NOT c.available) / COUNT(*))::int AS sold,
              COUNT(*) FILTER (WHERE c.available AND c.date < $1::date + 30)::int AS open_30
         FROM peer_listings l
         JOIN peer_calendar c ON c.listing_id = l.id
        WHERE l.active AND c.date >= $1::date
          AND c.date < date_trunc('month', $1::date) + make_interval(months => $2)
        GROUP BY l.id, month`,
      [today, MONTHS_AHEAD]
    );
    const months = [];
    for (let i = 0; i < MONTHS_AHEAD; i++) {
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      months.push(d.toISOString().slice(0, 7));
    }

    const listings = await getAll(
      `SELECT l.id, l.airbnb_id, l.name, l.bedrooms, l.property_id, l.is_own, l.is_benchmark
         FROM peer_listings l WHERE l.active ORDER BY l.is_own DESC, l.is_benchmark DESC, l.name`
    );
    const recent = await getAll(
      `SELECT s.id, s.listing_id, to_char(s.check_in, 'YYYY-MM-DD') AS check_in,
              to_char(s.check_out, 'YYYY-MM-DD') AS check_out, s.nights, s.kind, s.nightly, s.detected_at
         FROM peer_stays s
        WHERE s.reversed_at IS NULL AND s.kind = 'booking' AND s.detected_at > NOW() - INTERVAL '14 days'
        ORDER BY s.detected_at DESC, s.check_in`
    );
    const lastRun = await getOne(
      `SELECT started_at, finished_at, listings_ok, listings_failed, stays_found, error
         FROM peer_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`
    );

    // Latest asking price per planned stay, and whether its first night
    // is still for sale — a price for a night already gone is what it
    // sold at, not what it costs.
    const prices = await getAll(
      `SELECT p.listing_id, to_char(p.check_in, 'YYYY-MM-DD') AS check_in, p.kind, p.nightly,
              COALESCE(c.available, FALSE) AS open
         FROM peer_prices p
         LEFT JOIN peer_calendar c ON c.listing_id = p.listing_id AND c.date = p.check_in
        WHERE p.check_in > $1::date`,
      [today]
    );
    const stayDates = (kind) => [...new Set(prices.filter((r) => r.kind === kind).map((r) => r.check_in))].sort().slice(0, 8);
    const weekends = stayDates('weekend');
    const weekdays = stayDates('weekday');
    // Whether each priced date is still open, for listings never quoted on
    // it: no quote because the night was already gone is "sold", which is
    // not the same as "not read".
    const taken = new Set((await getAll(
      `SELECT listing_id, to_char(date, 'YYYY-MM-DD') AS date FROM peer_calendar
        WHERE NOT available AND date = ANY($1::date[])`,
      [[...weekends, ...weekdays]]
    )).map((r) => `${r.listing_id}:${r.date}`));
    const priceOf = (listingId, kind, date) => {
      const r = prices.find((x) => x.listing_id === listingId && x.kind === kind && x.check_in === date);
      if (r) return { nightly: r.nightly, open: r.open };
      return taken.has(`${listingId}:${date}`) ? { nightly: null, open: false } : null;
    };

    const { cleaningFees } = require('../services/peer-cleaning');
    const cleaningOf = await cleaningFees();
    const byListing = new Map();
    for (const s of shares) {
      if (!byListing.has(s.listing_id)) byListing.set(s.listing_id, {});
      byListing.get(s.listing_id)[s.month] = s;
    }

    const out = properties.map((p) => {
      const mine = listings.filter((l) => l.property_id === p.id).map((l) => {
        const m = byListing.get(l.id) || {};
        return {
          id: l.id,
          airbnb_id: l.airbnb_id,
          name: l.name,
          url: `https://www.airbnb.co.za/rooms/${l.airbnb_id}`,
          is_own: l.is_own,
          is_benchmark: l.is_benchmark,
          read: Boolean(byListing.get(l.id)),
          // The one-off cleaning fee as a guest pays it, measured weekly.
          cleaning_fee: cleaningOf.byListing.has(l.id) ? cleaningOf.byListing.get(l.id).fee : null,
          cleaning_measured_on: cleaningOf.byListing.has(l.id) ? cleaningOf.byListing.get(l.id).measured_on : null,
          months: months.map((mo) => (m[mo] ? m[mo].sold : null)),
          weekend: weekends.map((d) => priceOf(l.id, 'weekend', d)),
          weekday: weekdays.map((d) => priceOf(l.id, 'weekday', d)),
          // Nights still for sale in the next 30 days.
          open_30: byListing.has(l.id)
            ? Object.values(m).reduce((n, row) => n + row.open_30, 0)
            : null,
        };
      });
      const peers = mine.filter((l) => !l.is_own);
      const ids = new Set(mine.map((l) => l.id));
      return {
        id: p.id,
        name: p.name,
        currency: p.currency,
        guests: p.guests,
        months,
        own: mine.find((l) => l.is_own) || null,
        benchmark: mine.find((l) => l.is_benchmark) || null,
        peer_median: months.map((_, i) => median(peers.map((l) => l.months[i]))),
        // Asking prices only: a stay that has sold says nothing about
        // what a guest could book it for now.
        prices: {
          weekends,
          weekdays,
          weekend_median: weekends.map((_, i) => median(peers.map((l) => (l.weekend[i] && l.weekend[i].open ? l.weekend[i].nightly : null)))),
          weekday_median: weekdays.map((_, i) => median(peers.map((l) => (l.weekday[i] && l.weekday[i].open ? l.weekday[i].nightly : null)))),
        },
        cleaning: cleaningOf.average.get(p.id) || null,
        // The channel markup Smoobu adds to the base for Airbnb: base × (1 + markup)
        // is the nightly a guest sees, and ÷ (1 + markup) takes it back to the base.
        airbnb_markup: Number(p.airbnb_markup) || 0,
        listings: mine,
        recent: recent.filter((r) => ids.has(r.listing_id)).map((r) => ({
          ...r,
          name: (mine.find((l) => l.id === r.listing_id) || {}).name,
        })),
      };
    });

    res.json({ properties: out, summary: await occupancySummary(scope, today), last_run: lastRun || null });
  } catch (err) {
    console.error('Peers failed:', err.message);
    res.status(500).json({ error: 'Could not load the competitor comparison' });
  }
});

/**
 * What the competitors sold: by week found, by month and season of stay,
 * by competitor, with suggestions. See services/peer-analysis.
 */
router.get('/analysis', scopeProperties, async (req, res) => {
  try {
    const { bookingAnalysis } = require('../services/peer-analysis');
    res.json({ properties: await bookingAnalysis({ scope: req.accessiblePropertyIds }) });
  } catch (err) {
    console.error('Peer analysis failed:', err.message);
    res.status(500).json({ error: 'Could not load the competitor analysis' });
  }
});

/** What each feature is worth among the competitors, and what to add. */
router.get('/features', scopeProperties, async (req, res) => {
  try {
    const { featureAnalysis } = require('../services/peer-features');
    res.json({ properties: await featureAnalysis({ scope: req.accessiblePropertyIds }) });
  } catch (err) {
    console.error('Peer features failed:', err.message);
    res.status(500).json({ error: 'Could not load the feature analysis' });
  }
});

/** Take the listing snapshots that are due now, in the background. */
let snapping = false;
router.post('/snapshots', requireRole('admin'), (req, res) => {
  if (snapping) return res.status(409).json({ error: 'Listings are already being read' });
  snapping = true;
  const { snapshotListings } = require('../services/peer-features');
  snapshotListings()
    .then((r) => console.log(`Peer snapshots (by hand): ${r.taken} of ${r.due} taken, ${r.failed} failed.`))
    .catch((err) => console.error(`Peer snapshots (by hand) failed: ${err.message}`))
    .finally(() => { snapping = false; });
  res.status(202).json({ started: true });
});

let cleaning = false;
router.post('/cleaning', requireRole('admin'), (req, res) => {
  if (cleaning) return res.status(409).json({ error: 'Cleaning fees are already being measured' });
  cleaning = true;
  const { measureCleaningFees } = require('../services/peer-cleaning');
  measureCleaningFees({ maxAgeDays: 0 })
    .then((r) => console.log(`Cleaning fees (by hand): ${r.measured} of ${r.due} measured.`))
    .catch((err) => console.error(`Cleaning fees (by hand) failed: ${err.message}`))
    .finally(() => { cleaning = false; });
  res.status(202).json({ started: true });
});

/**
 * The record, as CSV, for analysis outside the app.
 *
 * Admin only and whole tables: this is the database the watch builds up,
 * and owning it means being able to take it anywhere.
 */
const EXPORTS = {
  cleaning: `SELECT f.id, l.name AS listing, p.name AS property, l.is_own, f.measured_at, f.check_in, f.nights,
                    f.total_first, f.total_second, f.total_both, f.fee, f.note
               FROM peer_cleaning_fees f JOIN peer_listings l ON l.id = f.listing_id
               LEFT JOIN properties p ON p.id = l.property_id ORDER BY f.measured_at, l.id`,
  listings: `SELECT l.id, l.airbnb_id, l.name, p.name AS property, l.is_own, l.is_benchmark, l.active, l.created_at
               FROM peer_listings l LEFT JOIN properties p ON p.id = l.property_id ORDER BY l.id`,
  // A sale is priced only when its nights were quoted before they went.
  // Otherwise the estimate is the listing's quote nearest in date to the
  // stay, taken before the sale where there is one; price_source says which.
  bookings: `SELECT s.id, p.name AS property, l.airbnb_id, l.name, l.is_own, s.check_in, s.check_out, s.nights,
                    s.kind, s.lead_days, s.nightly AS nightly_quoted,
                    CASE WHEN s.nightly IS NULL AND s.kind = 'booking' THEN est.nightly END AS nightly_estimate,
                    CASE WHEN s.nightly IS NOT NULL THEN 'quoted'
                         WHEN s.kind = 'booking' AND est.nightly IS NOT NULL THEN 'estimated'
                         WHEN s.kind = 'booking' THEN 'never quoted'
                         ELSE 'not a sale' END AS price_source,
                    s.detected_at, s.reversed_at
               FROM peer_stays s
               JOIN peer_listings l ON l.id = s.listing_id
               LEFT JOIN properties p ON p.id = l.property_id
               LEFT JOIN LATERAL (
                 SELECT h.nightly FROM peer_price_history h WHERE h.listing_id = s.listing_id
                  ORDER BY (h.quoted_at > s.detected_at), abs(h.check_in - s.check_in), h.quoted_at DESC LIMIT 1
               ) est ON TRUE
              ORDER BY s.detected_at, s.id`,
  prices: `SELECT h.id, l.airbnb_id, l.name, h.check_in, h.nights, h.kind, h.guests, h.currency, h.nightly, h.total, h.quoted_at
             FROM peer_price_history h JOIN peer_listings l ON l.id = h.listing_id ORDER BY h.quoted_at, h.id`,
  calendar: `SELECT c.id, l.airbnb_id, l.name, c.date, c.available, c.min_nights, c.baseline, c.seen_at
               FROM peer_calendar_changes c JOIN peer_listings l ON l.id = c.listing_id ORDER BY c.seen_at, c.id`,
  snapshots: `SELECT s.id, l.airbnb_id, l.name, s.taken_at, s.title, s.property_type, s.rating, s.reviews, s.guests,
                     s.bedrooms, s.beds, s.baths, s.superhost, s.guest_favorite, s.photos, s.category_ratings, s.amenities
                FROM peer_listing_snapshots s JOIN peer_listings l ON l.id = s.listing_id ORDER BY s.taken_at, s.id`,
  runs: `SELECT * FROM peer_runs ORDER BY id`,
};

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

router.get('/export/:table', requireRole('admin'), async (req, res) => {
  const sql = EXPORTS[req.params.table];
  if (!sql) return res.status(404).json({ error: `No table "${req.params.table}". Try: ${Object.keys(EXPORTS).join(', ')}` });
  try {
    const rows = await getAll(sql);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="competitors-${req.params.table}-${day}.csv"`);
    res.send(toCsv(rows));
  } catch (err) {
    console.error('Peer export failed:', err.message);
    res.status(500).json({ error: 'Could not export' });
  }
});

/** Run it now rather than waiting for the next scheduled read. */
router.post('/run', requireRole('admin'), async (req, res) => {
  try {
    const { runPeerCheck, runPeerPrices } = require('../services/peer-check');
    const { ok, failed, found } = await runPeerCheck();
    // Prices follow in the background, as on the schedule.
    runPeerPrices()
      .then((p) => console.log(`Peer prices (with a read by hand): ${p.quoted} of ${p.planned} quoted.`))
      .catch((err) => console.error(`Peer prices after a read failed: ${err.message}`));
    res.json({ ok, failed, stays: found.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Quote prices now. A few hundred requests a second apart take several
 * minutes, so this answers at once and the work carries on behind it.
 */
let pricing = false;
router.post('/prices', requireRole('admin'), (req, res) => {
  if (pricing) return res.status(409).json({ error: 'Prices are already being read' });
  pricing = true;
  const { runPeerPrices } = require('../services/peer-check');
  runPeerPrices()
    .then((r) => console.log(`Peer prices (by hand): ${r.quoted} quoted, ${r.failed} failed.`))
    .catch((err) => console.error(`Peer prices (by hand) failed: ${err.message}`))
    .finally(() => { pricing = false; });
  res.status(202).json({ started: true });
});

module.exports = router;
