import React, { useEffect, useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { MonthCalendar } from './MonthCalendar';

/**
 * When this cleaner can actually work — and setting it, when they cannot.
 *
 * The weekly schedule is what they usually do. It is not what they are
 * doing. Somebody who works Mondays can still have said no to the 24th,
 * and the grid this replaces drew the pattern alone — green ticks on days
 * people had booked off. Trusting it meant assigning work to somebody who
 * had already declined the day.
 *
 * Same grid the cleaner sees in their own app, and the same three marks:
 * a ring for free, a tick for booked, the date struck through for a day
 * they are not working. Two people looking at one person's availability
 * should be looking at the same picture.
 *
 * Tapping a day sets it. The cleaner has always been able to do this
 * from their own app; the manager could only read it. So a cleaner who
 * said on the phone that they could not do the 14th left the manager
 * with nowhere to put that — the grid went on showing them free, and
 * assignment went on offering them.
 *
 * Two buttons rather than one, because toggling is not undoing. An
 * override wins outright, hours included, so a day switched off and on
 * again reads as a blanket yes and would offer somebody an afternoon
 * they do not work. "Back to their usual" is the one that takes it back.
 */

interface Day {state: 'free' | 'off' | 'booked';why: string;override?: boolean;}
interface Job {
  id: number;cleaning_date: string;start_time: string;end_time: string;
  status: string;property_name: string;reason: string | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Monday first, because that is how a working week is read.
 *
 * The database keys days the way JavaScript does, Sunday at 0, and that
 * stays the wire format — this is only the order they are shown in.
 */
const WEEK = [
  { dow: 1, label: 'Mon' }, { dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' }, { dow: 5, label: 'Fri' }, { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
];

const pretty = (d: string) =>
new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });

export function CleanerDetailSheet({
  cleanerId, cleanerName, onClose,
}: {
  cleanerId: number;
  cleanerName: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState<Record<string, Day>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [schedule, setSchedule] = useState<{day_of_week: number;start_time: string;end_time: string;}[]>([]);
  const [loading, setLoading] = useState(true);
  /** The day being set, if any. */
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Whether the weekly pattern is being changed, and to what. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<number, {on: boolean;start: string;end: string;}>>({});

  const load = React.useCallback(async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(`/api/cleaners/${cleanerId}/calendar?from=${from}&to=${to}`, {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const d = await res.json();
      setDays(d.days || {});
      setJobs(d.jobs || []);
      setSchedule(d.schedule || []);
    }
    setLoading(false);
  }, [cleanerId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Set the day, or hand it back to their weekly pattern.
   *
   * The grid is redrawn from the server rather than patched here: the
   * answer depends on the pattern, the override and any job on the day,
   * and a second opinion computed in the browser is how two screens
   * start disagreeing about who is free.
   */
  const setDay = async (date: string, available: boolean | null) => {
    setSaving(true);
    setError('');
    const res = available === null ?
    await fetch(`/api/cleaners/${cleanerId}/overrides?date=${date}`, {
      method: 'DELETE', credentials: 'same-origin',
    }) :
    await fetch(`/api/cleaners/${cleanerId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ date, available }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not save that');
      return;
    }
    await load();
    setPicked(null);
  };

  /**
   * Change the days they usually work.
   *
   * The pattern is what every day on the grid is measured against — a
   * day is an exception only by differing from it — so leaving it
   * read-only made the count above unfalsifiable. It also stranded
   * anyone who does not use the app: their pattern could be set on the
   * day they were added and never again, leaving the manager to override
   * every single date instead.
   *
   * The whole week is sent, including the days switched off, because the
   * server replaces rather than merges. Sending only the ticked days
   * would be the same request.
   */
  const saveSchedule = async () => {
    setSaving(true);
    setError('');
    const res = await fetch(`/api/cleaners/${cleanerId}/availability`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        schedule: WEEK.
        filter((d) => draft[d.dow]?.on).
        map((d) => ({
          day_of_week: d.dow,
          start_time: draft[d.dow].start,
          end_time: draft[d.dow].end,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not save those days');
      return;
    }
    await load();
    setEditing(false);
  };

  /** A Date as the key everything else here is keyed by. */
  const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /** What they are already down for on a day. */
  const jobsOn = (date: string) => jobs.filter((j) => j.cleaning_date === date);

  // MonthCalendar takes the states keyed by date, exactly as the cleaner's
  // own app passes them.
  const dayStates: Record<string, 'off' | 'free' | 'booked'> = {};
  Object.entries(days).forEach(([k, v]) => { dayStates[k] = v.state; });

  const usual = schedule.length ?
  schedule.map((r) => DAY_NAMES[r.day_of_week]).join(', ') :
  'No weekly pattern set';

  // Days they have changed their mind about, which is the whole reason to
  // look at a calendar rather than a schedule.
  const exceptions = Object.entries(days).filter(([date, d]) => {
    const dow = new Date(date + 'T00:00:00').getDay();
    const usualDay = schedule.some((r) => r.day_of_week === dow);
    return d.state === 'off' ? usualDay : d.state === 'free' ? !usualDay : false;
  });

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      max-h-[88vh] overflow-y-auto
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[520px] sm:rounded-2xl sm:pb-5 sm:max-h-[85vh]">

        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[18px] font-semibold">{cleanerName}</p>
            <p className="text-[13px] text-[#717171]">
              Usually works {usual}
              {/* Editable, because every day below is measured against
                  it — and somebody who does not use the app has no other
                  way for theirs to be set. */}
              {' · '}
              <button
                onClick={() => {
                  const next: Record<number, {on: boolean;start: string;end: string;}> = {};
                  for (const d of WEEK) {
                    const row = schedule.find((r) => r.day_of_week === d.dow);
                    next[d.dow] = {
                      on: Boolean(row),
                      start: row ? row.start_time : '09:00',
                      end: row ? row.end_time : '17:00',
                    };
                  }
                  setDraft(next);
                  setEditing(!editing);
                  setError('');
                }}
                className="font-semibold text-[#FF385C]">
                {editing ? 'Cancel' : 'Change'}
              </button>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        {editing &&
        <div className="mt-3 border border-[#EBEBEB] rounded-[8px] p-3">
            <p className="text-[12px] text-[#717171] mb-2">
              The days they normally work. Individual dates are still set on the calendar below.
            </p>
            {WEEK.map((d) =>
          <div key={d.dow} className="flex items-center gap-2 py-1">
                <button
              role="switch"
              aria-checked={Boolean(draft[d.dow]?.on)}
              aria-label={d.label}
              onClick={() => setDraft({ ...draft, [d.dow]: { ...draft[d.dow], on: !draft[d.dow]?.on } })}
              className={`w-[38px] h-[22px] shrink-0 rounded-full ${
              draft[d.dow]?.on ? 'bg-[#0F6E56]' : 'bg-[#DDDDDD]'}`}>
                  <span className={`block w-[16px] h-[16px] bg-white rounded-full transition-transform ${
              draft[d.dow]?.on ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                </button>
                <span className="w-[34px] shrink-0 text-[13px]">{d.label}</span>
                {draft[d.dow]?.on ?
            <>
                    <input
                type="time" value={draft[d.dow].start}
                aria-label={`${d.label} start`}
                onChange={(e) => setDraft({ ...draft, [d.dow]: { ...draft[d.dow], start: e.target.value } })}
                className="px-2 py-1 border border-[#DDDDDD] rounded-[6px] text-[13px]" />
                    <span className="text-[12px] text-[#717171]">to</span>
                    <input
                type="time" value={draft[d.dow].end}
                aria-label={`${d.label} end`}
                onChange={(e) => setDraft({ ...draft, [d.dow]: { ...draft[d.dow], end: e.target.value } })}
                className="px-2 py-1 border border-[#DDDDDD] rounded-[6px] text-[13px]" />
                  </> :

            <span className="text-[13px] text-[#B0B0B0]">not working</span>
            }
              </div>
          )}
            <button
            onClick={saveSchedule}
            disabled={saving}
            className="mt-2 w-full h-[38px] rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save their usual days'}
            </button>
            <p className="text-[12px] text-[#717171] mt-2">
              They are told when you change this.
            </p>
          </div>
        }

        {/* The point of the screen, said in a line. */}
        {exceptions.length > 0 &&
        <p className="text-[13px] text-[#92400E] bg-[#FFFBEB] border border-[#F0C36D] rounded-[8px] px-3 py-2 mt-3">
            {exceptions.length} day{exceptions.length === 1 ? '' : 's'} differ from that pattern in the next
            three months — the calendar below is what counts.
          </p>
        }

        {loading && <p className="text-[13px] text-[#717171] mt-4">Loading…</p>}

        {!loading &&
        <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 mb-2 text-[12px] text-[#717171]">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-[1.5px] border-[#B0B0B0]" /> Free
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-[#0F6E56]" strokeWidth={3} /> Working
              </span>
              <span className="flex items-center gap-1.5">
                <span className="line-through text-[#8A8A8A]">00</span> Not available
              </span>
            </div>

            <MonthCalendar
            propertyId={0}
            bookings={[]}
            onBookingClick={() => {}}
            months={3}
            dayStates={dayStates}
            onDayClick={(d) => {
              setError('');
              setPicked(dateKey(d));
            }}
            plainBars />

            {error && <p className="mt-3 text-[13px] text-[#991B1B]">{error}</p>}

            {/* The day being set. Everything about it is stated before
                the buttons — which day, what it is now, and whether
                anybody is relying on them for it. */}
            {picked && days[picked] &&
          <div className="mt-4 border border-[#DDDDDD] rounded-[10px] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[14px] font-medium">{pretty(picked)}</p>
                  <button
                onClick={() => setPicked(null)}
                className="text-[12px] text-[#717171] underline underline-offset-2">
                    Close
                  </button>
                </div>

                <p className="text-[13px] text-[#717171] mt-0.5">
                  {days[picked].state === 'booked' ? 'Booked to clean' :
              days[picked].state === 'free' ? 'Available' : 'Not available'}
                  {' · '}
                  {days[picked].override ?
              'you or they set this day' :
              'from their usual weekly pattern'}
                </p>

                {/* Taking somebody off a day does not take the day's
                    work off them. Said here, where the decision is,
                    rather than discovered later by an empty flat. */}
                {jobsOn(picked).length > 0 &&
            <div className="mt-2 flex items-start gap-1.5 text-[13px] text-[#92400E] bg-[#FFFBEB] border border-[#F0C36D] rounded-[8px] px-2.5 py-2">
                    <AlertCircle className="w-4 h-4 text-[#BA7517] shrink-0 mt-px" />
                    <span>
                      Still down to clean {jobsOn(picked).map((j) => j.property_name).join(' and ')} that day.
                      Marking them off does not cancel it.
                    </span>
                  </div>
            }

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                disabled={saving}
                onClick={() => setDay(picked, days[picked].state === 'off' ? true : false)}
                className={`px-3 py-2 rounded-[8px] text-[13px] font-semibold disabled:opacity-50 ${
                days[picked].state === 'off' ?
                'bg-[#222222] text-white' :
                'border border-[#DDDDDD] text-[#222222]'}`}>
                    {saving ? 'Saving…' :
                days[picked].state === 'off' ?
                `Mark ${cleanerName} available` :
                `Mark ${cleanerName} not available`}
                  </button>

                  {/* Only where there is something to take back. */}
                  {days[picked].override &&
              <button
                disabled={saving}
                onClick={() => setDay(picked, null)}
                className="px-3 py-2 rounded-[8px] text-[13px] font-semibold border border-[#DDDDDD] text-[#222222] disabled:opacity-50">
                      Back to their usual
                    </button>
              }
                </div>

                <p className="text-[12px] text-[#717171] mt-2">
                  They are told when this changes what they can work.
                </p>
              </div>
          }

            {jobs.length > 0 &&
          <div className="mt-5">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
                  Coming up
                </p>
                {jobs.slice(0, 8).map((j) =>
            <div key={j.id} className="flex items-baseline gap-2 py-1.5 border-b border-[#F0F0F0] last:border-0">
                    <span className="text-[13px] text-[#717171] w-[110px] shrink-0">
                      {pretty(j.cleaning_date)}
                    </span>
                    <span className="text-[14px] flex-1 min-w-0 truncate">{j.property_name}</span>
                    <span className="text-[13px] text-[#717171] shrink-0">
                      {j.status === 'pending' ? 'not answered' : j.start_time}
                    </span>
                  </div>
            )}
              </div>
          }
          </>
        }
      </div>
    </>);

}
