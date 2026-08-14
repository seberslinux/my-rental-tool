import React, { useCallback, useEffect, useState } from 'react';
import { MonthCalendar } from './MonthCalendar';
import { Booking, bookings as sharedBookings, properties as sharedProperties, loadCleanerCalendarData } from '../data/properties';
import { NotificationSetting } from './NotificationSetting';
import {
  Home, LogOut, MapPin, Clock, Users, Check, X, Play, Square,
  ClipboardList, CalendarDays, CalendarRange, Wrench, ShoppingCart, MessageSquare,
  ChevronLeft, ChevronRight, Bell, AlertCircle } from
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
  /** Why they are going, when it is not simply the turnover. */
  reason: string | null;
  note: string | null;
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

/** How long ago, in the units a person would actually say. */
const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
};

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
        // Say how many, because the box takes several and somebody who
        // typed four lines should see that four things were understood.
        const added = kind === 'supplies' ?
        ((await res.json().catch(() => ({}))).added || 1) :
        0;
        setSent(
          kind === 'supplies' ?
          `${added} item${added === 1 ? '' : 's'} added to the shopping list.` :
          'Sent. The owner can see it.'
        );
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

        {/* Supplies get a box with room in it, because supplies are
            almost never one thing. Each line becomes its own row, so
            the bin liners can be ticked off without closing the laundry
            liquid with them — typed into a single field they arrived as
            one item and had to be dealt with as one. */}
        {kind === 'supplies' ?
        <textarea
          value={title}
          onChange={(e) => { setTitle(e.target.value); setSent(''); }}
          placeholder={'What do you need?\nOne per line'}
          className="w-full h-[88px] p-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px] resize-none" /> :

        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setSent(''); }}
          placeholder={
          kind === 'maintenance' ? 'What is broken?' :
          'What would you like to tell the owner?'}
          className="w-full h-[44px] px-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px]" />
        }

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
  // marked_clean_at rides along from /me, which selects the whole property
  // row — so "already done today" is the server's answer, not a flag this
  // screen sets and then has to keep true.
  const [properties, setProperties] = useState<{id: number;name: string;marked_clean_at?: string | null;}[]>([]);
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
  // The job whose finish was refused because the inventory is not counted.
  const [needsCount, setNeedsCount] = useState<number | null>(null);
  // Separate from `busy`, which is keyed on a job id — a property id of
  // the same number would otherwise put the spinner on a stranger's card.
  const [markingProp, setMarkingProp] = useState<number | null>(null);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  // 0 = every property. A cleaner working two places wants "when does The
  // loft need me" without reading past the other one.
  const [propFilter, setPropFilter] = useState<number>(0);
  const [pickedStay, setPickedStay] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // Exceptions to the weekly pattern, keyed YYYY-MM-DD -> can work.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [alerts, setAlerts] = useState<any[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
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
      const alertsRes = await fetch('/api/cleaner-portal/notifications', { credentials: 'same-origin' });
      if (alertsRes.ok) setAlerts(await alertsRes.json());
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
    setNeedsCount(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // Refused because the inventory is outstanding: open the count
        // rather than leaving them staring at an error for a thing they
        // are meant to do next.
        if (d.checklist_outstanding) {
          setNeedsCount(jobId);
          const job = jobs.find((j) => j.id === jobId);
          if (job) setOpenJob(job);
        }
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

  /**
   * Record a clean nobody scheduled.
   *
   * Deliberately not routed through `act`: that one is about a job, and
   * carries the checklist rescue with it. There is no job here and no
   * checklist to answer, so a refusal is just a refusal.
   */
  const markCleaned = async (propertyId: number) => {
    setMarkingProp(propertyId);
    try {
      const res = await post(`/api/cleaner-portal/properties/${propertyId}/mark-clean`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'That did not work');
      }
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMarkingProp(null);
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

  /**
   * Requests still waiting on an answer, lifted to the top.
   *
   * In date order they sat wherever they happened to fall — one on the
   * 12th, one on the 22nd, several screens apart — so the one thing that
   * needs the cleaner to do something was the thing hardest to find.
   *
   * They appear again below in the full schedule, deliberately. The top
   * is a short list of things to answer; the bottom is what the week
   * actually looks like, and a day missing from it because it happens to
   * be unanswered would be a worse lie than showing it twice.
   */
  const needsAnswer = upcoming.filter((j) => j.status === 'pending');

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

  const JobCard = ({ job, echo = false }: {job: Job;echo?: boolean;}) => {
    const working = !!job.started_at && !job.completed_at;
    const done = !!job.completed_at;
    // `echo` is the same job seen again lower down, in the schedule. It
    // shows what the day holds; the copy at the top is where it gets
    // answered. Two sets of Accept buttons for one job is how somebody
    // ends up wondering which one counted.
    const undecided = job.status === 'pending' && !echo;

    // Booked on a day they have said they cannot work. The manager sees
    // this in amber on their grid; the cleaner saw nothing at all, which
    // left the one person who can resolve it as the only one unaware.
    const notTheirDay =
    !working && !done && !canWorkOn(new Date(job.cleaning_date + 'T00:00:00'));

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

        {/* A visit that is not a turnover. Without this it reads as an
            ordinary clean, and turning up at 12:30 to prepare for guests
            arriving at 15:00 is a different job from clearing up after
            the last lot. */}
        {job.reason === 'checkin' &&
        <p className="mt-2 text-[13px] text-[#0F6E56] font-medium">
            Before check-in — ready before the guests arrive
          </p>
        }
        {job.reason === 'other' &&
        <p className="mt-2 text-[13px] text-[#717171] font-medium">Not a turnover</p>
        }

        {job.note &&
        <p className="mt-2 text-[13px] bg-[#F7F7F7] rounded-[8px] px-3 py-2">{job.note}</p>
        }

        {job.special_requirements &&
        <p className="mt-2 text-[13px] bg-[#F7F7F7] rounded-[8px] px-3 py-2">
            {job.special_requirements}
          </p>
        }

        {notTheirDay &&
        <p className="mt-2 text-[13px] text-[#92400E]">
            You have this day marked as not available.
            {job.status === 'pending' ? ' Accept only if you can.' : ' Decline it if you cannot come.'}
          </p>
        }

        {echo && job.status === 'pending' &&
        <p className="mt-2 text-[13px] text-[#717171]">
            Waiting for your answer — it is at the top of this list.
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

          {working && needsCount === job.id &&
          <p className="w-full text-[13px] text-[#92400E] -mt-1 mb-1">
              Count the checklist before you finish.
            </p>
          }

          {working &&
          <button
            disabled={busy === job.id}
            onClick={() => act(job.id, () => post(`/api/cleaner-portal/jobs/${job.id}/finish`))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#0F6E56] text-white text-[13px] font-semibold disabled:opacity-60">
              {/* Paired with "Start cleaning" above it. On its own,
                  "Finished" reads as a label saying the job already is. */}
              <Square className="w-4 h-4" /> Finish cleaning
            </button>
          }

          {/* Only once they are standing in the property.
              It used to be on every card — unanswered requests, jobs three
              weeks out, cleans finished last month. Counting towels a
              fortnight early is a guess, and a button that is never any
              use is one people learn to skip. */}
          {(working || done) &&
          <button
            onClick={() => setOpenJob(job)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-[8px] border text-[13px] font-semibold ${
            needsCount === job.id ?
            'border-[#BA7517] bg-[#FFFBEB] text-[#92400E]' :
            'border-[#DDDDDD]'}`}>
              <ClipboardList className="w-4 h-4" /> Checklist
            </button>
          }

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
  <>
    {/* The cleaner's half of this. Being told about a job is the point
        of the portal; the availability they set is worth nothing if the
        offer never reaches them. */}
    <div className="mb-3">
      <NotificationSetting />
    </div>

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
    </div>
  </>;

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
  const unreadAlerts = alerts.filter((a) => !a.read_at).length;

  /**
   * Clear one, once it has been read.
   *
   * A list that only grows is a list people stop opening — and these are
   * yesterday's shifts, which the Jobs tab already holds properly.
   */
  const dismissAlert = async (id: number) => {
    setAlerts(alerts.filter((a) => a.id !== id));
    await fetch(`/api/cleaner-portal/notifications/${id}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
  };

  const markAlertsRead = async () => {
    await post('/api/cleaner-portal/notifications/read-all');
    setAlerts(alerts.map((a) => ({ ...a, read_at: new Date().toISOString() })));
  };

  /**
   * Everything the cleaner has been told.
   *
   * Each row says whether the message actually reached their phone.
   * WhatsApp accepts text it then drops outside a 24-hour window, so a
   * send has never been proof of arrival — and a cleaner who was never
   * told about a shift needs somewhere to find it. That is the whole
   * reason this screen exists rather than trusting the message.
   */
  const alertSheet = () => {
    if (!showAlerts) return null;
    return (
      <>
        <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setShowAlerts(false)} />
        <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl pb-8
                        max-h-[80vh] flex flex-col
                        sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                        sm:w-[420px] sm:max-h-[70vh] sm:rounded-2xl sm:pb-0">
          <div className="flex justify-center pt-3 pb-2 sm:hidden">
            <div className="w-[36px] h-[4px] bg-[#DDDDDD] rounded-full" />
          </div>

          <div className="flex items-center justify-between px-5 py-2 shrink-0">
            <p className="text-[18px] font-semibold">Messages</p>
            <div className="flex items-center gap-1">
              {unreadAlerts > 0 &&
              <button onClick={markAlertsRead} className="text-[12px] font-medium text-[#717171] px-2 py-1 rounded-full hover:bg-[#F7F7F7]">
                  Mark all read
                </button>
              }
              <button onClick={() => setShowAlerts(false)} aria-label="Close" className="p-1.5 rounded-full hover:bg-[#F7F7F7]">
                <X className="w-5 h-5 text-[#717171]" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto px-5">
            {alerts.length === 0 &&
            <p className="text-[14px] text-[#717171] py-6 text-center">
                Nothing yet. New jobs and any changes to them show up here.
              </p>
            }

            {alerts.map((a) =>
            <div key={a.id} className={`py-3 border-b border-[#F0F0F0] last:border-0 ${a.read_at ? '' : '-mx-2 px-2 bg-[#FFFBEB] rounded-[8px]'}`}>
                <div className="flex items-start gap-2">
                  {a.severity === 'attention' ?
                <AlertCircle className="w-4 h-4 text-[#C13515] shrink-0 mt-0.5" /> :
                <Check className="w-4 h-4 text-[#0F6E56] shrink-0 mt-0.5" />
                }
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">{a.title}</p>
                    {a.body && <p className="text-[13px] text-[#717171] mt-0.5 whitespace-pre-line">{a.body}</p>}
                    <p className="text-[11px] text-[#B0B0B0] mt-1">
                      {ago(a.created_at)}{a.property_name ? ` · ${a.property_name}` : ''}
                    </p>
                    {/* Said plainly rather than hidden. If this never
                        reached their phone, the app is the only place
                        they will ever find out. */}
                    {/* Only a real failure. "Skipped" means WhatsApp is
                        switched off and the app is the channel — warning
                        about that on every row would train people to
                        ignore the one that matters. */}
                    {a.delivery === 'failed' &&
                  <p className="text-[11px] text-[#92400E] mt-1">Not delivered to your phone</p>
                  }
                  </div>

                  <button
                  onClick={() => dismissAlert(a.id)}
                  aria-label="Clear this message"
                  className="shrink-0 -mt-1 -mr-1 p-2 rounded-full text-[#B0B0B0] hover:bg-[#F0F0F0] active:bg-[#EBEBEB]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </>);

  };

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
              {j.reason === 'checkin' &&
            <p className="text-[13px] text-[#0F6E56] mt-1">Before check-in</p>
            }
              {j.note && <p className="text-[13px] mt-1">{j.note}</p>}
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
        <div className="flex items-center gap-1">
          {/* A dot, not a count. On a phone the number is unreadable at
              this size and "some" is the only thing that changes what you
              do next. */}
          <button
            onClick={() => setShowAlerts(true)}
            aria-label={unreadAlerts ? `Messages, ${unreadAlerts} unread` : 'Messages'}
            className="relative p-2 rounded-full hover:bg-[#F7F7F7] text-[#717171]">
            <Bell className="w-5 h-5" />
            {unreadAlerts > 0 &&
            <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#C13515] rounded-full border-2 border-white" />
            }
          </button>
          <button onClick={onSignOut} aria-label="Sign out" className="p-2 rounded-full hover:bg-[#F7F7F7] text-[#717171]">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
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

            {/* Answer these first. A filter was worse than useless here:
                two more pills above a list that is already two rows of
                them, to hide things the cleaner still has to deal with. */}
            {needsAnswer.length > 0 &&
          <>
                <p className="text-[15px] font-semibold mb-2">
                  New job requests
                </p>
                {needsAnswer.map((j) =>
              <div key={`new-${j.id}`}>
                    <p className="text-[12px] text-[#717171] mb-1">{dayLabel(j.cleaning_date)}</p>
                    <JobCard job={j} />
                  </div>
              )}
                <p className="text-[15px] font-semibold mb-2 mt-6 pt-5 border-t border-[#EBEBEB]">
                  All your jobs
                </p>
              </>
          }

            {upcoming.map((j, idx, arr) =>
          <div key={j.id}>
                {(idx === 0 || arr[idx - 1].cleaning_date !== j.cleaning_date) &&
            <p className="text-[12px] font-semibold text-[#717171] uppercase tracking-[0.5px] mb-2 mt-4 first:mt-0">
                    {dayLabel(j.cleaning_date)}
                  </p>
            }
                <JobCard job={j} echo={needsAnswer.some((n) => n.id === j.id)} />
              </div>
          )}

            {/* A clean nobody scheduled.

                Below the jobs, not among them, and worded to send anybody
                with a job back to it: finishing the job records who was
                asked, when they started and what the checklist said, and
                this records none of that. It is the way out for a
                property that has been cleaned with no job to hang it on,
                which otherwise reads dirty until a manager notices. */}
            {properties.length > 0 &&
          <div className="mt-6 pt-5 border-t border-[#EBEBEB]">
                <p className="text-[15px] font-semibold mb-1">Cleaned something unscheduled?</p>
                <p className="text-[13px] text-[#717171] mb-3">
                  Only if there was no job for it. If there is one above, finish that instead.
                </p>
                <div className="bg-white rounded-[12px] border border-[#EBEBEB] divide-y divide-[#EBEBEB]">
                  {(propFilter ? properties.filter((p) => p.id === propFilter) : properties).map((p) => {
                const done = !!p.marked_clean_at && iso(new Date(p.marked_clean_at)) === todayStr;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium truncate">{p.name}</p>
                          {done &&
                      <p className="text-[12px] text-[#717171]">Marked cleaned today</p>
                      }
                        </div>
                        <button
                      disabled={done || markingProp === p.id}
                      onClick={() => markCleaned(p.id)}
                      className={`shrink-0 px-3 py-2 rounded-[8px] text-[13px] font-medium border ${
                      done ?
                      'border-[#EBEBEB] text-[#717171]' :
                      'border-[#222222] text-[#222222]'}`
                      }>
                          {/* The disabled one may state a fact, because
                              a greyed button is plainly not a thing to
                              press. The live one is an instruction. */}
                          {done ? 'Cleaned' : markingProp === p.id ? 'Saving…' : 'Mark as cleaned'}
                        </button>
                      </div>);

              })}
                </div>
              </div>
          }
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
      {alertSheet()}

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
