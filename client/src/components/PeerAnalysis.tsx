import React, { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { apiGet } from '../data/session';

/**
 * What the competitors sold, added up.
 *
 * By the week a sale was found (what happened this week), by the month
 * and season the guests stay (where the demand is), and by competitor
 * (who is winning) — with the suggestions the numbers point to on top,
 * because those are what someone acts on. Money is an estimate wherever
 * a sale's own nights were never quoted, and the table says so.
 */

interface Period {
  bookings: number; nights: number; revenue: number | null; estimated: boolean;
  avg_nightly: number | null; median_lead_days: number | null; avg_stay: number | null;
  top_listing: { name: string; nights: number } | null;
}
interface Sale { name: string; check_in: string; check_out: string; nights: number; lead_days: number | null; nightly: number | null; estimated: boolean; revenue: number | null; }
interface Week extends Period { week: string; sales: Sale[]; }
interface Month extends Period { month: string; }
interface Season extends Period { season: string; }
interface ListingRow extends Period { name: string; is_benchmark: boolean; }
interface Analysis {
  id: number; name: string; currency: string; since: string | null; total: Period;
  weeks: Week[]; months: Month[]; seasons: Season[]; listings: ListingRow[];
  leaders: (ListingRow & { asking: number | null })[];
  suggestions: { kind: string; text: string }[];
}

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const label = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';
const SIGNS: Record<string, string> = { ZAR: 'R', EUR: '€', USD: '$', GBP: '£' };
const money = (n: number | null, c: string) =>
  n == null ? '–' : `${SIGNS[c] || `${c} `}${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });

type View = 'week' | 'month' | 'season';

function PeriodTable({ a, view }: { a: Analysis; view: View }) {
  const rows: { key: string; label: string; p: Period }[] =
  view === 'week' ? a.weeks.map((w) => ({ key: w.week, label: `Week of ${day(w.week)}`, p: w })) :
  view === 'month' ? a.months.map((m) => ({ key: m.month, label: monthName(m.month), p: m })) :
  a.seasons.map((s) => ({ key: s.season, label: s.season, p: s }));
  const th = 'font-medium px-3 py-2 text-right whitespace-nowrap';
  const td = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[12px] text-[#717171]">
            <th className="font-medium px-3 py-2 text-left whitespace-nowrap">{view === 'week' ? 'Found in' : 'Guests stay in'}</th>
            <th className={th}>Bookings</th><th className={th}>Nights</th><th className={th}>Sold for</th>
            <th className={th}>Per night</th><th className={th}>Booked ahead</th>
            <th className="font-medium px-3 py-2 text-left whitespace-nowrap">Top seller</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
          <tr key={r.key} className="border-t border-[#F0F0F0]">
              <td className="px-3 py-2 whitespace-nowrap">{r.label}</td>
              <td className={td}>{r.p.bookings}</td>
              <td className={td}>{r.p.nights}</td>
              <td className={td}>{money(r.p.revenue, a.currency)}{r.p.estimated && r.p.revenue != null ? '*' : ''}</td>
              <td className={td}>{money(r.p.avg_nightly, a.currency)}</td>
              <td className={td}>{r.p.median_lead_days == null ? '–' : plural(r.p.median_lead_days, 'day')}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.p.top_listing ? `${r.p.top_listing.name} (${r.p.top_listing.nights})` : '–'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>);
}

function OneProperty({ a }: { a: Analysis }) {
  const [view, setView] = useState<View>('week');
  const latest = a.weeks.at(0);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[18px] font-semibold text-[#222222]">{a.name}: what competitors sold</h2>
        <p className="text-[13px] text-[#717171]">
          {plural(a.total.bookings, 'booking')}, {plural(a.total.nights, 'night')}, about {money(a.total.revenue, a.currency)}{a.total.estimated ? '*' : ''}
          {a.since ? ` since ${day(a.since)}` : ''} · booked a median {a.total.median_lead_days == null ? '–' : plural(a.total.median_lead_days, 'day')} ahead · stays of {a.total.avg_stay ?? '–'} nights
        </p>
      </div>

      {a.leaders.length > 0 &&
      <div>
          <div className={label}>Price leader</div>
          <div className={`${card} divide-y divide-[#F0F0F0]`}>
            {a.leaders.map((l) =>
          <div key={l.name} className="px-4 py-3">
                <div className="text-[15px] font-semibold text-[#222222]">{l.name}</div>
                <div className="text-[13px] text-[#717171]">
                  {plural(l.bookings, 'booking')}, {plural(l.nights, 'night')} · about {money(l.revenue, a.currency)}{l.estimated ? '*' : ''}
                  {l.avg_nightly ? ` at ${money(l.avg_nightly, a.currency)} a night` : ''}
                  {l.median_lead_days != null ? ` · booked ${plural(l.median_lead_days, 'day')} ahead` : ''}
                  {l.asking ? ` · asks ${money(l.asking, a.currency)} now` : ''}
                </div>
              </div>
          )}
          </div>
          <p className="text-[12px] text-[#B0B0B0] mt-1.5">Priced far above the rest, so left out of the medians below. It is the ceiling, not the market.</p>
        </div>
      }

      {a.suggestions.length > 0 &&
      <div className={`${card} divide-y divide-[#F0F0F0]`}>
          {a.suggestions.map((s, i) =>
        <div key={i} className="px-4 py-3 flex gap-3 text-[14px] text-[#222222]">
              <Lightbulb className="w-4 h-4 text-[#C9A227] shrink-0 mt-0.5" />
              <span>{s.text}</span>
            </div>
        )}
        </div>
      }

      <div className="flex gap-1 bg-[#EFEFEF] rounded-[10px] p-1 w-fit">
        {(['week', 'month', 'season'] as View[]).map((v) =>
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-3 py-1 rounded-[8px] text-[13px] font-semibold ${view === v ? 'bg-white text-[#222222] shadow-sm' : 'text-[#717171]'}`}>
            {v === 'week' ? 'Per week' : v === 'month' ? 'Per month' : 'Per season'}
          </button>
        )}
      </div>
      <PeriodTable a={a} view={view} />

      {view === 'week' && latest &&
      <div>
          <div className={label}>Sold in the week of {day(latest.week)}</div>
          <div className={card}>
            {latest.sales.map((s, i) =>
          <div key={i} className={`px-4 py-2.5 ${i ? 'border-t border-[#F0F0F0]' : ''}`}>
                <div className="text-[14px] font-medium text-[#222222]">{s.name}</div>
                <div className="text-[12px] text-[#717171]">
                  {day(s.check_in)}–{day(s.check_out)} · {s.nights} night{s.nights === 1 ? '' : 's'}
                  {s.lead_days != null ? ` · booked ${plural(s.lead_days, 'day')} ahead` : ''}
                  {s.nightly != null ? ` · ${money(s.nightly, a.currency)} a night${s.estimated ? '*' : ''}` : ''}
                </div>
              </div>
          )}
          </div>
        </div>
      }

      <div>
        <div className={label}>Who sells the most</div>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[12px] text-[#717171]">
                <th className="font-medium px-3 py-2 text-left">Competitor</th>
                <th className="font-medium px-3 py-2 text-right">Bookings</th>
                <th className="font-medium px-3 py-2 text-right">Nights</th>
                <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Sold for</th>
                <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Per night</th>
              </tr>
            </thead>
            <tbody>
              {a.listings.map((l) =>
              <tr key={l.name} className="border-t border-[#F0F0F0]">
                  <td className="px-3 py-2">{l.name}{l.is_benchmark && <span className="ml-1.5 text-[11px] font-semibold text-[#FF385C]">BENCHMARK</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.bookings}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.nights}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.revenue, a.currency)}{l.estimated && l.revenue != null ? '*' : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(l.avg_nightly, a.currency)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-[#B0B0B0] mt-1.5">
          * Estimated from the competitor's latest asking price where the sold nights were not quoted. Figures are Airbnb asking prices, before fees.
        </p>
      </div>
    </section>);
}

export function PeerAnalysis({ propertyId = 0 }: { propertyId?: number }) {
  const [data, setData] = useState<Analysis[] | null>(null);
  useEffect(() => {
    apiGet<{ properties: Analysis[] }>('/api/peers/analysis')
      .then((d) => setData(d.properties))
      .catch(() => setData([]));
  }, []);
  if (!data) return null;
  const shown = data.filter((a) => (!propertyId || a.id === propertyId) && a.total.bookings > 0);
  if (!shown.length) return null;
  return <div className="space-y-8">{shown.map((a) => <OneProperty key={a.id} a={a} />)}</div>;
}
