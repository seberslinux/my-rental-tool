import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { apiGet } from '../data/session';

/**
 * Occupancy against the competitors, one block per property.
 *
 * The share of nights taken over the next 30 and 90 days for us, the
 * competitors' median and the benchmark, all read from Airbnb the same
 * way — so a block counts as taken for everybody, which is the only way
 * the comparison is fair. The verdict is about the median, not the
 * benchmark: the benchmark is the best in the segment, and being behind
 * it is the normal state of things.
 */

export interface PeerWindow { days: number; own: number | null; benchmark: number | null; median: number | null; }
export interface PeerSummaryRow { id: number; name: string; benchmark_name: string | null; windows: PeerWindow[]; }

const card = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const pct = (v: number | null) => (v == null ? '–' : `${v}%`);

function verdict(w: PeerWindow | undefined) {
  if (!w || w.own == null || w.median == null) return null;
  const gap = w.own - w.median;
  if (gap <= -5) return { text: `${-gap} pts behind`, cls: 'bg-[#FDECEA] text-[#C13515]' };
  if (gap >= 5) return { text: `${gap} pts ahead`, cls: 'bg-[#EAF4F0] text-[#0F6E56]' };
  return { text: 'level', cls: 'bg-[#F0F0F0] text-[#717171]' };
}

export function PeersSummaryCards({ rows, propertyId = 0, onOpen }: {
  rows: PeerSummaryRow[]; propertyId?: number; onOpen?: () => void;
}) {
  const shown = rows.filter((r) => !propertyId || r.id === propertyId);
  if (!shown.length) return null;
  return (
    <div className="space-y-3">
      {shown.map((p) => {
        const near = verdict(p.windows.find((w) => w.days === 30));
        const lines = [
          { name: 'You', key: 'own' as const, strong: true },
          { name: 'Others (median)', key: 'median' as const },
          ...(p.benchmark_name ? [{ name: p.benchmark_name, key: 'benchmark' as const }] : []),
        ];
        return (
          <div
            key={p.id}
            className={`${card} px-4 py-3 ${onOpen ? 'cursor-pointer active:bg-[#F7F7F7]' : ''}`}
            onClick={onOpen}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[15px] font-semibold text-[#222222] truncate">{p.name}</span>
              <span className="flex items-center gap-1.5 shrink-0">
                {near && <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${near.cls}`}>{near.text}</span>}
                {onOpen && <ChevronRight className="w-4 h-4 text-[#B0B0B0]" />}
              </span>
            </div>
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-[12px] text-[#717171]">
                  <th className="text-left font-medium py-1">Occupancy, next</th>
                  {p.windows.map((w) => <th key={w.days} className="text-right font-medium py-1 pl-2 whitespace-nowrap">{w.days} days</th>)}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) =>
                <tr key={l.key} className="border-t border-[#F0F0F0]">
                    <td className={`py-1.5 max-w-[150px] truncate ${l.strong ? 'font-semibold' : ''}`}>{l.name}</td>
                    {p.windows.map((w) =>
                  <td key={w.days} className={`py-1.5 pl-2 text-right tabular-nums ${l.strong ? 'font-semibold' : ''}`}>
                        {pct(w[l.key])}
                      </td>
                  )}
                  </tr>
                )}
              </tbody>
            </table>
          </div>);
      })}
    </div>);
}

/** The Home version: fetches its own summary and opens Competitors on tap. */
export function PeersSummary({ propertyId = 0, onOpen }: { propertyId?: number; onOpen?: () => void }) {
  const [rows, setRows] = useState<PeerSummaryRow[] | null>(null);
  useEffect(() => {
    apiGet<{ properties: PeerSummaryRow[] }>('/api/peers/summary')
      .then((d) => setRows(d.properties))
      .catch(() => setRows([]));
  }, []);
  if (!rows || !rows.filter((r) => !propertyId || r.id === propertyId).length) return null;
  return (
    <div className="mb-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
        Against competitors on Airbnb
      </div>
      <PeersSummaryCards rows={rows} propertyId={propertyId} onOpen={onOpen} />
    </div>);
}
