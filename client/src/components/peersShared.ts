import type { Analysis, ListingRow } from './PeerAnalysis';

/**
 * The Competitors page's data, and the one row per listing that both the
 * page and its PDF show — so the two can never disagree.
 */

export interface Quote { nightly: number; open: boolean; }
export interface Listing {
  id: number; name: string; url: string; is_own: boolean; is_benchmark: boolean;
  read: boolean; months: (number | null)[]; open_30: number | null;
  weekend: (Quote | null)[]; weekday: (Quote | null)[];
  cleaning_fee?: number | null; cleaning_measured_on?: string | null;
}
export interface Sale { id: number; name: string; check_in: string; check_out: string; nights: number; nightly: number | null; detected_at: string; }
export interface Prices {
  weekends: string[]; weekdays: string[];
  weekend_median: (number | null)[]; weekday_median: (number | null)[];
}
export interface PropertyPeers {
  id: number; name: string; currency?: string; guests?: number; months: string[];
  own: Listing | null; benchmark: Listing | null; peer_median: (number | null)[];
  prices: Prices; listings: Listing[]; recent: Sale[];
  cleaning?: { average: number; measured: number; without: number } | null;
  airbnb_fee?: number; airbnb_fee_measured?: boolean;
}
export interface Run { finished_at: string; listings_ok: number; listings_failed: number; error: string | null; }

/** The first stay still for sale among those quoted, and its price. */
export function nextAsk(quotes: (Quote | null)[] | undefined, dates: string[] | undefined) {
  const i = (quotes || []).findIndex((q) => q && q.open && q.nightly);
  return i < 0 || !dates ? null : { date: dates[i], nightly: (quotes as Quote[])[i].nightly };
}

export interface CompetitorRow {
  l: Listing; s: ListingRow | undefined; taken: number | null;
  ask: { date: string; nightly: number } | null; leader: boolean;
}

/**
 * Every listing compared: nights taken in the next 30 days, what it asks
 * for the next free weekend, and what it has sold since the watch began.
 * Ours sells from Smoobu, all channels. Most nights sold first.
 */
export function competitorRows(p: PropertyPeers, a: Analysis | undefined): CompetitorRow[] {
  const sold = new Map<string, ListingRow>((a?.listings || []).map((l) => [l.is_own ? '__own' : l.name, l]));
  const leaders = new Set((a?.leaders || []).map((l) => l.name));
  return p.listings.map((l) => {
    const s = sold.get(l.is_own ? '__own' : l.name);
    return {
      l, s,
      taken: l.open_30 == null ? null : Math.round(100 * (30 - l.open_30) / 30),
      ask: nextAsk(l.weekend, p.prices?.weekends),
      leader: Boolean(s?.is_leader) || leaders.has(l.name),
    };
  }).sort((x, y) => (y.s?.nights || 0) - (x.s?.nights || 0) || (y.taken ?? -1) - (x.taken ?? -1));
}

/** The one-off cleaning fee: "R900", "none", or "–" when not yet measured. */
export const cleaningText = (fee: number | null | undefined, money: (n: number) => string) =>
  fee == null ? '–' : fee === 0 ? 'none' : money(fee);

/** "Competitors' cleaning fee: average R620 over 14 measured (3 charge none); yours R900." */
export function cleaningSummary(p: PropertyPeers, money: (n: number) => string) {
  const ours = p.listings.find((l) => l.is_own)?.cleaning_fee;
  if (!p.cleaning) return null;
  return `Competitors' cleaning fee: average ${money(p.cleaning.average)} over ${p.cleaning.measured} measured` +
    `${p.cleaning.without ? ` (${p.cleaning.without} charge none)` : ''}${ours != null ? `; yours ${cleaningText(ours, money)}` : ''}.`;
}

/** "12 days", or "same day". */
export const daysAhead = (n: number | null | undefined) =>
  n == null ? '–' : n === 0 ? 'same day' : `${n} day${n === 1 ? '' : 's'}`;

/**
 * A two-night stay taken apart, as Airbnb charges it:
 *
 *   total = 2 × nightly + cleaning & stay fees + 2 × Airbnb fees a night
 *
 * The total is the all-in quote. The cleaning and stay fees (cleaning,
 * linen and the like, once per stay) are measured per listing. Airbnb's
 * share is what it kept of our own Airbnb bookings, applied to the
 * nights; what is left is the nightly price without any fees — the
 * number that compares.
 */
export interface Breakdown { nightly: number; cleaning: number; fees: number; total: number; cleaningMeasured: boolean; }
export const STAY = 2;

export function breakdown(allInNightly: number, cleaning: number | null | undefined, share: number, fallbackCleaning = 0): Breakdown {
  const total = allInNightly * STAY;
  const measured = cleaning != null;
  const c = Math.min(measured ? cleaning as number : fallbackCleaning, total);
  const fees = (share * (total - c)) / STAY;
  return { nightly: (total - c) / STAY - fees, cleaning: c, fees, total, cleaningMeasured: measured };
}

export interface StayRow { l: Listing; b: Breakdown | null; booked: boolean; leader: boolean; }

/** The stay dates on offer: every quoted Friday and Monday, in date order. */
export function stayDates(p: PropertyPeers) {
  return [
    ...(p.prices?.weekends || []).map((date, i) => ({ date, kind: 'weekend' as const, i })),
    ...(p.prices?.weekdays || []).map((date, i) => ({ date, kind: 'weekday' as const, i })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** The first weekend at least half the listings still have open. */
export function defaultStay(p: PropertyPeers) {
  const dates = stayDates(p).filter((d) => d.kind === 'weekend');
  const open = (d: { i: number }) => p.listings.filter((l) => l.weekend?.[d.i]?.open).length;
  return dates.find((d) => open(d) >= p.listings.length / 2) || dates[0] || stayDates(p)[0] || null;
}

/** Every listing's two-night stay on one date, cheapest total first, with the competitors' median. */
export function stayTable(p: PropertyPeers, a: Analysis | undefined, stay: { kind: 'weekend' | 'weekday'; i: number }) {
  const share = p.airbnb_fee ?? 0.155;
  const leaders = new Set((a?.leaders || []).map((l) => l.name));
  const rows: StayRow[] = p.listings.map((l) => {
    const q = (stay.kind === 'weekend' ? l.weekend : l.weekday)?.[stay.i] || null;
    const leader = leaders.has(l.name);
    if (!q) return { l, b: null, booked: false, leader };
    if (!q.open || !q.nightly) return { l, b: null, booked: true, leader };
    return { l, b: breakdown(q.nightly, l.cleaning_fee, share, p.cleaning?.average ?? 0), booked: false, leader };
  }).sort((x, y) => (x.b ? x.b.total : Infinity) - (y.b ? y.b.total : Infinity) || Number(y.booked) - Number(x.booked));
  const peers = rows.filter((r) => r.b && !r.l.is_own && !r.leader).map((r) => r.b as Breakdown);
  const med = (xs: number[]) => {
    const v = [...xs].sort((m, n) => m - n);
    if (!v.length) return null;
    const k = Math.floor(v.length / 2);
    return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
  };
  const median = peers.length ? {
    nightly: med(peers.map((b) => b.nightly)) as number,
    cleaning: med(peers.map((b) => b.cleaning)) as number,
    fees: med(peers.map((b) => b.fees)) as number,
    total: med(peers.map((b) => b.total)) as number,
  } : null;
  return { rows, median, share };
}

/** A listing's nightly price without fees or cleaning for one quote, or null. */
export function nightlyNoFees(p: PropertyPeers, l: Listing, q: Quote | null | undefined) {
  if (!q || !q.open || !q.nightly) return null;
  return breakdown(q.nightly, l.cleaning_fee, p.airbnb_fee ?? 0.155, p.cleaning?.average ?? 0).nightly;
}

/** Rows for a price table: you, the benchmark and the competitors' median, nightly without fees. */
export function nightlyRows(p: PropertyPeers, a: Analysis | undefined, kind: 'weekend' | 'weekday') {
  const dates = kind === 'weekend' ? p.prices.weekends : p.prices.weekdays;
  const quotes = (l: { weekend: (Quote | null)[]; weekday: (Quote | null)[] }) => (kind === 'weekend' ? l.weekend : l.weekday) || [];
  const value = (l: Listing, i: number): number | 'sold' | null => {
    const q = quotes(l)[i];
    if (!q) return null;
    return q.open ? nightlyNoFees(p, l, q) : 'sold';
  };
  const leaders = new Set((a?.leaders || []).map((x) => x.name));
  const peers = p.listings.filter((l) => !l.is_own && !leaders.has(l.name));
  const median = dates.map((_, i) => {
    const v = peers.map((l) => value(l, i)).filter((x): x is number => typeof x === 'number').sort((m, n) => m - n);
    if (!v.length) return null;
    const k = Math.floor(v.length / 2);
    return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
  });
  const rows: { name: string; mine?: boolean; values: (number | 'sold' | null)[] }[] = [];
  if (p.own) rows.push({ name: 'You', mine: true, values: dates.map((_, i) => value(p.own as Listing, i)) });
  if (p.benchmark) rows.push({ name: p.benchmark.name, values: dates.map((_, i) => value(p.benchmark as Listing, i)) });
  rows.push({ name: 'Others (median)', values: median });
  return { dates, rows };
}

