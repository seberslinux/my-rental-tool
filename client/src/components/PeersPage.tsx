import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { apiGet } from '../data/session';
import { PeersSummaryCards, PeerSummaryRow, money } from './PeersSummary';
import { Analysis, ESTIMATE_NOTE, SalesByPeriod, SalesTotals, Suggestions } from './PeerAnalysis';
import { FeatureProps, FeaturesBlock, RecordDownloads } from './PeerFeatures';
import { PropertyPeers, Quote, Run, competitorRows, daysAhead } from './peersShared';

/**
 * How we are selling against the listings we compete with.
 *
 * Read from Airbnb three times a day. A night counts as sold when Airbnb
 * no longer offers it, for us and for them alike, so host blocks count
 * too — the same reading as the peer analysis. The first reading only
 * records the calendars; sales appear from the second one on.
 */

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const label = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';

const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short' });
const pct = (v: number | null) => (v == null ? '–' : `${v}%`);

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function SoldTable({ p }: { p: PropertyPeers }) {
  const rows: { name: string; values: (number | null)[]; mine?: boolean }[] = [];
  if (p.own) rows.push({ name: 'You', values: p.own.months, mine: true });
  if (p.benchmark) rows.push({ name: p.benchmark.name, values: p.benchmark.months });
  rows.push({ name: 'Others (median)', values: p.peer_median });

  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-[12px] text-[#717171]">
            <th className="text-left font-medium px-4 py-2">Nights sold</th>
            {p.months.map((m) => <th key={m} className="font-medium px-2 py-2 text-right">{monthName(m)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
          <tr key={r.name} className="border-t border-[#F0F0F0]">
              <td className={`px-4 py-2 ${r.mine ? 'font-semibold' : ''} max-w-[160px] truncate`}>{r.name}</td>
              {r.values.map((v, i) => {
              const behind = r.mine && v != null && p.peer_median[i] != null && v + 15 < (p.peer_median[i] as number);
              return (
                <td key={i} className={`px-2 py-2 text-right tabular-nums ${behind ? 'text-[#C13515] font-semibold' : ''}`}>
                    {pct(v)}
                  </td>);
            })}
            </tr>
          )}
        </tbody>
      </table>
    </div>);
}

const dayMonth = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });

/**
 * Asking price per night for the same stay, side by side.
 *
 * A stay that has already sold shows as "sold": the price it was on sale
 * for is not what anybody can book it for now, and leaving it in would
 * make a full competitor look cheap or dear by accident.
 */
function PriceTable({ title, dates, median, own, benchmark, currency }: {
  title: string; dates: string[]; median: (number | null)[]; currency?: string;
  own: (Quote | null)[] | undefined; benchmark: { name: string; quotes: (Quote | null)[] } | null;
}) {
  if (!dates.length) return null;
  const cell = (q: Quote | null | undefined) =>
    !q ? '–' : q.open ? money(q.nightly, currency) : <span className="text-[#B0B0B0]">sold</span>;
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-[12px] text-[#717171]">
            <th className="text-left font-medium px-4 py-2 whitespace-nowrap">{title}</th>
            {dates.map((d) => <th key={d} className="font-medium px-2 py-2 text-right whitespace-nowrap">{dayMonth(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {own &&
          <tr className="border-t border-[#F0F0F0]">
              <td className="px-4 py-2 font-semibold">You</td>
              {dates.map((_, i) => <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{cell(own[i])}</td>)}
            </tr>
          }
          {benchmark &&
          <tr className="border-t border-[#F0F0F0]">
              <td className="px-4 py-2 max-w-[160px] truncate">{benchmark.name}</td>
              {dates.map((_, i) => <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{cell(benchmark.quotes[i])}</td>)}
            </tr>
          }
          <tr className="border-t border-[#F0F0F0]">
            <td className="px-4 py-2">Others (median)</td>
            {median.map((v, i) => <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{v == null ? '–' : money(v, currency)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>);
}

/**
 * Every listing compared, on one row each: where it stands now (nights
 * taken in the next 30 days, what it asks for the next free weekend) and
 * what it has sold since the watch began, with how far ahead. The name
 * opens the listing on Airbnb. Ours from Smoobu, all channels.
 */
function CompetitorTable({ p, a }: { p: PropertyPeers; a: Analysis | undefined }) {
  const rows = competitorRows(p, a);
  const th = 'font-medium px-3 py-2 text-right whitespace-nowrap';
  const td = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[12px] text-[#717171] align-bottom">
            <th className="font-medium px-3 py-2 text-left sticky left-0 bg-white">Listing</th>
            <th className={th}>Taken<br />next 30 days</th>
            <th className={th}>Asks<br />next weekend</th>
            <th className={`${th} border-l border-[#F0F0F0]`}>Bookings</th>
            <th className={th}>Nights</th>
            <th className={th}>Sold for</th>
            <th className={th}>Per night</th>
            <th className={th}>Booked<br />ahead</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ l, s, taken, ask, leader }) =>
          <tr key={l.id} className={`border-t border-[#F0F0F0] ${l.is_own ? 'bg-[#F4FAF7]' : ''}`}>
              <td className={`px-3 py-2 sticky left-0 min-w-[150px] max-w-[220px] ${l.is_own ? 'bg-[#F4FAF7]' : 'bg-white'}`}>
                <a href={l.url} target="_blank" rel="noreferrer" className={`text-[#222222] underline decoration-[#DDDDDD] underline-offset-2 ${l.is_own ? 'font-semibold' : ''}`}>
                  {l.is_own ? 'You' : l.name}
                  <ExternalLink className="inline w-3 h-3 ml-1 text-[#B0B0B0] align-[-1px]" />
                </a>
                {l.is_own && <span className="block text-[11px] text-[#717171] truncate">{l.name}</span>}
                {l.is_benchmark && <span className="block text-[11px] font-semibold text-[#FF385C]">BENCHMARK</span>}
                {leader && <span className="block text-[11px] font-semibold text-[#C9A227]">PRICE LEADER</span>}
              </td>
              <td className={td}>{taken == null ? '–' : `${taken}%`}</td>
              <td className={td}>{ask ? <>{money(ask.nightly, p.currency)}<span className="block text-[11px] text-[#717171]">{dayMonth(ask.date)}</span></> : <span className="text-[#B0B0B0]">{l.read ? 'sold out' : '–'}</span>}</td>
              <td className={`${td} border-l border-[#F0F0F0]`}>{s ? s.bookings : 0}</td>
              <td className={td}>{s ? s.nights : 0}</td>
              <td className={td}>{s && s.revenue != null ? `${money(s.revenue, p.currency)}${s.estimated ? '*' : ''}` : '–'}</td>
              <td className={td}>{s && s.avg_nightly != null ? money(s.avg_nightly, p.currency) : '–'}</td>
              <td className={td}>{daysAhead(s?.median_lead_days)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>);
}


export function PeersPage({ propertyId = 0, isAdmin = false }: { propertyId?: number; isAdmin?: boolean }) {
  const [data, setData] = useState<{ properties: PropertyPeers[]; summary?: PeerSummaryRow[]; last_run: Run | null } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis[]>([]);
  const [features, setFeatures] = useState<FeatureProps[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    apiGet<{ properties: PropertyPeers[]; summary?: PeerSummaryRow[]; last_run: Run | null }>('/api/peers')
      .then((d) => { setData(d); setError(''); })
      .catch(() => setError('Could not load the competitors.'));
    apiGet<{ properties: Analysis[] }>('/api/peers/analysis').then((d) => setAnalysis(d.properties)).catch(() => setAnalysis([]));
    apiGet<{ properties: FeatureProps[] }>('/api/peers/features').then((d) => setFeatures(d.properties)).catch(() => setFeatures([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const [pricing, setPricing] = useState('');
  const readPrices = async () => {
    const res = await fetch('/api/peers/prices', { method: 'POST', credentials: 'same-origin' });
    setPricing(res.ok ? 'Reading prices in the background — about an hour. Reload to see them.' :
    res.status === 409 ? 'Prices are already being read.' : 'Could not start reading prices.');
  };

  const readNow = async () => {
    setBusy(true);
    try {
      await fetch('/api/peers/run', { method: 'POST', credentials: 'same-origin' });
      load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="p-4 text-[14px] text-[#C13515]">{error}</div>;
  if (!data) return <div className="p-4 text-[14px] text-[#717171]">Loading…</div>;

  const shown = data.properties.filter((p) => !propertyId || p.id === propertyId);
  const run = data.last_run;
  const names = shown.map((p) => p.name).join(', ');
  const stamp = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

  const download = async () => {
    setExporting(true);
    try {
      // Loaded on the tap: the PDF library is large and most visits never print.
      const { peersPdf } = await import('./peersPdf');
      await peersPdf({
        properties: shown,
        analysis, features, summary: data.summary || [], run,
        filename: `Competitors - ${names} - ${stamp}.pdf`,
      });
    } catch (err) {
      setPricing('Could not make the PDF.');
      console.error('PDF failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full space-y-8 max-w-[900px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 min-w-[180px] text-[13px] text-[#717171]">
            {run ?
            <>Read from Airbnb {ago(run.finished_at)} · {run.listings_ok} listings
                {run.listings_failed ? <span className="text-[#C13515]"> · {run.listings_failed} could not be read</span> : null}</> :
            'Not read yet. It reads at 06:00, 13:00 and 20:00; sales show from the second reading.'}
          </p>
          <button
            onClick={download}
            disabled={exporting}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> {exporting ? 'Making the PDF…' : 'Download PDF'}
          </button>
          {isAdmin &&
          <button
            onClick={readNow}
            disabled={busy}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Reading…' : 'Read now'}
            </button>
          }
          {isAdmin &&
          <button
            onClick={readPrices}
            className="shrink-0 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold">
              Read prices
            </button>
          }
        </div>
        {pricing && <p className="text-[13px] text-[#717171]">{pricing}</p>}
        {run && run.error && run.listings_ok === 0 &&
        <p className="text-[13px] text-[#C13515]">{run.error}</p>
        }
      </div>

      {shown.map((p) => {
        const a = analysis.find((x) => x.id === p.id);
        const f = features.find((x) => x.id === p.id);
        const summary = (data.summary || []).filter((r) => r.id === p.id);
        return (
          <section key={p.id} className="space-y-6">
            <h2 className="text-[20px] font-bold text-[#222222]">{p.name}</h2>

            {/* Where we stand, as one picture. */}
            {summary.length > 0 &&
            <div>
                <div className={label}>At a glance</div>
                <PeersSummaryCards rows={summary} propertyId={p.id} height={300} showName={false} />
              </div>
            }

            {/* What the numbers say to do. */}
            {a && a.suggestions.length > 0 &&
            <div>
                <div className={label}>What to do</div>
                <Suggestions a={a} />
              </div>
            }

            {/* Everybody on one row: now, and what they sold. */}
            <div>
              <div className={label}>Competitors</div>
              {a && a.total.bookings > 0 && <div className="mb-2"><SalesTotals a={a} /></div>}
              <CompetitorTable p={p} a={a} />
              <p className="text-[12px] text-[#B0B0B0] mt-1.5">
                Tap a name to open it on Airbnb. Asking prices for {p.guests || 2} guests. {ESTIMATE_NOTE}
              </p>
            </div>

            {/* When they sold, and for when. */}
            {a && (a.weeks.length > 0 || a.months.length > 0) &&
            <div>
                <div className={label}>Sales</div>
                <SalesByPeriod a={a} />
              </div>
            }

            {/* The months and stays ahead. */}
            <div>
              <div className={label}>Ahead: nights taken per month</div>
              <SoldTable p={p} />
            </div>
            {p.prices && (p.prices.weekends.length > 0 || p.prices.weekdays.length > 0) &&
            <div>
                <div className={label}>Ahead: price per night, {p.guests || 2} guests</div>
                <div className="space-y-3">
                  <PriceTable
                  title="Weekend (Fri)"
                  dates={p.prices.weekends}
                  median={p.prices.weekend_median}
                  currency={p.currency}
                  own={p.own?.weekend}
                  benchmark={p.benchmark ? { name: p.benchmark.name, quotes: p.benchmark.weekend } : null} />
                  <PriceTable
                  title="Weekday (Mon)"
                  dates={p.prices.weekdays}
                  median={p.prices.weekday_median}
                  currency={p.currency}
                  own={p.own?.weekday}
                  benchmark={p.benchmark ? { name: p.benchmark.name, quotes: p.benchmark.weekday } : null} />
                </div>
              </div>
            }

            {/* What a renovation should aim at. */}
            {f && <FeaturesBlock p={f} isAdmin={isAdmin} />}
          </section>);
      })}

      {isAdmin && <RecordDownloads />}
    </div>);
}
