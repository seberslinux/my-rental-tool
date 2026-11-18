import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { apiGet } from '../data/session';
import { PeersSummaryCards, PeerSummaryRow, money } from './PeersSummary';
import { Analysis, ESTIMATE_NOTE, SalesByPeriod, SalesTotals, Suggestions } from './PeerAnalysis';
import { FeatureProps, FeaturesBlock, RecordDownloads } from './PeerFeatures';
import { Listing, PropertyPeers, Run, cleaningSummary, competitorRows, daysAhead, defaultStay, nightlyRows, stayDates, stayTable } from './peersShared';

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
 * Nightly price without fees or cleaning for the same stay, side by side.
 *
 * A stay that has already sold shows as "sold": the price it was on sale
 * for is not what anybody can book it for now, and leaving it in would
 * make a full competitor look cheap or dear by accident.
 */
function PriceTable({ title, dates, rows, currency }: {
  title: string; dates: string[]; currency?: string;
  rows: { name: string; mine?: boolean; values: (number | 'sold' | null)[] }[];
}) {
  if (!dates.length) return null;
  const cell = (v: number | 'sold' | null) =>
    v == null ? '–' : v === 'sold' ? <span className="text-[#B0B0B0]">sold</span> : money(v, currency);
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
          {rows.map((r) =>
          <tr key={r.name} className="border-t border-[#F0F0F0]">
              <td className={`px-4 py-2 max-w-[160px] truncate ${r.mine ? 'font-semibold' : ''}`}>{r.name}</td>
              {r.values.map((v, i) => <td key={i} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{cell(v)}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>);
}

/** The listing's name, linking to Airbnb, with its tags. */
function NameCell({ l, leader }: { l: Listing; leader: boolean }) {
  return (
    <td className={`px-3 py-2 sticky left-0 min-w-[150px] max-w-[220px] ${l.is_own ? 'bg-[#F4FAF7]' : 'bg-white'}`}>
      <a href={l.url} target="_blank" rel="noreferrer" className={`text-[#222222] underline decoration-[#DDDDDD] underline-offset-2 ${l.is_own ? 'font-semibold' : ''}`}>
        {l.is_own ? 'You' : l.name}
        <ExternalLink className="inline w-3 h-3 ml-1 text-[#B0B0B0] align-[-1px]" />
      </a>
      {l.is_own && <span className="block text-[11px] text-[#717171] truncate">{l.name}</span>}
      {l.is_benchmark && <span className="block text-[11px] font-semibold text-[#FF385C]">BENCHMARK</span>}
      {leader && <span className="block text-[11px] font-semibold text-[#C9A227]">PRICE LEADER</span>}
    </td>);
}

/**
 * The same two-night stay at every listing, taken apart so it compares:
 * the nightly price without fees, the cleaning and stay fees charged once,
 * Airbnb's fees a night, and the total a guest pays. One date for all,
 * chosen from the quoted Fridays and Mondays.
 */
function StayTable({ p, a }: { p: PropertyPeers; a: Analysis | undefined }) {
  const dates = stayDates(p);
  const first = defaultStay(p);
  const [pick, setPick] = useState(first ? `${first.kind}:${first.i}` : '');
  const chosen = dates.find((d) => `${d.kind}:${d.i}` === pick) || first;
  if (!chosen) return <p className="text-[13px] text-[#717171]">No prices read yet.</p>;
  const { rows, median, share } = stayTable(p, a, chosen);
  const m = (n: number) => money(n, p.currency);
  const th = 'font-medium px-3 py-2 text-right whitespace-nowrap';
  const td = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';
  const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px] text-[#717171]">
        Two nights from
        <select value={`${chosen.kind}:${chosen.i}`} onChange={(e) => setPick(e.target.value)}
          className="h-[32px] px-2 border border-[#DDDDDD] rounded-[8px] text-[13px] bg-white text-[#222222]">
          {dates.map((d) => <option key={`${d.kind}:${d.i}`} value={`${d.kind}:${d.i}`}>{weekday(d.date)}</option>)}
        </select>
      </label>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-[#717171] align-bottom">
              <th className="font-medium px-3 py-2 text-left sticky left-0 bg-white">Listing</th>
              <th className={th}>Nightly<br />(no fees)</th>
              <th className={th}>Cleaning &amp;<br />stay fees (once)</th>
              <th className={th}>Airbnb fees<br />a night</th>
              <th className={th}>Total,<br />2 nights</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, b, booked, leader }) =>
            <tr key={l.id} className={`border-t border-[#F0F0F0] ${l.is_own ? 'bg-[#F4FAF7]' : ''}`}>
                <NameCell l={l} leader={leader} />
                {b ? <>
                  <td className={`${td} font-semibold`}>{m(b.nightly)}</td>
                  <td className={td}>{b.cleaning ? m(b.cleaning) : 'none'}{b.cleaningMeasured ? '' : '~'}</td>
                  <td className={td}>{m(b.fees)}</td>
                  <td className={td}>{m(b.total)}</td>
                </> : <td colSpan={4} className="px-3 py-2 text-left text-[#B0B0B0]">{booked ? 'booked those nights' : 'not quoted'}</td>}
              </tr>
            )}
            {median &&
            <tr className="border-t-2 border-[#E0E0E0]">
                <td className="px-3 py-2 sticky left-0 bg-white text-[#717171]">Competitors (median)</td>
                <td className={`${td} font-semibold`}>{m(median.nightly)}</td>
                <td className={td}>{m(median.cleaning)}</td>
                <td className={td}>{m(median.fees)}</td>
                <td className={td}>{m(median.total)}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-[#B0B0B0]">
        Total = 2 × nightly + cleaning &amp; stay fees + 2 × Airbnb fees: the all-in price Airbnb shows, before taxes.
        Cleaning &amp; stay fees (cleaning, linen and the like) are measured weekly per listing; ~ is the competitors' average until one is.
        Airbnb's fees are {Math.round(share * 1000) / 10}% of the nights{p.airbnb_fee_measured ? ', as it kept on your own Airbnb bookings' : ' (its standard rate)'}. The median leaves you and the price leader out.
      </p>
    </div>);
}

/** What each listing has sold since the watch began, and how far ahead. */
function SalesTable({ p, a }: { p: PropertyPeers; a: Analysis | undefined }) {
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
            <th className={th}>Bookings</th>
            <th className={th}>Nights</th>
            <th className={th}>Sold for</th>
            <th className={th}>Per night</th>
            <th className={th}>Booked<br />ahead</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ l, s, taken, leader }) =>
          <tr key={l.id} className={`border-t border-[#F0F0F0] ${l.is_own ? 'bg-[#F4FAF7]' : ''}`}>
              <NameCell l={l} leader={leader} />
              <td className={td}>{taken == null ? '–' : `${taken}%`}</td>
              <td className={td}>{s ? s.bookings : 0}</td>
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

  const measureCleaning = async () => {
    const res = await fetch('/api/peers/cleaning', { method: 'POST', credentials: 'same-origin' });
    setPricing(res.ok ? 'Measuring cleaning fees in the background — a few minutes. Reload to see them.' :
    res.status === 409 ? 'Cleaning fees are already being measured.' : 'Could not start measuring cleaning fees.');
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
          {isAdmin &&
          <button
            onClick={measureCleaning}
            className="shrink-0 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold">
              Measure cleaning
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
              <div className={label}>Price for the same stay</div>
              {cleaningSummary(p, (n) => money(n, p.currency)) && <p className="text-[13px] text-[#222222] mb-2">{cleaningSummary(p, (n) => money(n, p.currency))}</p>}
              <StayTable p={p} a={a} />
            </div>
            <div>
              <div className={label}>What they sold</div>
              {a && a.total.bookings > 0 && <div className="mb-2"><SalesTotals a={a} /></div>}
              <SalesTable p={p} a={a} />
              <p className="text-[12px] text-[#B0B0B0] mt-1.5">
                Tap a name to open it on Airbnb. Prices for {p.guests || 2} guests. Competitors' sales count their cleaning once per stay. {ESTIMATE_NOTE}
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
                <div className={label}>Ahead: nightly price without fees or cleaning, {p.guests || 2} guests</div>
                <div className="space-y-3">
                  <PriceTable title="Weekend (Fri)" currency={p.currency} {...nightlyRows(p, a, 'weekend')} />
                  <PriceTable title="Weekday (Mon)" currency={p.currency} {...nightlyRows(p, a, 'weekday')} />
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
