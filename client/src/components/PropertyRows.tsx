import React, { useState } from 'react';
import { Check, AlertCircle, Sparkles, User, Clock, CalendarX, RefreshCw } from 'lucide-react';

/**
 * One row per property: what state it is in, who is in it, and who is
 * cleaning it next.
 *
 * Three sections used to answer a slice of this each. "Today and
 * tomorrow" listed arrivals and departures, "Properties" said clean or
 * dirty, and "Currently staying" gave the guest and the platform — so
 * three readings, a page apart, that you had to hold together yourself
 * to know the state of one flat. They are one fact, so they are one row.
 *
 * Presentational: the rows arrive already worked out, from the same call
 * that builds the rest of the page. It used to fetch its own, which is
 * how the page ended up with two ideas of what was clean.
 */

export interface Block {
  id: number;from: string;to: string;reason: string;can_release: boolean;
}

export interface PropertyRow {
  id: number;
  name: string;
  status: 'ready' | 'stale' | 'dirty' | 'occupied' | 'cleaning';
  detail: string;
  guest: {name: string;until: string;leaving_today: boolean;} | null;
  cleaner: {name: string | null;date: string;status: string;} | null;
  next_arrival: {name: string;date: string;} | null;
  blocks: Block[];
}

const LOOK: Record<PropertyRow['status'], {label: string;tone: string;Icon: any;}> = {
  ready: { label: 'Ready', tone: 'bg-[#EAF4F0] text-[#0F6E56]', Icon: Check },
  stale: { label: 'Needs a freshen', tone: 'bg-[#FAEEDA] text-[#854F0B]', Icon: Sparkles },
  dirty: { label: 'Needs cleaning', tone: 'bg-[#FCEBEB] text-[#A32D2D]', Icon: AlertCircle },
  occupied: { label: 'Occupied', tone: 'bg-[#F0F0F0] text-[#717171]', Icon: User },
  cleaning: { label: 'Being cleaned', tone: 'bg-[#E6F1FB] text-[#185FA5]', Icon: Clock },
};

const pretty = (d: string | null) =>
d ? new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

/** The one line under the name, built from what is true rather than from a template. */
function summarise(r: PropertyRow): string {
  const parts: string[] = [LOOK[r.status]?.label || ''];

  if (r.guest) {
    parts.push(r.guest.leaving_today ?
    `${r.guest.name} leaves today` :
    `${r.guest.name} until ${pretty(r.guest.until)}`);
  } else if (r.next_arrival) {
    parts.push(`${r.next_arrival.name} arrives ${pretty(r.next_arrival.date)}`);
  }

  // Only worth saying when it is not already obvious from the state.
  if (r.cleaner && r.status !== 'ready' && r.status !== 'cleaning') {
    parts.push(r.cleaner.name ?
    `${r.cleaner.name} cleans ${pretty(r.cleaner.date)}` :
    `nobody cleaning yet`);
  }

  return parts.filter(Boolean).join(' · ');
}

export function PropertyRows({
  rows, onChanged,
}: {
  rows: PropertyRow[];
  /** Re-read the page after a change, so nothing here goes stale. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [blocking, setBlocking] = useState<number | null>(null);
  const [range, setRange] = useState<{from: string;to: string;}>({ from: '', to: '' });

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
    onChanged();
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
    onChanged();
  };

  const block = async (propertyId: number) => {
    if (!range.from || !range.to) return;
    setBusy(propertyId);
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ...range, reason: 'Blocked by the manager' }),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not block those nights');
      return;
    }
    setBlocking(null);
    setRange({ from: '', to: '' });
    onChanged();
  };

  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
        Your properties
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
                  <div className="text-[13px] text-[#717171] truncate">{summarise(r)}</div>
                </div>

                {/* The manager's own eyes, where it changes the answer. */}
                {r.status !== 'occupied' && r.status !== 'cleaning' &&
                <button
                  disabled={busy === r.id}
                  onClick={() => mark(r.id, r.status === 'ready' || r.status === 'stale')}
                  className="shrink-0 px-2.5 py-1.5 text-[12px] font-semibold rounded-[6px] border border-[#DDDDDD] hover:bg-[#F7F7F7] disabled:opacity-50">
                    {r.status === 'ready' || r.status === 'stale' ? 'Not clean' : 'It is clean'}
                  </button>
                }

                <button
                  onClick={() => setBlocking(blocking === r.id ? null : r.id)}
                  aria-label={`Take nights off sale at ${r.name}`}
                  className="shrink-0 p-1.5 rounded-[6px] border border-[#DDDDDD] text-[#717171] hover:bg-[#F7F7F7]">
                  <CalendarX className="w-4 h-4" />
                </button>
              </div>

              {blocking === r.id &&
              <div className="mt-2 ml-10 flex flex-wrap items-center gap-2">
                  <input
                  type="date"
                  value={range.from}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setRange({ ...range, from: e.target.value })}
                  aria-label="First night off sale"
                  className="px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px]" />
                  <span className="text-[13px] text-[#717171]">to</span>
                  <input
                  type="date"
                  value={range.to}
                  min={range.from || new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setRange({ ...range, to: e.target.value })}
                  aria-label="Last night off sale"
                  className="px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px]" />
                  <button
                  disabled={busy === r.id || !range.from || !range.to}
                  onClick={() => block(r.id)}
                  className="px-3 py-1.5 rounded-[6px] bg-[#222222] text-white text-[12px] font-semibold disabled:opacity-40">
                    {busy === r.id ? 'Blocking…' : 'Take off sale'}
                  </button>
                </div>
              }

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
