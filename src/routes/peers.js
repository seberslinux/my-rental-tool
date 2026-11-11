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
              to_char(s.check_out, 'YYYY-MM-DD') AS check_out, s.nights, s.kind, s.detected_at
         FROM peer_stays s
        WHERE s.reversed_at IS NULL AND s.kind = 'booking' AND s.detected_at > NOW() - INTERVAL '14 days'
        ORDER BY s.detected_at DESC, s.check_in`
    );
    const lastRun = await getOne(
      `SELECT started_at, finished_at, listings_ok, listings_failed, stays_found, error
         FROM peer_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`
    );

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
        listings: mine,
        recent: recent.filter((r) => ids.has(r.listing_id)).map((r) => ({
          ...r,
          name: (mine.find((l) => l.id === r.listing_id) || {}).name,
        })),
      };
    });

    res.json({ properties: out, last_run: lastRun || null });
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

module.exports = router;
