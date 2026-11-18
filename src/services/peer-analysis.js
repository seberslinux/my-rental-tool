/**
 * What the competitors sold, added up: by the week it was found, by the
 * month and season the guests stay, and by competitor, with suggestions
 * drawn from the numbers.
 *
 * Only stays the peer check judged to be bookings count — host blocks and
 * ambiguous runs are left out, and a sale whose nights opened again is a
 * cancellation, not a sale. Our own listing is left out of the figures
 * too: it is compared against them, not counted among them.
 *
 * Money is an estimate and says so. A sale carries the price its nights
 * were last on sale for when the daily quotes covered them; otherwise the
 * listing's most recent quote stands in, and the stay is marked estimated.
 * A listing never quoted adds nights but no money.
 */

const { getAll } = require('../db/database');

const DAY = 86400000;
const toDay = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const mondayOf = (ymd) => {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(ymd, -((dow + 6) % 7));
};
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

/**
 * Seasons by the hemisphere the property is in: December is summer in
 * Cape Town and winter in Piemonte. Latitude from the property's location
 * when it has one; otherwise rand means south, anything else north.
 */
function hemisphere({ location, currency }) {
  const lat = Number(String(location || '').split(',')[0]);
  if (Number.isFinite(lat) && String(location || '').includes(',')) return lat < 0 ? 'south' : 'north';
  return currency === 'ZAR' ? 'south' : 'north';
}
function seasonOf(ymd, side) {
  const m = Number(ymd.slice(5, 7));
  const north = m === 12 || m <= 2 ? 'Winter' : m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Autumn';
  const flip = { Winter: 'Summer', Summer: 'Winter', Spring: 'Autumn', Autumn: 'Spring' };
  return side === 'south' ? flip[north] : north;
}
// The year a season belongs to, so a southern summer that crosses New Year
// is one season: Dec 2026 to Feb 2027 is "Summer 2026/27".
function seasonLabel(ymd, side) {
  const s = seasonOf(ymd, side);
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  const crossing = (side === 'south' && s === 'Summer') || (side === 'north' && s === 'Winter');
  if (!crossing) return `${s} ${y}`;
  const start = m === 12 ? y : y - 1;
  return `${s} ${start}/${String(start + 1).slice(2)}`;
}

/** One period's figures from the sales that fall in it. */
function summarise(sales) {
  const nights = sales.reduce((n, s) => n + s.nights, 0);
  const priced = sales.filter((s) => s.revenue != null);
  const revenue = priced.reduce((n, s) => n + s.revenue, 0);
  // Per night leaves a price leader out: one listing at several times the
  // market rate would decide the average alone. Its money still counts.
  const rated = priced.filter((s) => !s.leader);
  const ratedNights = rated.reduce((n, s) => n + s.nights, 0);
  const ratedRevenue = rated.reduce((n, s) => n + s.revenue, 0);
  const byListing = new Map();
  for (const s of sales) byListing.set(s.name, (byListing.get(s.name) || 0) + s.nights);
  const top = [...byListing.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    bookings: sales.length,
    nights,
    revenue: priced.length ? revenue : null,
    estimated: sales.some((s) => s.estimated) || priced.length < sales.length,
    avg_nightly: ratedNights ? Math.round(ratedRevenue / ratedNights) : null,
    median_lead_days: median(sales.map((s) => s.lead_days)),
    avg_stay: sales.length ? Math.round((nights / sales.length) * 10) / 10 : null,
    top_listing: top ? { name: top[0], nights: top[1] } : null,
  };
}

function groupBy(sales, keyOf) {
  const groups = new Map();
  for (const s of sales) {
    const k = keyOf(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return groups;
}

/**
 * What to do about it, in plain sentences. Each one rests on a number in
 * the analysis and names the dates it is about; none fires on too little
 * to go on.
 */
function suggestions({ sales, leaders = [], ownPrices = [], ownOpen = new Set(), today, money }) {
  const out = [];

  // 0. The price leader: the ceiling, and how far below it we sit.
  const ourAsk = median(ownPrices.filter((p) => p.open).map((p) => p.nightly));
  for (const l of leaders.filter((x) => x.bookings > 0 && x.avg_nightly)) {
    const times = ourAsk ? Math.round((l.avg_nightly / ourAsk) * 10) / 10 : null;
    out.push({
      kind: 'leader_price',
      text: `${l.name} sold ${l.nights} nights at about ${money(l.avg_nightly)} a night${l.revenue != null ? ` (${money(l.revenue)})` : ''}${times ? `, ${times}× your current asking price` : ''}. It is the price ceiling to aim at: compare what it offers with what you do.`,
    });
  }
  const recent = sales.filter((s) => s.found >= addDays(today, -7));

  // 1. Lead time: which of our nights are being decided right now.
  const lead = median(sales.map((s) => s.lead_days));
  if (sales.length >= 3 && lead != null) {
    const from = addDays(today, Math.max(0, lead - 7)), to = addDays(today, lead + 7);
    let open = 0, total = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) { total++; if (ownOpen.has(d)) open++; }
    out.push({
      kind: 'lead',
      text: `Competitors book a median ${lead} days ahead, so nights around ${fmt(addDays(today, lead))} are being decided now. You have ${open} of ${total} nights open from ${fmt(from)} to ${fmt(to)}.`,
    });
  }

  // 2. Weeks that are selling: peers sold there in the last seven days
  //    while we still have nights open.
  const hot = groupBy(recent.filter((s) => s.check_in >= today), (s) => mondayOf(s.check_in));
  const hotWeeks = [...hot.entries()]
    .map(([week, ss]) => ({ week, nights: ss.reduce((n, s) => n + s.nights, 0), count: ss.length }))
    .filter((w) => w.count >= 2 || w.nights >= 5)
    .sort((a, b) => b.nights - a.nights);
  for (const w of hotWeeks.slice(0, 2)) {
    let open = 0;
    for (let i = 0; i < 7; i++) if (ownOpen.has(addDays(w.week, i))) open++;
    if (!open) continue;
    out.push({
      kind: 'hot_week',
      text: `The week of ${fmt(w.week)} is selling: competitors sold ${w.nights} nights there in the last 7 days. You still have ${open} open — hold your price or raise it.`,
    });
  }

  // 3. Price: what peers sold at against what we ask for the same week.
  const sold = sales.filter((s) => s.nightly_sold != null && s.check_in >= today);
  const soldByWeek = groupBy(sold, (s) => mondayOf(s.check_in));
  for (const [week, ss] of soldByWeek) {
    const ours = ownPrices.find((p) => p.open && mondayOf(p.check_in) === week);
    if (!ours) continue;
    const theirs = median(ss.map((s) => s.nightly_sold));
    if (theirs >= ours.nightly * 1.1) {
      out.push({
        kind: 'price_up',
        text: `Competitors sold the week of ${fmt(week)} at about ${money(theirs)} a night; you ask ${money(ours.nightly)}. There is room to raise it.`,
      });
    } else if (ours.nightly >= theirs * 1.25) {
      out.push({
        kind: 'price_down',
        text: `You ask ${money(ours.nightly)} for the week of ${fmt(week)}; competitors sold it at about ${money(theirs)}. If your nights there do not move, come down.`,
      });
    }
  }

  // 4. Who is winning, so their listing is the one to study.
  const byListing = [...groupBy(sales, (s) => s.name).entries()]
    .map(([name, ss]) => ({ name, ...summarise(ss) }))
    .sort((a, b) => b.nights - a.nights);
  if (byListing.length && byListing[0].bookings >= 2) {
    const t = byListing[0];
    out.push({
      kind: 'leader',
      text: `${t.name} sells the most: ${t.bookings} bookings, ${t.nights} nights${t.revenue != null ? `, about ${money(t.revenue)}` : ''}${t.avg_nightly ? ` at ${money(t.avg_nightly)} a night` : ''}. It is the listing to study.`,
    });
  }
  return out;
}

function fmt(ymd) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const SIGNS = { ZAR: 'R', EUR: '€', USD: '$', GBP: '£' };
const moneyIn = (currency) => (n) =>
  `${SIGNS[currency] || `${currency} `}${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

/**
 * The whole analysis for every property in scope (`null` = all).
 */
async function bookingAnalysis({ scope = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const props = await getAll(
    `SELECT id, name, location, COALESCE(base_currency, 'ZAR') AS currency FROM properties
      WHERE ($1::int[] IS NULL OR id = ANY($1::int[]))
        AND EXISTS (SELECT 1 FROM peer_listings l WHERE l.property_id = properties.id AND l.active)
      ORDER BY name`,
    [scope]
  );
  if (!props.length) return [];

  const rows = await getAll(
    `SELECT s.id, s.listing_id, l.name, l.property_id, l.is_own, l.is_benchmark,
            to_char(s.check_in, 'YYYY-MM-DD') AS check_in, to_char(s.check_out, 'YYYY-MM-DD') AS check_out,
            s.nights, s.lead_days, s.nightly, to_char(s.detected_at, 'YYYY-MM-DD') AS found,
            est.nightly AS est_nightly
       FROM peer_stays s JOIN peer_listings l ON l.id = s.listing_id
       -- The listing's quote nearest in date to the stay, before the sale
       -- where there is one: the estimate for a sale nobody priced.
       LEFT JOIN LATERAL (
         SELECT h.nightly FROM peer_price_history h WHERE h.listing_id = s.listing_id
          ORDER BY (h.quoted_at > s.detected_at), abs(h.check_in - s.check_in), h.quoted_at DESC LIMIT 1
       ) est ON TRUE
      WHERE s.kind = 'booking' AND s.reversed_at IS NULL AND l.property_id = ANY($1::int[])
      ORDER BY s.detected_at, s.check_in`,
    [props.map((p) => p.id)]
  );
  // Each listing's latest asking price, to stand in where a sale's own
  // nights were never quoted.
  const latest = new Map((await getAll(
    `SELECT DISTINCT ON (listing_id) listing_id, nightly FROM peer_prices ORDER BY listing_id, quoted_at DESC, check_in`
  )).map((r) => [r.listing_id, r.nightly]));
  // Every listing's latest asking price with its property, to tell which
  // competitors are in a different price class altogether.
  const peerListingAsks = await getAll(
    `SELECT DISTINCT ON (p.listing_id) p.listing_id, l.property_id, l.is_own, p.nightly
       FROM peer_prices p JOIN peer_listings l ON l.id = p.listing_id
      ORDER BY p.listing_id, p.quoted_at DESC, p.check_in`
  );
  const ownPrices = await getAll(
    `SELECT l.property_id, to_char(p.check_in, 'YYYY-MM-DD') AS check_in, p.nightly,
            COALESCE(c.available, FALSE) AS open
       FROM peer_prices p JOIN peer_listings l ON l.id = p.listing_id AND l.is_own
       LEFT JOIN peer_calendar c ON c.listing_id = p.listing_id AND c.date = p.check_in
      WHERE p.check_in > $1::date`,
    [today]
  );
  // Our own sales, from Smoobu rather than read off Airbnb: every channel,
  // the price actually paid, the lead time as booked. Counted from the day
  // the watch began, so both sides cover the same weeks.
  const since = (await getAll(`SELECT to_char(MIN(started_at), 'YYYY-MM-DD') AS d FROM peer_runs`)).at(0)?.d || today;
  const ownRows = await getAll(
    `SELECT property_id, to_char(check_in::date, 'YYYY-MM-DD') AS check_in, to_char(check_out::date, 'YYYY-MM-DD') AS check_out,
            COALESCE(NULLIF(length_of_stay, 0), 1) AS nights, total_price, price_per_night, lead_time_days,
            substring(created_at, 1, 10) AS found, platform
       FROM bookings
      WHERE status = 'confirmed' AND COALESCE(platform, '') NOT ILIKE 'blocked%'
        AND property_id = ANY($1::int[]) AND substring(created_at, 1, 10) >= $2`,
    [props.map((p) => p.id), since]
  );
  const ownOpenRows = await getAll(
    `SELECT l.property_id, to_char(c.date, 'YYYY-MM-DD') AS date FROM peer_calendar c
       JOIN peer_listings l ON l.id = c.listing_id AND l.is_own
      WHERE c.available AND c.date >= $1::date AND c.date < $1::date + 120`,
    [today]
  );

  // Each listing's measured cleaning fee; the competitors' average where
  // one is not measured yet, nothing where none is.
  const { cleaningFees } = require('./peer-cleaning');
  const fees = await cleaningFees(props.map((p) => p.id));
  const propertyOf = new Map(rows.map((r) => [r.listing_id, r.property_id]));
  const cleaningFor = (listingId) => (fees.byListing.has(listingId) ? fees.byListing.get(listingId).fee
    : (fees.average.get(propertyOf.get(listingId)) || {}).average || 0);

  return props.map((p) => {
    const side = hemisphere(p);
    const money = moneyIn(p.currency);
    // A competitor asking more than twice the others' median is in another
    // market: its sales would swamp every average and every price
    // suggestion. It is named on its own and left out of the figures,
    // as the position chart does.
    const peerAsks = peerListingAsks.filter((r) => r.property_id === p.id && !r.is_own);
    const askMedian = median(peerAsks.map((r) => r.nightly));
    const outlierIds = new Set(askMedian ? peerAsks.filter((r) => r.nightly > askMedian * 2).map((r) => r.listing_id) : []);
    const all = rows.filter((r) => r.property_id === p.id && !r.is_own);
    // Kept out of the medians, but not out of sight: a listing selling at
    // several times the market rate is the ceiling to aim at. Its sales are
    // in every list and count, marked; only the per-night averages and
    // the price suggestions leave it out.
    const sales = all.map((r) => {
      const nightly = r.nightly != null ? r.nightly : r.est_nightly ?? latest.get(r.listing_id) ?? null;
      // A quote is a two-night stay all-in, so its nightly carries half a
      // cleaning fee. A sale is its nights without that, and the fee once.
      const cleaning = cleaningFor(r.listing_id);
      const revenue = nightly != null ? Math.max(0, nightly - cleaning / 2) * r.nights + cleaning : null;
      return {
        ...r,
        leader: outlierIds.has(r.listing_id),
        nightly_sold: r.nightly,
        nightly_used: revenue != null ? Math.round(revenue / r.nights) : null,
        estimated: r.nightly == null,
        revenue,
      };
    });
    const market = sales.filter((s) => !s.leader);
    const leaders = [...groupBy(sales.filter((s) => s.leader), (r) => r.name).entries()]
      .map(([name, ss]) => ({ name, asking: latest.get(ss[0].listing_id) ?? null, ...summarise(ss.map((x) => ({ ...x, leader: false }))) }));
    const own = ownRows.filter((r) => r.property_id === p.id).map((r) => ({
      name: 'You', own: true, check_in: r.check_in, check_out: r.check_out, nights: Number(r.nights),
      lead_days: r.lead_time_days, found: r.found, channel: r.platform,
      nightly_used: r.price_per_night ? Math.round(r.price_per_night) : null, estimated: false,
      revenue: r.total_price ? Math.round(r.total_price) : null,
    }));
    const line = (x) => ({
      name: x.name, own: Boolean(x.own), leader: Boolean(x.leader), channel: x.channel || null,
      check_in: x.check_in, check_out: x.check_out, nights: x.nights, lead_days: x.lead_days,
      nightly: x.nightly_used, estimated: x.estimated, revenue: x.revenue,
    });
    const period = (comp, mine) => ({ ...summarise(comp), you: summarise(mine) });

    const weekKeys = [...new Set([...sales, ...own].map((x) => mondayOf(x.found)))].sort().reverse();
    const weeks = weekKeys.map((week) => {
      const comp = sales.filter((x) => mondayOf(x.found) === week), mine = own.filter((x) => mondayOf(x.found) === week);
      return { week, ...period(comp, mine), sales: [...comp, ...mine].sort((a, b) => a.check_in.localeCompare(b.check_in)).map(line) };
    });
    const monthKeys = [...new Set([...sales, ...own].map((x) => x.check_in.slice(0, 7)))].sort();
    const months = monthKeys.map((month) => ({
      month, ...period(sales.filter((x) => x.check_in.slice(0, 7) === month), own.filter((x) => x.check_in.slice(0, 7) === month)),
    }));
    const seasonKeys = [...new Set([...sales, ...own].sort((a, b) => a.check_in.localeCompare(b.check_in)).map((x) => seasonLabel(x.check_in, side)))];
    const seasons = seasonKeys.map((season) => ({
      season, ...period(sales.filter((x) => seasonLabel(x.check_in, side) === season), own.filter((x) => seasonLabel(x.check_in, side) === season)),
    }));
    const listings = [
      ...[...groupBy(sales, (s) => s.name).entries()].map(([name, ss]) => ({
        name, is_benchmark: ss[0].is_benchmark, is_leader: ss[0].leader, is_own: false, ...summarise(ss.map((x) => ({ ...x, leader: false }))),
      })),
      ...(own.length ? [{ name: 'You', is_benchmark: false, is_leader: false, is_own: true, ...summarise(own) }] : []),
    ].sort((a, b) => b.nights - a.nights || (b.revenue || 0) - (a.revenue || 0));

    return {
      id: p.id,
      name: p.name,
      currency: p.currency,
      hemisphere: side,
      since: rows.length ? rows.at(0).found : null,
      total: summarise(sales),
      you: summarise(own),
      weeks,
      months,
      seasons,
      listings,
      leaders,
      suggestions: suggestions({
        leaders,
        sales: market,
        ownPrices: ownPrices.filter((r) => r.property_id === p.id),
        ownOpen: new Set(ownOpenRows.filter((r) => r.property_id === p.id).map((r) => r.date)),
        today,
        money,
      }),
    };
  });
}

/**
 * Monday morning: what the competitors sold last week, one message per
 * property that had any. A week with nothing sold sends nothing.
 */
async function weeklyDigest({ today = new Date().toISOString().slice(0, 10), notifyImpl } = {}) {
  const notify = notifyImpl || require('./notify').notify;
  const lastMonday = addDays(mondayOf(today), -7);
  const sent = [];
  for (const p of await bookingAnalysis({ today })) {
    const week = p.weeks.find((w) => w.week === lastMonday);
    if (!week) continue;
    const money = moneyIn(p.currency);
    const top = week.top_listing ? ` Top: ${week.top_listing.name} (${week.top_listing.nights} nights).` : '';
    const sold = week.revenue != null ? ` About ${money(week.revenue)} sold${week.estimated ? ' (estimated)' : ''}.` : '';
    const lead = week.median_lead_days != null ? ` Booked a median ${week.median_lead_days} days ahead.` : '';
    await notify({
      event: 'peer_weekly',
      title: `${p.name}: competitors sold ${week.bookings} booking${week.bookings === 1 ? '' : 's'}, ${week.nights} nights last week`,
      body: `${top}${sold}${lead}`.trim(),
      propertyId: p.id,
      link: '/peers',
    });
    sent.push(p.id);
  }
  return sent;
}

module.exports = { bookingAnalysis, weeklyDigest, suggestions, summarise, seasonLabel, hemisphere, mondayOf };
