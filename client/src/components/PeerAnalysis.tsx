import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';

/**
 * What the competitors sold, added up — and what we sold beside it.
 *
 * By the week a sale was made (what happened lately), by the month and
 * season the guests stay (where the demand is). Every period is two
 * lines, theirs and ours, the same figures in the same order, so the
 * comparison reads down rather than across a table too wide for a phone.
 * Money is an estimate wherever a sale's own nights were never quoted,
 * and says so.
 */

export interface Period {
  bookings: number; nights: number; revenue: number | null; estimated: boolean;
  avg_nightly: number | null; median_lead_days: number | null; avg_stay: number | null;
  top_listing: { name: string; nights: number } | null;
}
export interface Sale { name: string; own?: boolean; leader?: boolean; channel?: string | null; check_in: string; check_out: string; nights: number; lead_days: number | null; nightly: number | null; estimated: boolean; revenue: number | null; }
interface Week extends Period { week: string; you?: Period; sales: Sale[]; }
interface Month extends Period { month: string; you?: Period; }
interface Season extends Period { season: string; you?: Period; }
export interface ListingRow extends Period { name: string; is_benchmark: boolean; is_leader?: boolean; is_own?: boolean; }
export interface Analysis {
  id: number; name: string; currency: string; since: string | null; total: Period; you?: Period;
  weeks: Week[]; months: Month[]; seasons: Season[]; listings: ListingRow[];
  leaders: (ListingRow & { asking: number | null })[];
  suggestions: { kind: string; text: string }[];
}

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const SIGNS: Record<string, string> = { ZAR: 'R', EUR: '€', USD: '$', GBP: '£' };
export const money = (n: number | null | undefined, c: string) =>
  n == null ? '–' : `${SIGNS[c] || `${c} `}${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
export const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "booked 12 days ahead", or the same day. */
export const ahead = (n: number) => (n === 0 ? 'booked the same day' : `booked ${plural(n, 'day')} ahead`);
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
const weekSpan = (monday: string) => {
  const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  return `${day(monday)} – ${day(sunday)}`;
};

/** "9 bookings · 41 nights · R271 702* · R3 923 a night · 51 days ahead" */
function Figures({ p, currency }: { p: Period | undefined; currency: string }) {
  if (!p || !p.bookings) return <span className="text-[#B0B0B0]">nothing sold</span>;
  return (
    <span className="tabular-nums">
      {plural(p.bookings, 'booking')} · {plural(p.nights, 'night')} · <span className="font-semibold">{money(p.revenue, currency)}{p.estimated && p.revenue != null ? '*' : ''}</span>
      {p.avg_nightly != null && <> · {money(p.avg_nightly, currency)} a night</>}
      {p.median_lead_days != null && <> · {ahead(p.median_lead_days)}</>}
    </span>);
}

function SaleLine({ s, currency }: { s: Sale; currency: string }) {
  return (
    <div className="py-1.5 text-[13px]">
      <span className={`font-medium ${s.own ? 'text-[#0F6E56]' : 'text-[#222222]'}`}>{s.own ? `You${s.channel ? ` (${s.channel})` : ''}` : s.name}</span>
      {s.leader && <span className="ml-1.5 text-[11px] font-semibold text-[#C9A227]">PRICE LEADER</span>}
      <span className="text-[#717171]">
        {' · '}{day(s.check_in)}–{day(s.check_out)} · {plural(s.nights, 'night')}
        {s.lead_days != null ? ` · ${ahead(s.lead_days)}` : ''}
        {s.nightly != null ? ` · ${money(s.nightly, currency)} a night${s.estimated ? '*' : ''}` : ''}
      </span>
    </div>);
}

type View = 'week' | 'month' | 'season';
const VIEWS: [View, string][] = [['week', 'Per week'], ['month', 'Per month'], ['season', 'Per season']];

function PeriodList({ a, view, exporting }: { a: Analysis; view: View; exporting: boolean }) {
  // The latest week opens by itself; the rest on a tap. A saved copy
  // opens them all, since nobody can tap a file.
  const [open, setOpen] = useState<Set<string>>(() => new Set(a.weeks.length ? [a.weeks[0].week] : []));
  const rows: { key: string; label: string; p: Period; you?: Period; sales?: Sale[] }[] =
  view === 'week' ? a.weeks.map((w) => ({ key: w.week, label: `Booked ${weekSpan(w.week)}`, p: w, you: w.you, sales: w.sales })) :
  view === 'month' ? a.months.map((m) => ({ key: m.month, label: `Staying in ${monthName(m.month)}`, p: m, you: m.you })) :
  a.seasons.map((s) => ({ key: s.season, label: `Staying in ${s.season}`, p: s, you: s.you }));
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className={`${card} divide-y divide-[#F0F0F0]`}>
      {rows.map((r) => {
        const expandable = Boolean(r.sales && r.sales.length);
        const isOpen = expandable && (exporting || open.has(r.key));
        const Chevron = isOpen ? ChevronDown : ChevronRight;
        return (
          <div key={r.key} className="px-4 py-3">
            <button
              type="button"
              disabled={!expandable}
              onClick={() => toggle(r.key)}
              className="w-full text-left flex items-center gap-1.5 text-[14px] font-semibold text-[#222222]">
              {expandable && <Chevron data-no-export className="w-4 h-4 text-[#B0B0B0] shrink-0" />}
              {r.label}
            </button>
            <div className="mt-1 text-[13px] text-[#222222] leading-[1.5]">
              <div><span className="text-[#717171]">Competitors: </span><Figures p={r.p} currency={a.currency} /></div>
              <div><span className="text-[#0F6E56] font-semibold">You: </span><Figures p={r.you} currency={a.currency} /></div>
              {r.p.top_listing && <div className="text-[#717171]">Sold most: {r.p.top_listing.name}, {plural(r.p.top_listing.nights, 'night')}</div>}
            </div>
            {isOpen &&
            <div className="mt-2 pl-3 border-l-2 border-[#F0F0F0]">
                {r.sales!.map((s, i) => <SaleLine key={i} s={s} currency={a.currency} />)}
              </div>
            }
          </div>);
      })}
    </div>);
}

/** Week, month or season, with a switch; every one of them in a saved copy. */
export function SalesByPeriod({ a, exporting = false }: { a: Analysis; exporting?: boolean }) {
  const [view, setView] = useState<View>('week');
  if (exporting) {
    return (
      <div className="space-y-4">
        {VIEWS.map(([v, name]) =>
        <div key={v}>
            <div className="text-[13px] font-semibold text-[#717171] pb-1.5">{name}</div>
            <PeriodList a={a} view={v} exporting />
          </div>
        )}
      </div>);
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-1 bg-[#EFEFEF] rounded-[10px] p-1 w-fit">
        {VIEWS.map(([v, name]) =>
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-3 py-1 rounded-[8px] text-[13px] font-semibold ${view === v ? 'bg-white text-[#222222] shadow-sm' : 'text-[#717171]'}`}>
            {name}
          </button>
        )}
      </div>
      <PeriodList key={view} a={a} view={view} exporting={false} />
    </div>);
}

/** The totals since the watch began, theirs and ours, in two lines. */
export function SalesTotals({ a }: { a: Analysis }) {
  return (
    <div className="text-[13px] leading-[1.5]">
      <div><span className="text-[#717171]">Competitors{a.since ? ` since ${day(a.since)}` : ''}: </span><Figures p={a.total} currency={a.currency} /></div>
      <div><span className="text-[#0F6E56] font-semibold">You, all channels: </span><Figures p={a.you} currency={a.currency} /></div>
    </div>);
}

export function Suggestions({ a }: { a: Analysis }) {
  if (!a.suggestions.length) return null;
  return (
    <div className={`${card} divide-y divide-[#F0F0F0]`}>
      {a.suggestions.map((s, i) =>
      <div key={i} className="px-4 py-3 flex gap-3 text-[14px] text-[#222222]">
          <Lightbulb className="w-4 h-4 text-[#C9A227] shrink-0 mt-0.5" />
          <span>{s.text}</span>
        </div>
      )}
    </div>);
}

export const ESTIMATE_NOTE =
  "* Estimated from the competitor's quote nearest in date where the sold nights were not quoted. Competitor figures are Airbnb asking prices before fees; yours are what guests paid, from Smoobu. A price leader asks more than twice the competitors' median: it counts in every list but not in the per-night averages or the suggestions.";
