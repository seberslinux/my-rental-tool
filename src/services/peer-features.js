/**
 * What each listing offers, and what that is worth.
 *
 * Two halves. `snapshotListings` takes a weekly picture of every tracked
 * listing's public page — amenities, ratings, size — into
 * peer_listing_snapshots, where it stays for good. `featureAnalysis`
 * sets those pictures against how each competitor sells: for every
 * feature that matters to a guest, the price and the share of nights
 * taken for the listings that have it against those that do not, and
 * which of the ones that earn our own listing still lacks. That is the
 * renovation question answered from the market rather than from taste.
 *
 * The numbers are honest about their size: a feature with one listing on
 * either side is shown but never put on the shortlist.
 */

const { getAll, run } = require('../db/database');

/**
 * The features a guest chooses by, each matched against Airbnb's own
 * amenity wording ("Private outdoor pool - available all year" is a pool;
 * "Pool table" is not). Each is something you build, a policy you can
 * simply change, or a view — which no renovation adds, so a view is shown
 * but never on the shortlist.
 */
const FEATURES = [
  ['Pool', /\bpool\b(?!\s*table)/i, 'build'],
  ['Hot tub', /hot tub|jacuzzi/i, 'build'],
  ['Sea view', /\b(sea|ocean|bay|beach) view/i, 'view'],
  ['Mountain view', /mountain view/i, 'view'],
  ['Beachfront', /beachfront|beach access/i, 'view'],
  ['Fireplace', /fireplace/i, 'build'],
  ['Braai / BBQ', /bbq|barbecue|braai/i, 'build'],
  ['Outdoor shower', /outdoor shower/i, 'build'],
  ['Sauna', /sauna/i, 'build'],
  ['Fire pit', /fire pit/i, 'build'],
  ['Air conditioning', /air conditioning|\bac\b/i, 'build'],
  ['Dedicated workspace', /workspace/i, 'build'],
  ['Pets allowed', /pets allowed/i, 'policy'],
  ['Patio or balcony', /patio|balcony/i, 'build'],
  ['Garden or backyard', /garden|backyard/i, 'build'],
  ['Hammock', /hammock/i, 'build'],
  ['Dishwasher', /dishwasher/i, 'build'],
  ['Washing machine', /^washer\b|washing machine/i, 'build'],
  ['EV charger', /ev charger/i, 'build'],
  ['Self check-in', /self check-in/i, 'policy'],
];

const has = (amenities, re) => (amenities || []).some((a) => re.test(typeof a === 'string' ? a : a.title));
const median = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Picture every listing whose last snapshot is older than `maxAgeDays`.
 * Run daily, that is one picture a week each, spread over the days.
 */
async function snapshotListings({ fetchListing, maxAgeDays = 6, pauseMs = 1500 } = {}) {
  const read = fetchListing || require('./airbnb-listing').fetchListing;
  const due = await getAll(
    `SELECT l.id, l.airbnb_id, l.name FROM peer_listings l
      WHERE l.active AND NOT EXISTS (
        SELECT 1 FROM peer_listing_snapshots s
         WHERE s.listing_id = l.id AND s.taken_at > NOW() - make_interval(days => $1))
      ORDER BY l.is_own DESC, l.is_benchmark DESC, l.id`,
    [maxAgeDays]
  );
  let taken = 0;
  const failures = [];
  for (const l of due) {
    try {
      const d = await read(l.airbnb_id);
      await run(
        `INSERT INTO peer_listing_snapshots
           (listing_id, title, property_type, rating, reviews, guests, bedrooms, beds, baths,
            superhost, guest_favorite, photos, category_ratings, amenities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [l.id, d.title, d.property_type, d.rating, d.reviews, d.guests, d.bedrooms, d.beds, d.baths,
          d.superhost, d.guest_favorite, d.photos, JSON.stringify(d.category_ratings || {}), JSON.stringify(d.amenities || [])]
      );
      taken++;
    } catch (err) {
      failures.push(`${l.name}: ${err.message}`);
    }
    if (pauseMs) await sleep(pauseMs);
  }
  return { due: due.length, taken, failed: failures.length, error: failures.slice(0, 3).join(' · ') || null };
}

/**
 * Feature against performance, per property and its competitors.
 *
 * Performance per listing, all from the record: the share of the next 90
 * nights taken, the average asking price over the stays quoted in the
 * next five weeks, and the nights it has sold since tracking began. A
 * competitor priced at more than twice the others' median is kept out
 * of the comparison — it would decide every median alone — but shown,
 * with what it has that we lack, as the ceiling.
 */
async function featureAnalysis({ scope = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const listings = await getAll(
    `SELECT l.id, l.name, l.property_id, l.is_own, l.is_benchmark, p.name AS property,
            COALESCE(p.base_currency, 'ZAR') AS currency,
            snap.taken_at, snap.amenities, snap.rating, snap.reviews, snap.category_ratings,
            snap.bedrooms, snap.photos, snap.guest_favorite,
            (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE NOT c.available) / NULLIF(COUNT(*), 0))
               FROM peer_calendar c WHERE c.listing_id = l.id AND c.date >= $1::date AND c.date < $1::date + 90) AS occupancy,
            (SELECT ROUND(AVG(nightly)) FROM peer_prices pr
              WHERE pr.listing_id = l.id AND pr.check_in > $1::date AND pr.check_in <= $1::date + 35) AS price,
            (SELECT COALESCE(SUM(nights), 0) FROM peer_stays s
              WHERE s.listing_id = l.id AND s.kind = 'booking' AND s.reversed_at IS NULL) AS sold_nights
       FROM peer_listings l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN LATERAL (
         SELECT * FROM peer_listing_snapshots s WHERE s.listing_id = l.id ORDER BY taken_at DESC LIMIT 1
       ) snap ON TRUE
      WHERE l.active AND ($2::int[] IS NULL OR l.property_id = ANY($2::int[]))
      ORDER BY p.name, l.is_own DESC, l.name`,
    [today, scope]
  );

  const byProperty = new Map();
  for (const l of listings) {
    if (!byProperty.has(l.property_id)) byProperty.set(l.property_id, []);
    byProperty.get(l.property_id).push({
      ...l,
      occupancy: l.occupancy == null ? null : Number(l.occupancy),
      price: l.price == null ? null : Number(l.price),
      sold_nights: Number(l.sold_nights),
    });
  }

  const out = [];
  for (const [propertyId, ls] of byProperty) {
    const own = ls.find((l) => l.is_own) || null;
    const peers = ls.filter((l) => !l.is_own && l.amenities);
    const priceMedian = median(peers.map((l) => l.price));
    const leaders = peers.filter((l) => priceMedian && l.price > priceMedian * 2);
    const market = peers.filter((l) => !leaders.includes(l));

    const features = FEATURES.map(([name, re, kind]) => {
      const withF = market.filter((l) => has(l.amenities, re));
      const without = market.filter((l) => !has(l.amenities, re));
      const pw = median(withF.map((l) => l.price)), po = median(without.map((l) => l.price));
      const ow = median(withF.map((l) => l.occupancy)), oo = median(without.map((l) => l.occupancy));
      return {
        name,
        kind,
        you: own && own.amenities ? has(own.amenities, re) : null,
        with: withF.length,
        without: without.length,
        price_with: pw == null ? null : Math.round(pw),
        price_without: po == null ? null : Math.round(po),
        occupancy_with: ow == null ? null : Math.round(ow),
        occupancy_without: oo == null ? null : Math.round(oo),
        price_premium: pw && po ? Math.round((pw / po - 1) * 100) : null,
        occupancy_gap: ow != null && oo != null ? Math.round(ow - oo) : null,
        holders: [...withF, ...leaders.filter((l) => has(l.amenities, re))].map((l) => l.name),
      };
    }).filter((f) => f.with > 0 && f.without > 0);

    // Worth adding: we lack it, at least two competitors have it, and they
    // earn more for it in price, in nights taken, or both.
    const shortlist = features
      .filter((f) => f.kind !== 'view' && f.you === false && f.with >= 2 && ((f.price_premium || 0) > 0 || (f.occupancy_gap || 0) > 0))
      .map((f) => ({ ...f, score: (f.price_premium || 0) + (f.occupancy_gap || 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const lacks = (l) => FEATURES.filter(([, re]) => has(l.amenities, re) && own && own.amenities && !has(own.amenities, re)).map(([n]) => n);
    const benchmark = peers.find((l) => l.is_benchmark);
    const studied = [...(benchmark ? [benchmark] : []), ...leaders.filter((l) => l !== benchmark)];

    out.push({
      id: propertyId,
      name: ls[0].property,
      currency: ls[0].currency,
      snapshots: { taken: ls.filter((l) => l.amenities).length, of: ls.length, latest: ls.map((l) => l.taken_at).filter(Boolean).sort().at(-1) || null },
      you: own && own.amenities ? {
        rating: own.rating, reviews: own.reviews, category_ratings: own.category_ratings,
        photos: own.photos, features: FEATURES.filter(([, re]) => has(own.amenities, re)).map(([n]) => n),
      } : null,
      market_median: {
        rating: median(market.map((l) => l.rating)),
        photos: median(market.map((l) => l.photos)),
        value: median(market.map((l) => l.category_ratings && l.category_ratings.value)),
        cleanliness: median(market.map((l) => l.category_ratings && l.category_ratings.cleanliness)),
        accuracy: median(market.map((l) => l.category_ratings && l.category_ratings.accuracy)),
      },
      features,
      shortlist,
      leaders: studied.map((l) => ({
        name: l.name, is_benchmark: l.is_benchmark, price: l.price, occupancy: l.occupancy,
        rating: l.rating, reviews: l.reviews, has_and_you_lack: lacks(l),
      })),
    });
  }
  return out;
}

module.exports = { snapshotListings, featureAnalysis, FEATURES, has };
