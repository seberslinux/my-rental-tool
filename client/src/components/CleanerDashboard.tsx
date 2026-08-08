import React, { useCallback, useEffect, useState } from 'react';
import { MonthCalendar } from './MonthCalendar';
import { Booking, bookings as sharedBookings, properties as sharedProperties, loadCleanerCalendarData } from '../data/properties';
import {
  Home, LogOut, MapPin, Clock, Users, Check, X, Play, Square,
  ClipboardList, CalendarDays, CalendarRange, Wrench, ShoppingCart, MessageSquare,
  ChevronLeft, ChevronRight } from
'lucide-react';

/**
 * The cleaner's app.
 *
 * Everything here is theirs: their jobs, their hours, their availability,
 * what they need ordered and what they found broken. Nothing reports
 * money, and no guest is named — a cleaner needs to know how many people
 * are arriving and when, not who they are or what they paid.
 *
 * Most of these endpoints already existed on the server with no way to
 * reach them. The exceptions are check-in/check-out, declining a job, and
 * requesting supplies, which the API refused to a PIN session outright.
 */

type Tab = 'jobs' | 'calendar' | 'availability' | 'report';

interface Job {
  id: number;
  property_id: number;
  property_name: string;
  property_address: string | null;
  cleaning_date: string;
  start_time: string;
  end_time: string;
  status: string;
  num_guests: number | null;
  special_requirements: string | null;
  check_in: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** A stay, as the portal receives it — the server sends no money. */
interface Stay {
  id: number;
  property_id: number;
  property_name: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  num_guests: number | null;
  children: number | null;
  special_requirements: string | null;
}

interface ChecklistItem {
  id: number;
  item_name: string;
  category: string;
  expected_quantity: number;
  actual_quantity?: number | null;
  status?: string | null;
}

const DAYS = [
  { label: 'Mon', dow: 1 }, { label: 'Tue', dow: 2 }, { label: 'Wed', dow: 3 },
  { label: 'Thu', dow: 4 }, { label: 'Fri', dow: 5 }, { label: 'Sat', dow: 6 },
  { label: 'Sun', dow: 0 },
];

const iso = (d: Date) =>
`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const post = (url: string, body?: any) =>
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: body ? JSON.stringify(body) : undefined,
});

function Checklist({ job, onClose }: {job: Job;onClose: () => void;}) {
    const [items, setItems] = useState<ChecklistItem[]>([]);
    const [state, setState] = useState<Record<number, {ok: boolean;qty: number;}>>({});
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
      (async () => {
        const res = await fetch(`/api/cleaner-portal/jobs/${job.id}/checklist`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const data: ChecklistItem[] = await res.json();
        setItems(data);
        const next: Record<number, {ok: boolean;qty: number;}> = {};
        data.forEach((i) => {
          next[i.id] = {
            ok: i.status ? i.status === 'ok' : true,
            qty: i.actual_quantity ?? i.expected_quantity ?? 0,
          };
        });
        setState(next);
      })();
    }, [job.id]);

    const save = async () => {
      setSaving(true);
      const res = await post('/api/cleaner-portal/inventory/check', {
        cleaning_job_id: job.id,
        items: items.map((i) => ({
          checklist_item_id: i.id,
          actual_quantity: state[i.id]?.qty ?? 0,
          status: state[i.id]?.ok ? 'ok' : 'missing',
        })),
      });
      setSaving(false);
      setMsg(res.ok ? 'Saved' : 'Could not save');
    };

    return (
      <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#EBEBEB] px-4 py-3 flex items-center gap-2">
          <button onClick={onClose} aria-label="Back" className="p-1.5 -ml-1.5 rounded-full hover:bg-[#F7F7F7]">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold truncate">{job.property_name}</p>
            <p className="text-[12px] text-[#717171]">Inventory check</p>
          </div>
        </div>

        <div className="p-4 max-w-[560px] mx-auto">
          {items.length === 0 &&
          <p className="text-[14px] text-[#717171]">
              No checklist has been set up for this property yet.
            </p>
          }

          {items.map((i) =>
          <div key={i.id} className="flex items-center gap-3 py-3 border-b border-[#F0F0F0]">
              <button
              onClick={() => setState({ ...state, [i.id]: { ...state[i.id], ok: !state[i.id]?.ok } })}
              aria-label={state[i.id]?.ok ? 'Mark missing' : 'Mark present'}
              className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center border ${
              state[i.id]?.ok ? 'bg-[#0F6E56] border-[#0F6E56] text-white' : 'border-[#DDDDDD] text-[#DDDDDD]'}`
              }>
                <Check className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] truncate">{i.item_name}</p>
                <p className="text-[12px] text-[#717171]">{i.category} · expected {i.expected_quantity}</p>
              </div>
              <input
              type="number"
              inputMode="numeric"
              value={state[i.id]?.qty ?? 0}
              onChange={(e) => setState({ ...state, [i.id]: { ...state[i.id], qty: Number(e.target.value) } })}
              className="w-[64px] shrink-0 px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[14px] text-center tabular-nums" />
            </div>
          )}

          {items.length > 0 &&
          <button
            onClick={save}
            disabled={saving}
            className="mt-4 w-full h-[44px] bg-[#222222] text-white rounded-[8px] text-[14px] font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : msg || 'Save check'}
            </button>
          }
        </div>
      </div>);

  }

function Report({ properties, onError }: {properties: {id: number;name: string;}[];onError: (m: string) => void;}) {
    const [kind, setKind] = useState<'maintenance' | 'supplies' | 'note'>('maintenance');
    const [propertyId, setPropertyId] = useState<number | ''>(properties[0]?.id ?? '');
    const [title, setTitle] = useState('');
    const [detail, setDetail] = useState('');
    const [sent, setSent] = useState('');

    const submit = async () => {
      if (!title.trim()) return;
      // "Anything" rides the maintenance route with its own category —
      // a cleaner should never have to work out which box a thing goes
      // in before they can say it. The owner sees all of them together.
      const res = kind === 'supplies' ?
      await post('/api/cleaner-portal/shopping-list', {
        property_id: propertyId || null, item_name: title, notes: detail,
      }) :
      await post('/api/cleaner-portal/maintenance', {
        property_id: propertyId,
        title,
        description: detail,
        category: kind === 'note' ? 'Note from cleaner' : 'Reported by cleaner',
        priority: kind === 'note' ? 'low' : 'medium',
      });
      if (res.ok) {
        setSent(kind === 'supplies' ? 'Added to the shopping list.' : 'Sent. The owner can see it.');
        setTitle(''); setDetail('');
      } else {
        const d = await res.json().catch(() => ({}));
        onError(d.error || 'Could not send that');
      }
    };

    return (
      <div className="bg-white rounded-[12px] border border-[#EBEBEB] p-4">
        <div className="flex gap-2 mb-4">
          {([
          ['maintenance', 'Broken', Wrench],
          ['supplies', 'Supplies', ShoppingCart],
          ['note', 'Anything', MessageSquare]] as const).
          map(([k, label, Icon]) =>
          <button
            key={k}
            onClick={() => { setKind(k); setSent(''); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-[13px] font-semibold border ${
            kind === k ? 'bg-[#222222] text-white border-[#222222]' : 'border-[#DDDDDD] text-[#222222]'}`
            }>
              <Icon className="w-4 h-4" /> {label}
            </button>
          )}
        </div>

        {properties.length > 1 &&
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(Number(e.target.value))}
          className="w-full h-[44px] px-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px]">
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        }

        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setSent(''); }}
          placeholder={
          kind === 'maintenance' ? 'What is broken?' :
          kind === 'supplies' ? 'What do you need?' :
          'What would you like to tell the owner?'}
          className="w-full h-[44px] px-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px]" />

        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Anything else worth knowing (optional)"
          className="w-full h-[88px] p-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px] resize-none" />

        {sent && <p className="text-[13px] text-[#0F6E56] mb-3">{sent}</p>}

        <button
          onClick={submit}
          disabled={!title.trim()}
          className="w-full h-[44px] bg-[#222222] text-white rounded-[8px] text-[14px] font-semibold disabled:opacity-40">
          Send
        </button>
      </div>);

  }

export function CleanerDashboard({ onSignOut }: {onSignOut: () => void;}) {
  const [tab, setTab] = useState<Tab>('jobs');
  const [name, setName] = useState('');
  const [properties, setProperties] = useState<{id: number;name: string;}[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [schedule, setSchedule] = useState<Record<number, {on: boolean;start: string;end: string;}>>({});
  // What the server currently holds, so the Save button can tell the
  // difference between "not saved yet" and "nothing to save".
  const [savedSchedule, setSavedSchedule] = useState<Record<number, {on: boolean;start: string;end: string;}>>({});
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  // 0 = every property. A cleaner working two places wants "when does The
  // loft need me" without reading past the other one.
  const [propFilter, setPropFilter] = useState<number>(0);
  const [pickedStay, setPickedStay] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // Exceptions to the weekly pattern, keyed YYYY-MM-DD -> can work.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetNote, setResetNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [meRes, jobsRes, staysRes] = await Promise.all([
        fetch('/api/cleaner-portal/me', { credentials: 'same-origin' }),
        fetch('/api/cleaner-portal/jobs', { credentials: 'same-origin' }),
        fetch('/api/cleaner-portal/bookings', { credentials: 'same-origin' }),
      ]);
      if (staysRes.ok) setStays(await staysRes.json());
      if (meRes.ok) {
        const me = await meRes.json();
        setName(me.name || '');
        setProperties(me.properties || []);
        const next: Record<number, {on: boolean;start: string;end: string;}> = {};
        DAYS.forEach((d) => { next[d.dow] = { on: false, start: '09:00', end: '17:00' }; });
        (me.availability || []).forEach((a: any) => {
          next[a.day_of_week] = { on: true, start: a.start_time, end: a.end_time };
        });
        setSchedule(next);
        setSavedSchedule(next);
        const ov: Record<string, boolean> = {};
        (me.overrides || []).forEach((o: any) => {
          ov[String(o.date).slice(0, 10)] = !!o.available;
        });
        setOverrides(ov);
      }
      if (!jobsRes.ok) throw new Error('Could not load your jobs');
      setJobs(await jobsRes.json());
      // Fills the same module state the app's calendar reads.
      await loadCleanerCalendarData();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (jobId: number, fn: () => Promise<Response>) => {
    setBusy(jobId);
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'That did not work');
      }
      await load();
      setOpenJob(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const todayStr = iso(new Date());
  // Declined jobs disappear everywhere: having said no, a cleaner should
  // not keep seeing it on their own calendar.
  const mine = jobs.filter((j) => j.status !== 'declined');
  const visible = propFilter ? mine.filter((j) => j.property_id === propFilter) : mine;
  const visibleStays = propFilter ? stays.filter((b) => b.property_id === propFilter) : stays;
  const upcoming = visible
    .filter((j) => j.cleaning_date >= todayStr)
    .sort((a, b) => a.cleaning_date.localeCompare(b.cleaning_date));

  const dayLabel = (date: string) => {
    const d = new Date(date + 'T00:00:00');
    const diff = Math.round((d.getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'short' });
  };

  const fmtDay = (date: string) =>
  new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });

  const fmtTime = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';

  // --- job card ----------------------------------------------------------

  const JobCard = ({ job }: {job: Job;}) => {
    const working = !!job.started_at && !job.completed_at;
    const done = !!job.completed_at;
    const undecided = job.status === 'pending';

    return (
      <div className="bg-white rounded-[12px] border border-[#EBEBEB] p-4 mb-3">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <p className="text-[16px] font-semibold truncate">{job.property_name}</p>
            {job.property_address &&
            <p className="text-[13px] text-[#717171] flex items-center gap-1 mt-0.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{job.property_address}</span>
              </p>
            }
            <p className="text-[14px] mt-1.5 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#717171]" />
              {job.start_time}–{job.end_time}
            </p>
          </div>
          {done &&
          <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full bg-[#E7F7F1] text-[#0F6E56] uppercase">
              Done
            </span>
          }
          {working &&
          <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full bg-[#FFF4E5] text-[#92400E] uppercase">
              In progress
            </span>
          }
        </div>

        {/* How many people are arriving, and when. Never who they are.
            "same day", not "today": the card is also rendered from the
            calendar, where the day being looked at is usually not this
            one, and "today" was then simply false. */}
        {job.check_in === job.cleaning_date &&
        <p className="mt-2 text-[13px] text-[#C13515] flex items-center gap-1.5">
            <Users className="w-4 h-4 shrink-0" />
            Guests arrive same day{job.num_guests ? ` · ${job.num_guests} people` : ''}
          </p>
        }

        {job.special_requirements &&
        <p className="mt-2 text-[13px] bg-[#F7F7F7] rounded-[8px] px-3 py-2">
            {job.special_requirements}
          </p>
        }

        {(job.started_at || job.completed_at) &&
        <p className="mt-2 text-[12px] text-[#717171] tabular-nums">
            {job.started_at && `Started ${fmtTime(job.started_at)}`}
            {job.completed_at && ` · Finished ${fmtTime(job.completed_at)}`}
          </p>
        }

        <div className="flex flex-wrap gap-2 mt-3">
          {undecided &&
          <>
              <button
              disabled={busy === job.id}
              onClick={() => act(job.id, () =>
              fetch(`/api/cleaner-portal/jobs/${job.id}/status`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', body: JSON.stringify({ status: 'confirmed' }),
              }))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-60">
                <Check className="w-4 h-4" /> Accept
              </button>
              <button
              disabled={busy === job.id}
              onClick={() => act(job.id, () =>
              fetch(`/api/cleaner-portal/jobs/${job.id}/status`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', body: JSON.stringify({ status: 'declined' }),
              }))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#DDDDDD] text-[13px] font-semibold disabled:opacity-60">
                <X className="w-4 h-4" /> Can't do it
              </button>
            </>
          }

          {/* Only on the day. The server enforces the window and says why
              if you are early, but offering a button that is going to be
              refused is not a kindness. */}
          {!undecided && !job.started_at && job.cleaning_date === todayStr &&
          <button
            disabled={busy === job.id}
            onClick={() => act(job.id, () => post(`/api/cleaner-portal/jobs/${job.id}/start`))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-60">
              <Play className="w-4 h-4" /> Start cleaning
            </button>
          }

          {working &&
          <button
            disabled={busy === job.id}
            onClick={() => act(job.id, () => post(`/api/cleaner-portal/jobs/${job.id}/finish`))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#0F6E56] text-white text-[13px] font-semibold disabled:opacity-60">
              <Square className="w-4 h-4" /> Finished
            </button>
          }

          <button
            onClick={() => setOpenJob(job)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#DDDDDD] text-[13px] font-semibold">
            <ClipboardList className="w-4 h-4" /> Checklist
          </button>

          {!undecided && !job.started_at && job.cleaning_date !== todayStr &&
          <span className="self-center text-[12px] text-[#717171]">
              You can start on the day
            </span>
          }
        </div>
      </div>);

  };

  // --- panels ------------------------------------------------------------

  /**
   * Only the ticked days and their hours, in a stable order.
   *
   * Used to compare what is on screen against what the server holds, so
   * the button can go quiet once there is nothing left to save. Times on
   * an unticked day are ignored — they are not sent, so changing them is
   * not a change.
   */
  const scheduleKey = (s: Record<number, {on: boolean;start: string;end: string;}>) =>
  JSON.stringify(DAYS.map((d) => s[d.dow]?.on ? [d.dow, s[d.dow].start, s[d.dow].end] : 0));

  const scheduleDirty = scheduleKey(schedule) !== scheduleKey(savedSchedule);

  const saveSchedule = async () => {
    const payload = Object.entries(schedule).
    filter(([, v]) => v.on).
    map(([dow, v]) => ({ day_of_week: Number(dow), start_time: v.start, end_time: v.end }));
    setSavingSchedule(true);
    const res = await fetch('/api/cleaner-portal/availability', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ schedule: payload }),
    });
    setSavingSchedule(false);
    if (!res.ok) return setError('Could not save your availability');
    setSavedSchedule(schedule);

    // Say something. A save that looks identical to not having pressed
    // anything is why people press it four times.
    const days = payload.length;
    setResetNote(
      days ?
      `Saved — you can work ${days} day${days === 1 ? '' : 's'} a week.` :
      'Saved — you are not offered any jobs until you tick a day.'
    );
  };

  /**
   * The days the calendar disagrees with the pattern about, from today on.
   *
   * This is the whole reason the reset exists. An override beats the
   * weekly schedule, so ticking "Sunday" here changes nothing on a Sunday
   * somebody has already tapped — the save appears to work and the
   * calendar does not move.
   */
  const divergent = Object.entries(overrides).
  filter(([date, available]) => {
    if (date < todayStr) return false;
    const usual = schedule[new Date(date + 'T00:00:00').getDay()]?.on || false;
    return available !== usual;
  }).
  map(([date]) => date).
  sort();

  // Split by what the button can actually act on. A day with a job booked
  // on it is not resettable — offering to put it back would be a button
  // that does nothing, and the honest answer for those days is to decline
  // the job. The two cases get two different sentences.
  const bookedDates = new Set(mine.map((j) => j.cleaning_date));
  const divergentDays = divergent.filter((d) => !bookedDates.has(d));
  const lockedDays = divergent.filter((d) => bookedDates.has(d));

  const resetOverrides = async () => {
    setResetting(true);
    const res = await post('/api/cleaner-portal/overrides/reset');
    setResetting(false);
    setConfirmReset(false);
    if (!res.ok) return setError('Could not reset those days');
    const out = await res.json();
    setResetNote(
      out.kept.length ?
      `${out.cleared} day${out.cleared === 1 ? '' : 's'} put back. ${out.kept.length} kept — you have a job booked on ${out.kept.map(fmtDay).join(', ')}.` :
      `${out.cleared} day${out.cleared === 1 ? '' : 's'} put back to your usual schedule.`
    );
    await load();
  };

  const Availability = () =>
  <div className="bg-white rounded-[12px] border border-[#EBEBEB] p-4">
      <p className="text-[15px] font-semibold mb-1">The days you can work</p>
      <p className="text-[13px] text-[#717171] mb-4">
        Jobs are only offered to you on these days.
      </p>
      {DAYS.map((d) =>
    <div key={d.dow} className="flex items-center gap-3 py-2 border-b border-[#F0F0F0] last:border-0">
          <label className="flex items-center gap-2 w-[86px] shrink-0">
            <input
        type="checkbox"
        checked={schedule[d.dow]?.on || false}
        onChange={(e) => setSchedule({ ...schedule, [d.dow]: { ...schedule[d.dow], on: e.target.checked } })}
        className="w-4 h-4" />
            <span className="text-[14px] font-medium">{d.label}</span>
          </label>
          <input
      type="time"
      value={schedule[d.dow]?.start || '09:00'}
      disabled={!schedule[d.dow]?.on}
      onChange={(e) => setSchedule({ ...schedule, [d.dow]: { ...schedule[d.dow], start: e.target.value } })}
      className="flex-1 min-w-0 px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px] disabled:bg-[#F7F7F7] disabled:text-[#B0B0B0]" />
          <span className="text-[#717171]">–</span>
          <input
      type="time"
      value={schedule[d.dow]?.end || '17:00'}
      disabled={!schedule[d.dow]?.on}
      onChange={(e) => setSchedule({ ...schedule, [d.dow]: { ...schedule[d.dow], end: e.target.value } })}
      className="flex-1 min-w-0 px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px] disabled:bg-[#F7F7F7] disabled:text-[#B0B0B0]" />
        </div>
    )}
      {/* The button carries its own state: black while there is something
          to save, grey and unpressable once there is not. "Saved" sitting
          in a disabled button is the acknowledgement — a plain Save that
          looks identical before and after is why people press it twice
          and then wonder which press counted. */}
      <button
    onClick={saveSchedule}
    disabled={savingSchedule || !scheduleDirty}
    className={`mt-4 w-full h-[44px] rounded-[8px] text-[14px] font-semibold transition-colors ${
    savingSchedule || !scheduleDirty ?
    'bg-[#F7F7F7] text-[#B0B0B0] border border-[#EBEBEB]' :
    'bg-[#222222] text-white'}`}>
        {savingSchedule ? 'Saving…' : scheduleDirty ? 'Save' : 'Saved'}
      </button>

      {/* Only shown when there is genuinely a disagreement to resolve. A
          permanent "reset everything" button is an accident waiting to
          happen; one that appears with a count on it is a specific offer.
          The days it will not touch are named before it is pressed, not
          after. */}
      {divergentDays.length > 0 &&
    <div className="mt-4 pt-4 border-t border-[#F0F0F0]">
          <p className="text-[13px]">
            {divergentDays.length} day{divergentDays.length === 1 ? '' : 's'} on your
            calendar {divergentDays.length === 1 ? 'does' : 'do'} not follow this:{' '}
            <span className="text-[#717171]">{divergentDays.slice(0, 6).map(fmtDay).join(', ')}
              {divergentDays.length > 6 ? ` and ${divergentDays.length - 6} more` : ''}
            </span>
          </p>
          <p className="text-[12px] text-[#717171] mt-1">
            Changing the pattern above leaves those days as they are.
          </p>

          {confirmReset ?
      <div className="flex gap-2 mt-3">
              <button
        disabled={resetting}
        onClick={resetOverrides}
        className="flex-1 h-[44px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold disabled:opacity-60">
                {resetting ? 'Putting them back…' : `Yes, put back ${divergentDays.length}`}
              </button>
              <button
        onClick={() => setConfirmReset(false)}
        className="px-4 h-[44px] rounded-[8px] border border-[#DDDDDD] text-[14px] font-semibold">
                Cancel
              </button>
            </div> :

      <button
        onClick={() => setConfirmReset(true)}
        className="mt-3 w-full h-[44px] rounded-[8px] border border-[#DDDDDD] text-[14px] font-semibold">
              Put them back to my usual days
            </button>
      }

          <p className="text-[12px] text-[#717171] mt-2">
            Days you already have a job booked on are left alone.
          </p>
        </div>
    }

      {/* Named separately, because the button above cannot help with
          these and saying it could would be a lie. */}
      {lockedDays.length > 0 &&
    <p className="mt-4 pt-4 border-t border-[#F0F0F0] text-[13px] text-[#717171]">
          {lockedDays.map(fmtDay).join(', ')} also {lockedDays.length === 1 ? 'differs' : 'differ'} from
          this, but you have a job booked. Decline it on the Jobs tab to free the day.
        </p>
    }

      {resetNote &&
    <p className="mt-3 text-[13px] text-[#0F6E56]">{resetNote}</p>
    }
    </div>;

  // --- checklist ---------------------------------------------------------

  // --- calendar ----------------------------------------------------------

  /**
   * One colour per property, assigned by position.
   *
   * On the grid a day is a 30px square with no room for a name, so the
   * colour has to carry which property it is — which is why the legend
   * below is not decoration. Two properties here; the palette wraps if a
   * cleaner ever works more.
   */
  const PROP_COLOURS = ['#0F6E56', '#185FA5', '#993C1D', '#534AB7', '#854F0B'];
  const colourFor = (propertyId: number) => {
    const i = properties.findIndex((p) => p.id === propertyId);
    return PROP_COLOURS[(i < 0 ? 0 : i) % PROP_COLOURS.length];
  };

  /**
   * Can this cleaner work on this date?
   *
   * The weekly pattern is the standing answer; an override is the
   * exception to it on one date. Asking the two in that order is what
   * makes "every Sunday, except the 14th" expressible.
   */
  const canWorkOn = (date: Date) => {
    const key = iso(date);
    if (key in overrides) return overrides[key];
    return schedule[date.getDay()]?.on || false;
  };

  /**
   * Flip one day, and remember it as an exception.
   *
   * Optimistic: the square changes under the thumb and is put back if
   * the save fails. Waiting for a round trip first reads as the tap not
   * registering, and you get a second tap undoing the first.
   */
  const setDayAvailable = async (key: string, next: boolean) => {
    const before = overrides;
    setOverrides({ ...overrides, [key]: next });
    const res = await post('/api/cleaner-portal/overrides', { date: key, available: next });
    if (!res.ok) {
      setOverrides(before);
      setError('Could not save that day');
    }
  };

  const calendarPanel = () => {
    // The app's own calendar, unchanged.
    //
    // Not a second grid with the same job: the module state it reads is
    // filled from the portal's endpoints instead, so the cleaner sees
    // exactly what the manager sees minus the money — and every fix to
    // bar geometry, month clipping or the today marker lands in both
    // without being done twice.
    const shown = propFilter || (properties[0]?.id ?? 0);

    // Days this cleaner cannot work, for the three months on screen.
    // Computed rather than stored, so the weekly pattern and its
    // exceptions never disagree.
    // What each day means to this cleaner. Three states, not two: a day
    // they have offered and a day somebody has put them to work on are
    // different facts, and only one of them is theirs to change.
    const bookedDays = new Set(visible.map((j) => j.cleaning_date));
    const dayStates: Record<string, 'off' | 'free' | 'booked'> = {};
    const from = new Date();
    from.setDate(1);
    for (let i = 0; i < 120; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      const key = iso(d);
      dayStates[key] = bookedDays.has(key) ? 'booked' : canWorkOn(d) ? 'free' : 'off';
    }
    return (
      <>
        {/* A key, because a ring and a tick are only obvious once you
            already know. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-1 text-[12px] text-[#717171]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full border-[1.5px] border-[#B0B0B0]" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-[#0F6E56]" strokeWidth={3} /> Booked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="line-through text-[#8A8A8A]">00</span> Not available
          </span>
          <span>Tap a day to change it</span>
        </div>
      <MonthCalendar
        propertyId={shown}
        bookings={sharedBookings.filter((b) => !propFilter || b.propId === propFilter)}
        onBookingClick={(b) => setPickedStay(b.id)}
        barLabel={(b) => properties.find((p) => p.id === b.propId)?.name || 'Booking'}
        onDayClick={(d) => setPickedDay(iso(d))}
        dayStates={dayStates}
        plainBars />

      </>);

  };

  /**
   * Tapping a booking has to answer immediately.
   *
   * This was a block rendered under the calendar, which on a phone means
   * a tap followed by a scroll to find out what you tapped. Cleaners are
   * only ever on phones, so it is a sheet over the top — the same shape
   * the manager's booking detail uses.
   */
  const staySheet = () => {
    const stay = pickedStay && stays.find((b) => String(b.id) === pickedStay);
    if (!stay) return null;
    return (
      <>
        <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setPickedStay(null)} />
        <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                        sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                        sm:w-[380px] sm:rounded-2xl sm:pb-5">
          <div className="flex justify-center pb-3 sm:hidden">
            <div className="w-[36px] h-[4px] bg-[#DDDDDD] rounded-full" />
          </div>

          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="text-[18px] font-semibold truncate">{stay.guest_name || 'Guest'}</p>
              <p className="text-[13px] text-[#717171]">{stay.property_name}</p>
            </div>
            <button onClick={() => setPickedStay(null)} aria-label="Close" className="p-1 -mr-1 shrink-0">
              <X className="w-5 h-5 text-[#717171]" />
            </button>
          </div>

          <p className="text-[14px] text-[#717171] mt-2 tabular-nums">
            {fmtDay(stay.check_in)} – {fmtDay(stay.check_out)}
          </p>

          {stay.num_guests != null &&
          <p className="text-[14px] mt-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-[#717171]" />
              {(stay.num_guests || 0) + (stay.children || 0)} guests
              {stay.children ?
            ` (${stay.num_guests} adults, ${stay.children} ${stay.children === 1 ? 'child' : 'children'})` :
            ''}
            </p>
          }

          {stay.special_requirements &&
          <p className="mt-3 text-[14px] bg-[#F7F7F7] rounded-[8px] px-3 py-2.5">
              {stay.special_requirements}
            </p>
          }
        </div>
      </>);

  };

  /**
   * What one day holds, and the one thing you can change about it.
   *
   * Tapping used to flip availability on the spot — no way to see what
   * you were changing, no way to check a booked day without altering it,
   * and no obvious way back. Everything about a day now lives here, and
   * changing it is a deliberate button rather than a side effect of
   * looking.
   */
  const daySheet = () => {
    if (!pickedDay) return null;
    const jobsToday = visible.filter((j) => j.cleaning_date === pickedDay);
    const staysToday = visibleStays.filter((b) => b.check_in <= pickedDay && b.check_out >= pickedDay);
    const free = pickedDay in overrides ?
    overrides[pickedDay] :
    schedule[new Date(pickedDay + 'T00:00:00').getDay()]?.on || false;
    const booked = jobsToday.length > 0;

    return (
      <>
        <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setPickedDay(null)} />
        <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                        sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                        sm:w-[380px] sm:rounded-2xl sm:pb-5">
          <div className="flex justify-center pb-3 sm:hidden">
            <div className="w-[36px] h-[4px] bg-[#DDDDDD] rounded-full" />
          </div>

          <div className="flex justify-between items-start">
            <div>
              <p className="text-[18px] font-semibold">{dayLabel(pickedDay)}</p>
              <p className="text-[13px] text-[#717171]">
                {booked ? 'You are booked to clean' : free ? 'You are available' : 'You are not available'}
              </p>
            </div>
            <button onClick={() => setPickedDay(null)} aria-label="Close" className="p-1 -mr-1">
              <X className="w-5 h-5 text-[#717171]" />
            </button>
          </div>

          {jobsToday.map((j) =>
          <div key={j.id} className="mt-3 bg-[#F7F7F7] rounded-[8px] px-3 py-2.5">
              <p className="text-[14px] font-medium">{j.property_name}</p>
              <p className="text-[13px] text-[#717171]">{j.start_time}–{j.end_time}</p>
              {j.property_address && <p className="text-[13px] text-[#717171]">{j.property_address}</p>}
              {j.special_requirements &&
            <p className="text-[13px] mt-1">{j.special_requirements}</p>
            }

              {/* Answering here rather than sending them to another tab.
                  The day is what they tapped and the job is what they are
                  looking at — making them go and find it again is how a
                  "no" turns into silence. */}
              <div className="flex gap-2 mt-2.5">
                {j.status === 'pending' &&
              <button
                disabled={busy === j.id}
                onClick={() => act(j.id, () =>
                fetch(`/api/cleaner-portal/jobs/${j.id}/status`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin', body: JSON.stringify({ status: 'confirmed' }),
                }))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-60">
                    <Check className="w-4 h-4" /> Accept
                  </button>
              }
                {!j.started_at &&
              <button
                disabled={busy === j.id}
                onClick={() => act(j.id, () =>
                fetch(`/api/cleaner-portal/jobs/${j.id}/status`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin', body: JSON.stringify({ status: 'declined' }),
                }))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[13px] font-semibold disabled:opacity-60">
                    <X className="w-4 h-4" /> Can't do it
                  </button>
              }
              </div>
            </div>
          )}

          {!booked && staysToday.length > 0 &&
          <div className="mt-3 text-[13px] text-[#717171]">
              {staysToday.map((b) => b.property_name).join(', ')} occupied
            </div>
          }

          {/* A booked day is not yours to simply mark unavailable —
              somebody is relying on you. The way out is declining the job,
              which is on the job above, where the consequence is visible. */}
          {booked ?
          <p className="mt-4 text-[13px] text-[#717171]">
              To free up this day, decline the job{jobsToday.length > 1 ? 's' : ''} above.
            </p> :

          <button
            onClick={async () => { await setDayAvailable(pickedDay, !free); setPickedDay(null); }}
            className={`mt-4 w-full h-[44px] rounded-[8px] text-[14px] font-semibold ${
            free ? 'border border-[#DDDDDD] text-[#222222]' : 'bg-[#222222] text-white'}`}>
              {free ? 'Mark me unavailable' : 'Mark me available'}
            </button>
          }
        </div>
      </>);

  };

  // --- shell -------------------------------------------------------------

  const TABS: {key: Tab;label: string;Icon: any;}[] = [
  { key: 'jobs', label: 'Jobs', Icon: ClipboardList },
  { key: 'calendar', label: 'Calendar', Icon: CalendarRange },
  { key: 'availability', label: 'My days', Icon: CalendarDays },
  { key: 'report', label: 'Report', Icon: Wrench }];

  return (
    <div className="min-h-screen bg-[#F7F7F7] font-sans text-[#222222] antialiased pb-20">
      <div className="bg-white border-b border-[#EBEBEB] px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#FF385C14] rounded-full flex items-center justify-center">
            <Home className="w-4 h-4 text-[#FF385C]" strokeWidth={2} />
          </div>
          <span className="text-[16px] font-bold">My Cleanings</span>
        </div>
        <button onClick={onSignOut} aria-label="Sign out" className="p-2 rounded-full hover:bg-[#F7F7F7] text-[#717171]">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 max-w-[560px] mx-auto">
        {name && tab === 'jobs' && <h1 className="text-[22px] font-bold mb-4">Hi {name}</h1>}

        {error &&
        <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] px-3 py-2 mb-3 text-[13px] text-[#991B1B] flex justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        }

        {loading && <p className="text-[14px] text-[#717171]">Loading…</p>}

        {/* Which property, when. One tap rather than reading past the
            other one's jobs. Only worth showing to a cleaner who works
            more than one place. */}
        {!loading && properties.length > 1 && (tab === 'jobs' || tab === 'calendar') &&
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {[{ id: 0, name: 'All' }, ...properties].map((p) =>
          <button
            key={p.id}
            onClick={() => setPropFilter(p.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium border ${
            propFilter === p.id ?
            'bg-[#222222] text-white border-[#222222]' :
            'bg-white border-[#DDDDDD] text-[#222222]'}`
            }>
                {p.name}
              </button>
          )}
          </div>
        }

        {!loading && tab === 'jobs' &&
        <>
            {upcoming.length === 0 &&
          <div className="bg-white rounded-[12px] border border-[#EBEBEB] p-6 text-center">
                <p className="text-[15px] font-medium mb-1">Nothing scheduled</p>
                <p className="text-[13px] text-[#717171]">
                  You'll see your cleanings here once they're assigned.
                </p>
              </div>
          }
            {upcoming.map((j, idx) =>
          <div key={j.id}>
                {(idx === 0 || upcoming[idx - 1].cleaning_date !== j.cleaning_date) &&
            <p className="text-[12px] font-semibold text-[#717171] uppercase tracking-[0.5px] mb-2 mt-4 first:mt-0">
                    {dayLabel(j.cleaning_date)}
                  </p>
            }
                <JobCard job={j} />
              </div>
          )}
          </>
        }

        {!loading && tab === 'calendar' && calendarPanel()}

        {!loading && tab === 'availability' && <Availability />}
        {!loading && tab === 'report' &&
        <Report properties={properties} onError={setError} />}
      </div>

      {openJob && <Checklist job={openJob} onClose={() => setOpenJob(null)} />}
      {staySheet()}
      {daySheet()}

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-[#EBEBEB] flex">
        {TABS.map(({ key, label, Icon }) =>
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-medium ${
          tab === key ? 'text-[#FF385C]' : 'text-[#717171]'}`
          }>
            <Icon className="w-5 h-5" />
            {label}
          </button>
        )}
      </nav>
    </div>);

}
