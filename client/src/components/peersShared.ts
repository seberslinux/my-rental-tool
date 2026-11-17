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
