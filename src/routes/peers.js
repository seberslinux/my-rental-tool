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
    `SELECT id, name FROM properties
      WHERE ($1::int[] IS NULL OR id = ANY($1::int[]))
        AND EXISTS (SELECT 1 FROM peer_listings l WHERE l.property_id = properties.id AND l.active)
      ORDER BY name`,
    [scope]
  );
  // The average asking price per night over the stays quoted in the next
  // five weeks: the price axis of the chart, one figure per listing.
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
      .map((r) => ({ name: r.name, occupancy: r.taken, price: asking.get(r.id), is_own: r.is_own, is_benchmark: r.is_benchmark }));
    const competitors = points.filter((x) => !x.is_own);
    return {
      id: p.id,
      name: p.name,
      benchmark_name: benchmark ? benchmark.name : null,
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
      `SELECT id, name FROM properties
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

/** Run it now rather than waiting for the next scheduled read. */
router.post('/run', requireRole('admin'), async (req, res) => {
  try {
    const { runPeerCheck } = require('../services/peer-check');
    const { ok, failed, found } = await runPeerCheck();
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
