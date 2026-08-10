import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, Check, AlertCircle, ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';
import { PropertyRows, PropertyRow } from './PropertyRows';

/**
 * The home screen.
 *
 * It had nine sections. Three of them — a board of arrivals and
 * departures, a properties card, and a list of who was currently
 * staying — each answered a slice of "what is the state of my flats",
 * so you read three places and joined them up yourself. Two more,
 * "Upcoming" and "Today and tomorrow", were different-length windows
 * onto the same events. The remaining four were analysis: revenue,
 * occupancy, cancellations and holidays, which either live in the
 * Analytics tab already or belong nearer the dates they describe.
 *
 * What is left is three questions, in the order somebody asks them:
 *
 *   Needs you        what will go wrong if I do nothing
 *   Your properties  what state is each one in, right now
 *   Next 7 days      what is coming, and is somebody on it
 *
 * All three come from one call. Sections fetching their own data is how
 * this page came to contradict itself.
 */

interface Need {
  key: string;
  title: string;
  subtitle: string;
  action: {label: string;kind: string;property_id?: number;date?: string;block_id?: number;};
}

interface UpcomingRow {
  key: string;
  kind: 'in' | 'out';
  when: string;
  date: string;
  guest: string;
  property: string;
  property_id: number;
  cleaner: {name: string;status: string;} | null;
}

/**
 * When it happens, as a sentence.
 *
 * The label and the verb were concatenated, so a departure that had
 * already happened read "Leaves already left" — the relative time is
 * sometimes a phrase in its own right and cannot always take a prefix.
 */
const phrase = (b: UpcomingRow) => {
  if (b.when === 'already left') return 'Already left';
  return `${b.kind === 'in' ? 'Arrives' : 'Leaves'} ${b.when}`;
};

const cleanerLabel = (c: UpcomingRow['cleaner']) => {
  if (!c) return null;
  if (c.status === 'pending') return `${c.name} · not answered yet`;
  if (c.status === 'completed') return `${c.name} · done`;
  if (c.status === 'in_progress') return `${c.name} · on site`;
  return `${c.name} · accepted`;
};

export function TodayPanel({ onGoToDay, onNeedsChange }: {
  onGoToDay?: (propertyId: number, date: string) => void;
  /** How many things need somebody, for the tab badge. */
  onNeedsChange?: (count: number | null) => void;
}) {
  const [needs, setNeeds] = useState<Need[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);

  const load = async () => {
    try {
      const data = await apiGet<{
        needs: Need[];properties: PropertyRow[];upcoming: UpcomingRow[];
      }>('/api/dashboard/today');
      setNeeds(data.needs || []);
      setProperties(data.properties || []);
      setUpcoming(data.upcoming || []);
      setFailed(false);
    } catch (e) {
      // A 401 has already sent us back to the sign-in screen. Anything
      // else means we do not know what needs doing — which is not the
      // same as nothing needing doing, and must not be drawn as a tick.
      if (!(e instanceof Unauthorized)) setFailed(true);
    }
  };

  useEffect(() => { load(); }, []);

  // The badge counts what is on the screen, because it reads the same
  // state the list renders.
  useEffect(() => {
    if (onNeedsChange) onNeedsChange(failed ? null : needs.length);
  }, [needs, failed, onNeedsChange]);

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
      {/* 1. What will go wrong if you do nothing. */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Needs you
        </div>

        {error && <p className="mb-2 text-[13px] text-[#991B1B]">{error}</p>}

        {failed ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] text-[#222222] flex-1">Could not load what needs you.</span>
            <button
            onClick={() => load()}
            className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-[#FF385C]">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div> :

        needs.length === 0 ?
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

      {/* 2. The state of each property, one row each. */}
      {!failed && <PropertyRows rows={properties} onChanged={load} />}

      {/* 3. What is coming. Seven days, because two was not long enough
             to arrange a cleaner around. */}
      {!failed &&
      <div className="mb-6">
          <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
            Next 7 days
          </div>
          <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {upcoming.length === 0 ?
          <div className="px-4 py-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#B0B0B0]" />
                <span className="text-[14px] text-[#717171]">Nothing arriving or leaving this week.</span>
              </div> :

          upcoming.map((b, idx) =>
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
                      {phrase(b)} · {b.property}
                    </div>
                  </div>

                  {/* The cleaner on the row itself, rather than a badge
                      computed somewhere else that could disagree. */}
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
