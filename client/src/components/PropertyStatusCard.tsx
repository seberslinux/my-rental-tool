import React, { useEffect, useState } from 'react';
import { Check, AlertCircle, Sparkles, User, Clock } from 'lucide-react';

/**
 * Is each property clean, and if not, when will it be.
 *
 * The home screen's "Next 48 hours" block has carried a comment since it
 * was written saying it shows "arrivals, departures and whether the
 * property is ready". It showed the first two. The third — the thing you
 * actually want to know before answering an enquiry — was never built.
 *
 * The status is computed from the same jobs and stays the planner reads,
 * so what is on the screen and what the assignment does can never
 * disagree. A manager can correct it, and that correction feeds the same
 * calculation rather than overriding it from the side.
 */

interface Block {
  id: number;
  from: string;
  to: string;
  reason: string;
  can_release: boolean;
}

interface Status {
  id: number;
  name: string;
  status: 'ready' | 'stale' | 'dirty' | 'occupied' | 'cleaning';
  detail: string;
  cleanSince: string | null;
  readyUntil: string | null;
  next_clean: string | null;
  blocks: Block[];
}

const LOOK: Record<Status['status'], {label: string;tone: string;Icon: any;}> = {
  ready: { label: 'Ready', tone: 'bg-[#EAF4F0] text-[#0F6E56]', Icon: Check },
  stale: { label: 'Needs a freshen', tone: 'bg-[#FAEEDA] text-[#854F0B]', Icon: Sparkles },
  dirty: { label: 'Needs cleaning', tone: 'bg-[#FCEBEB] text-[#A32D2D]', Icon: AlertCircle },
  occupied: { label: 'Occupied', tone: 'bg-[#F0F0F0] text-[#717171]', Icon: User },
  cleaning: { label: 'Being cleaned', tone: 'bg-[#E6F1FB] text-[#185FA5]', Icon: Clock },
};

const pretty = (d: string | null) =>
d ? new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

export function PropertyStatusCard() {
  const [rows, setRows] = useState<Status[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/properties/cleaning-status', { credentials: 'same-origin' });
    if (res.ok) setRows(await res.json());
  };

  useEffect(() => { load(); }, []);

  const mark = async (id: number, dirty: boolean) => {
    setBusy(id);
    setError('');
    const res = await fetch(`/api/properties/${id}/mark-clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ dirty }),
    });
    setBusy(null);
    if (!res.ok) return setError('Could not save that');
    load();
  };

  const release = async (propertyId: number, block: Block) => {
    setBusy(propertyId);
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/block/${block.id}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not put those nights back');
      return;
    }
    load();
  };

  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
        Properties
      </div>
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
        {error && <p className="px-4 pt-3 text-[13px] text-[#991B1B]">{error}</p>}

        {rows.map((r, idx) => {
          const look = LOOK[r.status] || LOOK.dirty;
          return (
            <div key={r.id} className={`px-4 py-3 ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
              <div className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${look.tone}`}>
                  <look.Icon className="w-[15px] h-[15px]" strokeWidth={2.25} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-[#222222] truncate">{r.name}</div>
                  <div className="text-[13px] text-[#717171] truncate">
                    {look.label} · {r.detail}
                    {/* Only worth saying when somebody is actually coming
                        and the property is not fine already. */}
                    {r.next_clean && r.status !== 'ready' && r.status !== 'cleaning' &&
                    <span> · cleaner {pretty(r.next_clean)}</span>
                    }
                  </div>
                </div>

                {/* The manager's own eyes. Offered where it changes the
                    answer: saying a dirty property is clean, or a clean
                    one is not. */}
                {r.status !== 'occupied' && r.status !== 'cleaning' &&
                <button
                  disabled={busy === r.id}
                  onClick={() => mark(r.id, r.status === 'ready' || r.status === 'stale')}
                  className="shrink-0 px-2.5 py-1.5 text-[12px] font-semibold rounded-[6px] border border-[#DDDDDD] hover:bg-[#F7F7F7] disabled:opacity-50">
                    {r.status === 'ready' || r.status === 'stale' ? 'Not clean' : 'It is clean'}
                  </button>
                }
              </div>

              {/* Nights taken off sale, and the way back. */}
              {r.blocks.map((b) =>
              <div key={b.id} className="mt-2 ml-10 flex items-center gap-2 text-[13px] text-[#92400E] bg-[#FFFBEB] border border-[#F0C36D] rounded-[8px] px-3 py-2">
                  <span className="flex-1 min-w-0">
                    Off sale {pretty(b.from)}{b.to && b.to !== b.from ? ` – ${pretty(b.to)}` : ''}
                    {b.reason ? ` · ${b.reason}` : ''}
                  </span>
                  {b.can_release ?
                <button
                  disabled={busy === r.id}
                  onClick={() => release(r.id, b)}
                  className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50">
                      Put back on sale
                    </button> :

                <span className="shrink-0 text-[#717171]">Remove in Smoobu</span>
                }
                </div>
              )}
            </div>);

        })}
      </div>
    </div>);

}
