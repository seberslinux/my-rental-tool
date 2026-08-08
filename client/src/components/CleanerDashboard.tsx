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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  // 0 = every property. A cleaner working two places wants "when does The
  // loft need me" without reading past the other one.
  const [propFilter, setPropFilter] = useState<number>(0);
  const [pickedStay, setPickedStay] = useState<string | null>(null);

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

  const saveSchedule = async () => {
    const payload = Object.entries(schedule).
    filter(([, v]) => v.on).
    map(([dow, v]) => ({ day_of_week: Number(dow), start_time: v.start, end_time: v.end }));
    const res = await fetch('/api/cleaner-portal/availability', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ schedule: payload }),
    });
    if (!res.ok) setError('Could not save your availability');
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
      <button
    onClick={saveSchedule}
    className="mt-4 w-full h-[44px] bg-[#222222] text-white rounded-[8px] text-[14px] font-semibold">
        Save
      </button>
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

  const calendarPanel = () => {
    // The app's own calendar, unchanged.
    //
    // Not a second grid with the same job: the module state it reads is
    // filled from the portal's endpoints instead, so the cleaner sees
    // exactly what the manager sees minus the money — and every fix to
    // bar geometry, month clipping or the today marker lands in both
    // without being done twice.
    const shown = propFilter || (properties[0]?.id ?? 0);
    return (
      <MonthCalendar
        propertyId={shown}
        bookings={sharedBookings.filter((b) => !propFilter || b.propId === propFilter)}
        onBookingClick={(b) => setPickedStay(b.id)} />);

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
