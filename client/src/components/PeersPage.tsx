import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { apiGet } from '../data/session';

/**
 * How we are selling against the listings we compete with.
 *
 * Read from Airbnb three times a day. A night counts as sold when Airbnb
 * no longer offers it, for us and for them alike, so host blocks count
 * too — the same reading as the peer analysis. The first reading only
 * records the calendars; sales appear from the second one on.
 */

interface Listing {
  id: number; name: string; url: string; is_own: boolean; is_benchmark: boolean;
  read: boolean; months: (number | null)[]; open_30: number | null;
}
interface Sale { id: number; name: string; check_in: string; check_out: string; nights: number; detected_at: string; }
interface PropertyPeers {
  id: number; name: string; months: string[];
  own: Listing | null; benchmark: Listing | null; peer_median: (number | null)[];
  listings: Listing[]; recent: Sale[];
}
interface Run { finished_at: string; listings_ok: number; listings_failed: number; error: string | null; }

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const label = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';

const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short' });
const pct = (v: number | null) => (v == null ? '–' : `${v}%`);

function span(a: string, b: string) {
  const f = (d: string, m: boolean) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', ...(m ? { month: 'short' } : {}) });
  return `${f(a, a.slice(0, 7) !== b.slice(0, 7))}–${f(b, true)}`;
}

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

export function PeersPage({ propertyId = 0, isAdmin = false }: { propertyId?: number; isAdmin?: boolean }) {
  const [data, setData] = useState<{ properties: PropertyPeers[]; last_run: Run | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<{ properties: PropertyPeers[]; last_run: Run | null }>('/api/peers')
      .then((d) => { setData(d); setError(''); })
      .catch(() => setError('Could not load the competitors.'));
  }, []);
  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full space-y-6 max-w-[900px]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[#717171]">
          {run ?
          <>Read from Airbnb {ago(run.finished_at)} · {run.listings_ok} listings
              {run.listings_failed ? <span className="text-[#C13515]"> · {run.listings_failed} could not be read</span> : null}</> :
          'Not read yet. It reads at 06:00, 13:00 and 20:00; sales show from the second reading.'}
        </p>
        {isAdmin &&
        <button
          onClick={readNow}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Reading… about a minute' : 'Read now'}
          </button>
        }
      </div>
      {run && run.error && run.listings_ok === 0 &&
      <p className="text-[13px] text-[#C13515]">{run.error}</p>
      }

      {shown.map((p) =>
      <section key={p.id} className="space-y-3">
          <h2 className="text-[18px] font-semibold text-[#222222]">{p.name}</h2>

          <SoldTable p={p} />

          <div>
            <div className={label}>New bookings, last 14 days</div>
            <div className={card}>
              {p.recent.length === 0 ?
            <p className="px-4 py-3 text-[14px] text-[#717171]">None found yet.</p> :
            p.recent.map((s, i) =>
            <div key={s.id} className={`px-4 py-2.5 flex items-baseline justify-between gap-3 ${i ? 'border-t border-[#F0F0F0]' : ''}`}>
                    <span className="text-[14px] text-[#222222] min-w-0 truncate">
                      <span className="font-medium">{s.name}</span> · {span(s.check_in, s.check_out)} · {s.nights} night{s.nights === 1 ? '' : 's'}
                    </span>
                    <span className="text-[12px] text-[#717171] shrink-0">{ago(s.detected_at)}</span>
                  </div>
            )}
            </div>
          </div>

          <div>
            <div className={label}>Listings compared</div>
            <div className={card}>
              {p.listings.map((l, i) =>
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className={`px-4 py-2.5 flex items-center justify-between gap-3 ${i ? 'border-t border-[#F0F0F0]' : ''}`}>
                  <span className="min-w-0">
                    <span className="text-[14px] text-[#222222] truncate block">
                      {l.name}
                      {l.is_own && <span className="ml-2 text-[11px] font-semibold text-[#0F6E56]">YOURS</span>}
                      {l.is_benchmark && <span className="ml-2 text-[11px] font-semibold text-[#FF385C]">BENCHMARK</span>}
                    </span>
                    <span className="text-[12px] text-[#717171]">
                      {l.read ? `${pct(l.months[0])} of ${monthName(p.months[0])} sold · ${l.open_30} night${l.open_30 === 1 ? '' : 's'} open in the next 30 days` : 'Not read yet'}
                    </span>
                  </span>
                  <ExternalLink className="w-4 h-4 text-[#B0B0B0] shrink-0" />
                </a>
            )}
            </div>
          </div>
        </section>
      )}
    </div>);
}
