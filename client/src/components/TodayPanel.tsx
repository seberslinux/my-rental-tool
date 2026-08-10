import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, Check, AlertCircle, ArrowRight } from 'lucide-react';

/**
 * What needs you, and what is happening.
 *
 * Both were answered four different ways before: a board, an attention
 * list, a property card and a badge, each looking at the data its own
 * way. They disagreed with each other on the same screen — a cleaner who
 * had accepted a job appeared as "No cleaner" — and the attention list
 * ranked a gap in January beside a checkout that afternoon.
 *
 * Now the server answers once and this renders it. Nothing here decides
 * anything.
 */

interface Need {
  key: string;
  title: string;
  subtitle: string;
  action: {label: string;kind: string;property_id?: number;date?: string;block_id?: number;};
}

interface BoardRow {
  key: string;
  kind: 'in' | 'out';
  when: string;
  guest: string;
  property: string;
  property_id: number;
  date: string;
  cleaner: {name: string;status: string;} | null;
}

const cleanerLabel = (c: BoardRow['cleaner']) => {
  if (!c) return null;
  if (c.status === 'pending') return `${c.name} · not answered yet`;
  if (c.status === 'completed') return `${c.name} · done`;
  if (c.status === 'in_progress') return `${c.name} · on site`;
  return `${c.name} · accepted`;
};

export function TodayPanel({ onGoToDay }: {onGoToDay?: (propertyId: number, date: string) => void;}) {
  const [needs, setNeeds] = useState<Need[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/dashboard/today', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    setNeeds(data.needs || []);
    setBoard(data.board || []);
  };

  useEffect(() => { load(); }, []);

  const act = async (n: Need) => {
    if (n.action.kind === 'unblock' && n.action.property_id && n.action.block_id) {
      setBusy(n.key);
      setError('');
      const res = await fetch(
        `/api/properties/${n.action.property_id}/block/${n.action.block_id}`,
        { method: 'DELETE', credentials: 'same-origin' }
      );
      setBusy(null);
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || 'Could not put those nights back');
        return;
      }
      load();
      return;
    }
    if (n.action.property_id && n.action.date && onGoToDay) {
      onGoToDay(n.action.property_id, n.action.date);
    }
  };

  return (
    <>
      {/* One list, ordered by when it bites rather than by kind. */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Needs you
        </div>

        {error && <p className="mb-2 text-[13px] text-[#991B1B]">{error}</p>}

        {needs.length === 0 ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F6E56]" />
            <span className="text-[14px] text-[#222222]">Nothing needs you.</span>
          </div> :

        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {needs.map((n, idx) =>
          <div
            key={n.key}
            className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-[#222222] truncate">{n.title}</div>
                  <div className="text-[13px] text-[#717171] truncate">{n.subtitle}</div>
                </div>
                <button
              disabled={busy === n.key}
              onClick={() => act(n)}
              className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-[#FF385C] disabled:opacity-50">
                  {busy === n.key ? 'Working…' : n.action.label}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
          )}
          </div>
        }
      </div>

      {/* Who is coming and going, each row carrying its own cleaner. */}
      {board.length > 0 &&
      <div className="mb-6">
          <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
            Today and tomorrow
          </div>
          <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {board.map((b, idx) =>
          <div
            key={b.key}
            className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
            b.kind === 'in' ? 'bg-[#00A6991A] text-[#00A699]' : 'bg-[#E8913A1A] text-[#E8913A]'}`}>
                  {b.kind === 'in' ?
              <LogIn className="w-[14px] h-[14px]" strokeWidth={2.5} /> :
              <LogOut className="w-[14px] h-[14px]" strokeWidth={2.5} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-[#222222] truncate">{b.guest}</div>
                  <div className="text-[13px] text-[#717171] truncate">
                    {b.kind === 'in' ? 'Check-in' : 'Check-out'} · {b.when} · {b.property}
                  </div>
                </div>

                {/* The cleaner on the row itself, rather than a badge
                    computed somewhere else that could disagree with it. */}
                {b.kind === 'out' &&
            <div className="shrink-0 text-right">
                    {b.cleaner ?
              <span className="text-[13px] text-[#717171]">{cleanerLabel(b.cleaner)}</span> :

              <button
                onClick={() => onGoToDay && onGoToDay(b.property_id, b.date)}
                className="text-[13px] font-semibold text-[#FF385C]">
                        Nobody yet — assign
                      </button>
              }
                  </div>
            }
              </div>
          )}
          </div>
        </div>
      }
    </>);

}
