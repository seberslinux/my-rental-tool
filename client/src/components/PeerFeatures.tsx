import React, { useState } from 'react';
import { Check, Download, Hammer, Minus } from 'lucide-react';

/**
 * What a renovation should aim at, read from the market.
 *
 * For each feature a guest chooses by: the competitors that have it
 * against those that do not — asking price and nights taken — and
 * whether we have it. On top, the short list of what is worth adding and
 * what the benchmark and the price leader have that we do not. Below,
 * the record itself, downloadable.
 */

interface Feature {
  name: string; kind: 'build' | 'policy' | 'view'; you: boolean | null; with: number; without: number;
  price_with: number | null; price_without: number | null;
  occupancy_with: number | null; occupancy_without: number | null;
  price_premium: number | null; occupancy_gap: number | null; holders: string[];
}
interface Leader { name: string; is_benchmark: boolean; price: number | null; occupancy: number | null; rating: number | null; reviews: number | null; has_and_you_lack: string[]; }
export interface FeatureProps {
  id: number; name: string; currency: string;
  snapshots: { taken: number; of: number; latest: string | null };
  you: { rating: number | null; reviews: number | null; category_ratings: Record<string, number> | null; photos: number | null; features: string[] } | null;
  market_median: { rating: number | null; photos: number | null; value: number | null; cleanliness: number | null; accuracy: number | null };
  features: Feature[]; shortlist: Feature[]; leaders: Leader[];
}

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const label = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';
const SIGNS: Record<string, string> = { ZAR: 'R', EUR: '€', USD: '$', GBP: '£' };
const money = (n: number | null, c: string) =>
  n == null ? '–' : `${SIGNS[c] || `${c} `}${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n)}%`);
const signed = (n: number | null, unit: string) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n}${unit}`);

function why(f: Feature, c: string) {
  const bits: string[] = [];
  if (f.price_premium) bits.push(`they ask ${f.price_premium > 0 ? `${f.price_premium}% more` : `${-f.price_premium}% less`} (${money(f.price_with, c)} against ${money(f.price_without, c)})`);
  if (f.occupancy_gap) bits.push(`${f.occupancy_gap > 0 ? `${f.occupancy_gap} pts fuller` : `${-f.occupancy_gap} pts emptier`} over the next 90 days`);
  return `${f.with} of ${f.with + f.without} competitors have it; ${bits.join(' and ')}.`;
}

function Ratings({ p }: { p: FeatureProps }) {
  if (!p.you || !p.you.category_ratings) return null;
  const rows: [string, number | null | undefined, number | null][] = [
    ['Overall', p.you.rating, p.market_median.rating],
    ['Value', p.you.category_ratings.value, p.market_median.value],
    ['Cleanliness', p.you.category_ratings.cleanliness, p.market_median.cleanliness],
    ['Accuracy', p.you.category_ratings.accuracy, p.market_median.accuracy],
    ['Photos', p.you.photos, p.market_median.photos],
  ];
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-[13px]">
        <thead><tr className="text-[12px] text-[#717171]">
          <th className="font-medium px-3 py-2 text-left">Score</th>
          <th className="font-medium px-3 py-2 text-right">You</th>
          <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Competitors (median)</th>
        </tr></thead>
        <tbody>
          {rows.map(([n, you, them]) => {
            const behind = you != null && them != null && you < them;
            return (
              <tr key={n} className="border-t border-[#F0F0F0]">
                <td className="px-3 py-2">{n}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${behind ? 'text-[#C13515] font-semibold' : ''}`}>{you ?? '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{them == null ? '–' : Math.round(them * 100) / 100}</td>
              </tr>);
          })}
        </tbody>
      </table>
    </div>);
}

export function FeaturesBlock({ p, isAdmin }: { p: FeatureProps; isAdmin: boolean }) {
  const [busy, setBusy] = useState('');
  const readNow = async () => {
    const r = await fetch('/api/peers/snapshots', { method: 'POST', credentials: 'same-origin' });
    setBusy(r.ok ? 'Reading listing details in the background — a few minutes. Reload to see them.' : 'Already reading.');
  };
  if (!p.snapshots.taken) {
    return (
      <section className="space-y-2">
        <h3 className="text-[16px] font-semibold text-[#222222]">What features earn</h3>
        <p className="text-[13px] text-[#717171]">The listings' details are read once a week. None read yet.</p>
        {isAdmin && <button data-no-export onClick={readNow} className="px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold">Read listing details now</button>}
        {busy && <p className="text-[13px] text-[#717171]">{busy}</p>}
      </section>);
  }
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[16px] font-semibold text-[#222222]">What features earn</h3>
        <p className="text-[13px] text-[#717171]">
          From {p.snapshots.taken} of {p.snapshots.of} listings' Airbnb pages, against how each sells. Small groups: read it as a direction, not a law.
        </p>
      </div>

      {p.shortlist.length > 0 &&
      <div>
          <div className={label}>Worth adding</div>
          <div className={`${card} divide-y divide-[#F0F0F0]`}>
            {p.shortlist.map((f) =>
          <div key={f.name} className="px-4 py-3 flex gap-3">
                <Hammer className="w-4 h-4 text-[#C9A227] shrink-0 mt-0.5" />
                <div>
                  <div className="text-[14px] font-semibold text-[#222222]">{f.name}{f.kind === 'policy' && <span className="ml-2 text-[11px] font-semibold text-[#0F6E56]">NO BUILDING NEEDED</span>}</div>
                  <div className="text-[13px] text-[#717171]">{why(f, p.currency)}</div>
                </div>
              </div>
          )}
          </div>
        </div>
      }

      {p.leaders.length > 0 &&
      <div>
          <div className={label}>What the leaders have that you don't</div>
          <div className={`${card} divide-y divide-[#F0F0F0]`}>
            {p.leaders.map((l) =>
          <div key={l.name} className="px-4 py-3">
                <div className="text-[14px] font-semibold text-[#222222]">
                  {l.name}{l.is_benchmark && <span className="ml-2 text-[11px] font-semibold text-[#FF385C]">BENCHMARK</span>}
                </div>
                <div className="text-[13px] text-[#717171]">
                  {money(l.price, p.currency)} a night · {pct(l.occupancy)} of the next 90 days taken · {l.rating ?? '–'} from {l.reviews ?? '–'} reviews
                </div>
                <div className="text-[13px] text-[#222222] mt-1">
                  {l.has_and_you_lack.length ? l.has_and_you_lack.join(' · ') : 'Nothing on the feature list that you lack: the gap is elsewhere (design, photos, reviews).'}
                </div>
              </div>
          )}
          </div>
        </div>
      }

      <div>
        <div className={label}>Your scores against theirs</div>
        <Ratings p={p} />
      </div>

      <div>
        <div className={label}>Every feature</div>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]">
            <thead><tr className="text-[12px] text-[#717171]">
              <th className="font-medium px-3 py-2 text-left">Feature</th>
              <th className="font-medium px-3 py-2 text-center">You</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Have it</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Price with / without</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Taken with / without</th>
            </tr></thead>
            <tbody>
              {p.features.map((f) =>
              <tr key={f.name} className="border-t border-[#F0F0F0]">
                  <td className="px-3 py-2 whitespace-nowrap">{f.name}{f.kind === 'view' && <span className="text-[#B0B0B0]"> (view)</span>}</td>
                  <td className="px-3 py-2 text-center">{f.you ? <Check className="w-4 h-4 text-[#0F6E56] inline" /> : <Minus className="w-4 h-4 text-[#B0B0B0] inline" />}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.with} of {f.with + f.without}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(f.price_with, p.currency)} / {money(f.price_without, p.currency)} <span className="text-[#717171]">({signed(f.price_premium, '%')})</span></td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{pct(f.occupancy_with)} / {pct(f.occupancy_without)} <span className="text-[#717171]">({signed(f.occupancy_gap, ' pts')})</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>);
}

/** Everything the watch has gathered, as CSV. For us, not for a saved copy. */
export function RecordDownloads() {
  return (
    <section data-no-export>
      <div className={label}>The record</div>
      <div className={`${card} px-4 py-3`}>
        <p className="text-[13px] text-[#717171] mb-2">Everything the watch has gathered, kept for good. Download as CSV:</p>
        <div className="flex flex-wrap gap-2">
          {[['bookings', 'Bookings'], ['prices', 'Price history'], ['calendar', 'Calendar changes'], ['snapshots', 'Listing snapshots'], ['listings', 'Listings'], ['runs', 'Reads']].map(([t, n]) =>
          <a key={t} href={`/api/peers/export/${t}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] text-[13px] font-semibold text-[#222222]">
              <Download className="w-3.5 h-3.5" />{n}
            </a>
          )}
        </div>
      </div>
    </section>);
}
