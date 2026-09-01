import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  Calendar as CalendarIcon,
  Plus,
  X,
  Check,
  ChevronDown } from
'lucide-react';
import { RequestCleanerDialog } from './RequestCleanerDialog';
import { CleanerDetailSheet } from './CleanerDetailSheet';

interface CleanerAvailability {
  day_of_week: number; // 0=Sun, 1=Mon, ..., 6=Sat
  start_time: string;
  end_time: string;
}

interface CleanerProperty {
  id: number;
  name: string;
}

interface Cleaner {
  id: number;
  name: string;
  phone: string;
  email: string;
  hourly_rate: number;
  flat_rate: number;
  rate_type: string;
  notes: string;
  properties: CleanerProperty[];
  availability: CleanerAvailability[];
  overrides: any[];
}

interface Property {
  id: number;
  name: string;
}

interface CleaningJob {
  id: number;
  property_id: number;
  property_name: string;
  cleaner_id: number;
  cleaner_name: string;
  cleaning_date: string;
  status: string;
}

interface PaySummaryData {
  month: string;
  cleaners: { cleaner_id: number; cleaner_name: string; jobs: any[]; subtotal: number }[];
  grand_total: number;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GRID_DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const COLORS = ['#8B5CF6', '#007AFF', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6'];

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatRate(cleaner: Cleaner): string {
  if (cleaner.rate_type === 'hourly' && cleaner.hourly_rate) {
    return `R ${cleaner.hourly_rate}/hr`;
  }
  if (cleaner.rate_type === 'flat' && cleaner.flat_rate) {
    return `R ${cleaner.flat_rate}/clean`;
  }
  if (cleaner.hourly_rate) return `R ${cleaner.hourly_rate}/hr`;
  if (cleaner.flat_rate) return `R ${cleaner.flat_rate}/clean`;
  return 'No rate set';
}

export function CleanersPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);

  // API state
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [cleaningJobs, setCleaningJobs] = useState<CleaningJob[]>([]);
  const [paySummary, setPaySummary] = useState<PaySummaryData | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formRateType, setFormRateType] = useState('hourly');
  const [formPin, setFormPin] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  // Asking somebody to come, starting from the person rather than the day.
  const [askingCleaner, setAskingCleaner] = useState<any | null>(null);
  // Whose actual availability is being looked at.
  const [viewingCleaner, setViewingCleaner] = useState<any | null>(null);
  const [askedNote, setAskedNote] = useState('');
  // The cards are tall; the pay summary lives underneath them.
  const [cleanersOpen, setCleanersOpen] = useState(false);
  // Schedule and Edit open the same form — the weekly availability lives
  // in it — so Schedule scrolls straight to that section rather than
  // dropping the user at the top of a long form.
  const [focusAvailability, setFocusAvailability] = useState(false);
  const availabilityRef = React.useRef<HTMLDivElement>(null);
  const [invitingId, setInvitingId] = useState<number | null>(null);
  /** The day circle being saved, as `cleanerId:dayOfWeek`, and why it failed. */
  const [togglingDay, setTogglingDay] = useState<string | null>(null);
  const [dayError, setDayError] = useState('');
  const [invite, setInvite] = useState<
  { cleanerId: number; url: string; days: number; copied: boolean;
    sent: boolean; reason?: string } | null>(null);
  const [formNotes, setFormNotes] = useState('');
  const [formPropertyIds, setFormPropertyIds] = useState<number[]>([]);
  const [formAvailability, setFormAvailability] = useState<{ enabled: boolean; start: string; end: string }[]>(
    [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: false, start: '09:00', end: '17:00' }))
  );

  // Pay summary month picker (YYYY-MM format)
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const fetchData = useCallback(async () => {
    try {
      const [cleanersRes, propertiesRes, statsRes] = await Promise.all([
        fetch('/api/cleaners', { credentials: 'same-origin' }),
        fetch('/api/properties', { credentials: 'same-origin' }),
        fetch('/api/dashboard/stats', { credentials: 'same-origin' }),
      ]);
      if (cleanersRes.ok) setCleaners(await cleanersRes.json());
      if (propertiesRes.ok) setProperties(await propertiesRes.json());
      if (statsRes.ok) {
        const stats = await statsRes.json();
        setCleaningJobs(stats.pending_cleaning_jobs || []);
      }
    } catch (e) {
      console.error('Failed to fetch cleaner data:', e);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch pay summary when month changes
  useEffect(() => {
    async function fetchPay() {
      try {
        const res = await fetch(`/api/cleaners/pay-summary?month=${selectedMonth}`, { credentials: 'same-origin' });
        if (res.ok) setPaySummary(await res.json());
      } catch (e) {
        console.error('Failed to fetch pay summary:', e);
      }
    }
    fetchPay();
  }, [selectedMonth]);

  // Compute 7-day grid based on weekOffset
  const today = new Date();
  const monday = getMonday(today);
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDays.push(d);
  }

  const days = weekDays.map((d) => ({
    date: String(d.getDate()),
    day: GRID_DAY_LABELS[weekDays.indexOf(d) % 7],
    active: isSameDay(d, today),
    jsDay: d.getDay(), // 0=Sun..6=Sat
  }));

  const weekRangeLabel = `${weekDays[0].getDate()} ${MONTH_NAMES_SHORT[weekDays[0].getMonth()]} – ${weekDays[6].getDate()} ${MONTH_NAMES_SHORT[weekDays[6].getMonth()]}`;

  // Build coverage: for each of the 7 days, count cleaners available
  const coverage = days.map((d) => {
    return cleaners.filter((c) =>
      c.availability.some((a) => a.day_of_week === d.jsDay)
    ).length;
  });

  // Alert: find days with zero coverage in current + next week
  const alertDays: string[] = [];
  for (let w = 0; w < 2; w++) {
    const wMonday = getMonday(today);
    wMonday.setDate(wMonday.getDate() + w * 7);
    for (let i = 0; i < 7; i++) {
      const d = new Date(wMonday);
      d.setDate(wMonday.getDate() + i);
      const jsDay = d.getDay();
      const hasCoverage = cleaners.some((c) =>
        c.availability.some((a) => a.day_of_week === jsDay)
      );
      if (!hasCoverage && d >= today) {
        alertDays.push(`${DAY_NAMES_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`);
      }
    }
  }

  /**
   * Open the form on an existing cleaner.
   *
   * Edit and Schedule were rendered as buttons with no onClick — they
   * looked live and did nothing, so a cleaner's details could be created
   * but never corrected. Fixing a wrong phone number, which is what
   * stands between a cleaner and their first login, was impossible from
   * the UI.
   */
  const handleEditCleaner = (cleaner: any, focus: 'details' | 'availability' = 'details') => {
    setEditingId(cleaner.id);
    setFocusAvailability(focus === 'availability');
    setFormName(cleaner.name || '');
    setFormPhone(cleaner.phone || '');
    setFormEmail(cleaner.email || '');
    setFormRateType(cleaner.rate_type === 'hourly' ? 'hourly' : 'flat');
    setFormRate(String(
      cleaner.rate_type === 'hourly' ? cleaner.hourly_rate || '' : cleaner.flat_rate || ''
    ));
    setFormNotes(cleaner.notes || '');
    // Left blank on purpose: PINs are hashed and cannot be read back, and
    // the server keeps the existing one when this is empty. Typing a new
    // one replaces it.
    setFormPin('');
    setFormPropertyIds((cleaner.properties || []).map((p: any) => p.id ?? p));

    // day_of_week (0=Sun) back to form order (0=Mon … 6=Sun).
    const formIndex = [6, 0, 1, 2, 3, 4, 5];
    const slots = [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: false, start: '09:00', end: '17:00' }));
    (cleaner.availability || []).forEach((a: any) => {
      const i = formIndex[a.day_of_week];
      if (i !== undefined) slots[i] = { enabled: true, start: a.start_time, end: a.end_time };
    });
    setFormAvailability(slots);
    setShowAddForm(true);
  };

  React.useEffect(() => {
    if (showAddForm && focusAvailability) {
      availabilityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFocusAvailability(false);
    }
  }, [showAddForm, focusAvailability]);

  const resetForm = () => {
    setEditingId(null);
    setFormName(''); setFormPhone(''); setFormEmail(''); setFormRate('');
    setFormRateType('hourly'); setFormPin(''); setFormNotes('');
    setFormPropertyIds([]);
    setFormAvailability([0,1,2,3,4,5,6].map(() => ({ enabled: false, start: '09:00', end: '17:00' })));
  };

  // Add or update, depending on whether the form was opened on a cleaner
  const handleAddCleaner = async () => {
    // Build availability array: day_of_week uses 0=Sun mapping
    // Form index 0=Mon(1), 1=Tue(2), ..., 5=Sat(6), 6=Sun(0)
    const dayMapping = [1, 2, 3, 4, 5, 6, 0]; // form index -> day_of_week
    const availability: { day_of_week: number; start_time: string; end_time: string }[] = [];
    formAvailability.forEach((slot, idx) => {
      if (slot.enabled) {
        availability.push({
          day_of_week: dayMapping[idx],
          start_time: slot.start,
          end_time: slot.end,
        });
      }
    });

    const body: any = {
      name: formName,
      phone: formPhone,
      email: formEmail || null,
      rate_type: formRateType,
      hourly_rate: formRateType === 'hourly' ? Number(formRate) || 0 : 0,
      flat_rate: formRateType !== 'hourly' ? Number(formRate) || 0 : 0,
      notes: formNotes,
      pin: formPin,
      availability,
      property_ids: formPropertyIds,
    };

    // An empty PIN on an edit means "leave it alone" — the server only
    // overwrites when a value is sent, and a hashed PIN cannot be shown
    // back to be re-submitted.
    if (editingId && !formPin) delete body.pin;

    try {
      const res = await fetch(editingId ? `/api/cleaners/${editingId}` : '/api/cleaners', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowAddForm(false);
        resetForm();
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to ${editingId ? 'update' : 'add'} cleaner: ${err.error || res.statusText}`);
      }
    } catch (e) {
      alert(`Network error ${editingId ? 'updating' : 'adding'} cleaner`);
    }
  };

  /**
   * Turn one of the seven day circles on or off.
   *
   * They sit under a heading that says Availability and they are shaped
   * like buttons, so they were the obvious thing to press and the one
   * thing on the card that did nothing. Changing a cleaner's usual days
   * meant opening the edit form and finding the weekly grid inside it.
   *
   * The whole week is sent because the server replaces rather than
   * merges. Hours are not asked for here: a day being switched on borrows
   * the hours of a day they already work, which is nearly always right,
   * and the sheet is where hours are actually set.
   */
  const toggleUsualDay = async (cleaner: Cleaner, dow: number) => {
    setTogglingDay(`${cleaner.id}:${dow}`);
    setDayError('');
    const current = cleaner.availability || [];
    const on = current.some((a) => a.day_of_week === dow);
    const like = current[0];
    const schedule = on ?
    current.filter((a) => a.day_of_week !== dow) :
    [...current, {
      day_of_week: dow,
      start_time: like ? like.start_time : '09:00',
      end_time: like ? like.end_time : '17:00',
    }];

    try {
      const res = await fetch(`/api/cleaners/${cleaner.id}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          schedule: schedule.map((a) => ({
            day_of_week: a.day_of_week,
            start_time: String(a.start_time).slice(0, 5),
            end_time: String(a.end_time).slice(0, 5),
          })),
        }),
      });
      if (!res.ok) {
        setDayError((await res.json().catch(() => ({}))).error || 'Could not change that day');
        return;
      }
      await fetchData();
    } catch {
      setDayError('Could not change that day');
    } finally {
      setTogglingDay(null);
    }
  };

  // Delete cleaner handler
  /**
   * Issue a one-time invitation for this cleaner.
   *
   * Nothing is sent from here — the endpoint returns a link and the owner
   * passes it on however they like. That keeps this working with no
   * messaging service at all, and lets automatic delivery be added later
   * without changing any of it.
   */
  const handleInvite = async (id: number) => {
    setInvitingId(id);
    try {
      const res = await fetch(`/api/cleaners/${id}/invite`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not create an invitation');
      }
      const data = await res.json();
      setInvite({
        cleanerId: id,
        url: data.url,
        days: data.expires_in_days,
        copied: false,
        sent: !!data.sent,
        reason: data.reason,
      });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setInvitingId(null);
    }
  };

  const handleDeleteCleaner = async (id: number) => {
    if (!confirm('Are you sure you want to remove this cleaner?')) return;
    try {
      const res = await fetch(`/api/cleaners/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to remove cleaner');
      }
    } catch (e) {
      alert('Network error removing cleaner');
    }
  };

  // Format display month label
  const [payYear, payMonth] = selectedMonth.split('-').map(Number);
  const displayMonth = `${MONTH_NAMES_SHORT[payMonth - 1]} ${payYear}`;

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-4 md:space-y-6 pb-24">
      {/* Alert Banner */}
      {alertDays.length > 0 && (
      <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] p-3 md:p-4 flex items-start gap-3">
        <AlertTriangle
          className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5"
          strokeWidth={2} />

        <p className="text-[13px] md:text-[14px] text-[#991B1B] leading-relaxed">
          <span className="font-semibold">
            No cleaner available on {alertDays.join(', ')}.
          </span>{' '}
          Consider finding backup coverage.
        </p>
      </div>
      )}

      {/* "Combined Availability & Jobs" stood here.
          It drew a week grid from each cleaner's weekly pattern alone —
          no date overrides — so a day somebody had marked themselves off
          still showed a green tick, and a week they had swapped looked
          identical to every other week. The calendar answers the same
          question from the same data the assignment service uses, per
          date, and lets you act on it. Two answers, one of them wrong,
          is worse than one. */}

      {/* Your Cleaners.
          Collapsed by default. Each card carries a photo-sized avatar,
          the properties, a week of day pills, the rate and five buttons —
          three of those pushed the pay summary off the bottom of the
          screen, and the thing you open this page for is usually a name
          and a number. */}
      <div>
        <button
          onClick={() => setCleanersOpen(!cleanersOpen)}
          className="w-full flex items-center justify-between mb-3 md:mb-4 text-left">
          <h2 className="text-[16px] md:text-[18px] font-semibold text-[#222222]">
            Your cleaners <span className="text-[#717171] font-normal">({cleaners.length})</span>
          </h2>
          <ChevronDown
            className={`w-5 h-5 text-[#717171] transition-transform ${cleanersOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Closed, it is still a list — just one line each, which is what
            you need to see who there is. */}
        {!cleanersOpen &&
        <div className="bg-white rounded-[12px] border border-[#EBEBEB] overflow-hidden mb-2">
            {cleaners.map((cleaner, ci) =>
          <div key={cleaner.id} className="border-b border-[#F0F0F0] last:border-0">
              <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA]">
                <button
              onClick={() => setViewingCleaner(cleaner)}
              className="flex-1 min-w-0 flex items-center gap-3 text-left">
                <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-[13px] shrink-0"
              style={{ backgroundColor: COLORS[ci % COLORS.length] }}>
                  {cleaner.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-[14px] font-medium text-[#222222] truncate">{cleaner.name}</span>
                <span className="text-[13px] text-[#717171] truncate ml-auto">
                  {cleaner.properties.length === 0 ?
              'No properties' :
              cleaner.properties.map((p) => p.name).join(', ')}
                </span>
                </button>

                {/* Inviting somebody is the one thing you do to a cleaner
                    who is not set up yet, and it used to be a tap away.
                    Making this row open their calendar left it behind a
                    section chevron that looks nothing like an invitation,
                    where it could be looked for twice and not found. */}
                <button
              onClick={() => handleInvite(cleaner.id)}
              disabled={invitingId === cleaner.id}
              className="shrink-0 px-2.5 py-1.5 text-[12px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222] disabled:opacity-60">
                  {invitingId === cleaner.id ? 'Creating…' : 'Invite'}
                </button>
              </div>

              {/* The link, under the row that issued it. Rendered here as
                  well as on the card, because a button whose result is
                  only visible somewhere else is a button that looks
                  broken. */}
              {invite && invite.cleanerId === cleaner.id &&
            <div className={`mx-4 mb-3 p-3 rounded-[8px] border ${
            invite.sent ? 'bg-[#F0FDF4] border-[#86EFAC]' : 'bg-[#FFFBEB] border-[#FCD34D]'}`}>
                  {invite.sent ?
              <p className="text-[12px] font-medium text-[#166534]">
                      Sent to {cleaner.name} on WhatsApp. The link works once, for {invite.days} days.
                    </p> :

              <>
                      <p className="text-[12px] text-[#92400E] mb-1.5">
                        Send this to {cleaner.name} yourself. It works once, for {invite.days} days.
                      </p>
                      <div className="flex gap-2">
                        <input
                    readOnly
                    value={invite.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-2 py-1.5 text-[12px] bg-white border border-[#FCD34D] rounded-[6px] text-[#222222]" />
                        <button
                    onClick={() => navigator.clipboard?.writeText(invite.url)}
                    className="shrink-0 px-2.5 py-1.5 text-[12px] font-medium bg-white border border-[#FCD34D] rounded-[6px] text-[#92400E]">
                          Copy
                        </button>
                      </div>
                    </>
              }
                </div>
            }
            </div>
          )}
            {cleaners.length === 0 &&
          <p className="px-4 py-3 text-[13px] text-[#717171]">Nobody yet.</p>
          }
          </div>
        }

        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${cleanersOpen ? '' : 'hidden'}`}>
          {cleaners.map((cleaner, ci) => {
            const color = COLORS[ci % COLORS.length];
            // Build availability day letters: Mon-Sun order (day_of_week 1,2,3,4,5,6,0)
            const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
            const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
            const availSet = new Set(cleaner.availability.map((a) => a.day_of_week));

            return (
              <div key={cleaner.id} className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
                <div className="p-4 md:p-5 border-b border-[#F0F0F0] flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-[16px]" style={{ backgroundColor: color }}>
                      {cleaner.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-[14px] md:text-[15px] font-semibold text-[#222222]">
                        {cleaner.name}
                      </div>
                      <div className="text-[12px] md:text-[13px] text-[#717171]">
                        {cleaner.phone || 'No phone'}
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#ECFDF5] text-[#10B981] px-2 py-1 rounded-[4px] text-[11px] md:text-[12px] font-semibold">
                    {formatRate(cleaner)}
                  </div>
                </div>
                <div className="p-4 md:p-5 space-y-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-2">
                      Assigned Properties
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {cleaner.properties.length > 0 ? cleaner.properties.map((p) => (
                        <div key={p.id} className="inline-block bg-[#F0F9FF] text-[#007AFF] px-2.5 py-1 rounded-[4px] text-[11px] md:text-[12px] font-medium">
                          {p.name}
                        </div>
                      )) : (
                        <span className="text-[12px] text-[#B0B0B0]">None</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.3px] text-[#B0B0B0] mb-2">
                      Usual days
                    </div>
                    <div className="flex gap-1.5">
                      {dayOrder.map((dow, i) => {
                        const on = availSet.has(dow);
                        const busy = togglingDay === `${cleaner.id}:${dow}`;
                        return (
                          <button
                            key={i}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${DAY_NAMES_SHORT[dow]} — ${on ? 'works' : 'does not work'}`}
                            title={`${DAY_NAMES_SHORT[dow]} — tap to ${on ? 'take off' : 'add'}`}
                            disabled={busy}
                            onClick={() => toggleUsualDay(cleaner, dow)}
                            className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center text-[10px] md:text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                            on ?
                            'bg-[#007AFF] text-white hover:bg-[#0062CC]' :
                            'bg-[#F0F0F0] text-[#B0B0B0] hover:bg-[#E0E0E0]'}`}>
                            {dayLetters[i]}
                          </button>);

                      })}
                    </div>
                    {/* Said once, under the thing it describes, because a
                        circle that changes colour is not obviously a save. */}
                    <p className="text-[11px] text-[#B0B0B0] mt-1.5">
                      Tap a day to change it. Single dates go under Availability.
                    </p>
                    {dayError && togglingDay === null &&
                    <p className="text-[11px] text-[#991B1B] mt-1">{dayError}</p>
                    }
                  </div>
                </div>
                {/* The invitation link, once issued. Shown here rather than
                    in a toast because it has to be copied, and a message
                    that vanishes is no use for that. */}
                {invite && invite.cleanerId === cleaner.id &&
                <div className={`mx-3 md:mx-4 mb-3 mt-1 p-3 rounded-[8px] border ${
                invite.sent ?
                'bg-[#F0FDF4] border-[#86EFAC]' :
                'bg-[#FFFBEB] border-[#FCD34D]'}`}>

                    {invite.sent ?
                  <p className="text-[12px] font-medium text-[#166534]">
                        Sent to {cleaner.name} on WhatsApp. The link works once, for {invite.days} days.
                      </p> :

                  <>
                        {/* The reason is shown rather than hidden. A message
                            that silently did not arrive is worse than one
                            that visibly did not. */}
                        <p className="text-[12px] font-medium text-[#92400E] mb-1">
                          Couldn't send on WhatsApp{invite.reason ? `: ${invite.reason}` : ''}
                        </p>
                        <p className="text-[12px] text-[#92400E] mb-1.5">
                          Send this to {cleaner.name} yourself. It works once, for {invite.days} days.
                        </p>
                        <div className="flex gap-2">
                          <input
                        readOnly
                        value={invite.url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 min-w-0 px-2 py-1.5 text-[12px] bg-white border border-[#FCD34D] rounded-[6px] text-[#222222]" />
                          <button
                        onClick={() => {
                          navigator.clipboard?.writeText(invite.url);
                          setInvite({ ...invite, copied: true });
                        }}
                        className="shrink-0 px-3 py-1.5 text-[12px] font-semibold bg-[#92400E] text-white rounded-[6px] hover:bg-[#78350F]">
                            {invite.copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </>
                  }
                  </div>
                }
                <div className="p-3 md:p-4 bg-[#F7F7F7] border-t border-[#F0F0F0] flex justify-end gap-2">
                  <button
                    onClick={() => handleInvite(cleaner.id)}
                    disabled={invitingId === cleaner.id}
                    className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222] disabled:opacity-60">
                    {invitingId === cleaner.id ? 'Creating…' : 'Invite'}
                  </button>
                  {/* The schedule is what they usually do; this is what
                      they are actually doing. */}
                  <button
                    onClick={() => setViewingCleaner(cleaner)}
                    className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222]">
                    Availability
                  </button>
                  <button
                    onClick={() => setAskingCleaner(cleaner)}
                    className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-[#222222] border border-[#222222] rounded-[6px] hover:bg-black text-white">
                    Ask to clean
                  </button>
                  <button
                    onClick={() => handleEditCleaner(cleaner)}
                    className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222]">
                    Edit
                  </button>
                  <button
                    onClick={() => handleEditCleaner(cleaner, 'availability')}
                    className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#EBEBEB] rounded-[6px] hover:bg-[#F0F0F0] text-[#222222]">
                    Schedule
                  </button>
                  <button
                    onClick={() => handleDeleteCleaner(cleaner.id)}
                    className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium bg-white border border-[#FCA5A5] rounded-[6px] hover:bg-[#FEF2F2] text-[#DC2626]">
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {cleaners.length === 0 && (
          <p className="text-[13px] text-[#717171] mt-2">No cleaners added yet. Add one below.</p>
        )}
      </div>

      {/* Add New Cleaner */}
      <div>
        {!showAddForm ?
        <button
          onClick={() => { resetForm(); setShowAddForm(true); }}
          className="flex items-center gap-2 text-[#007AFF] font-semibold text-[14px] hover:underline">

            <Plus className="w-4 h-4" />
            Add New Cleaner
          </button> :

        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
            <div className="p-4 md:p-5 border-b border-[#EBEBEB] flex justify-between items-center bg-[#F7F7F7]">
              <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
                {editingId ? 'Edit Cleaner' : 'Add New Cleaner'}
              </h2>
              <button
              onClick={() => { setShowAddForm(false); resetForm(); }}
              className="text-[#717171] hover:text-[#222222]">

                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 md:p-6 space-y-5 md:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Name
                  </label>
                  <input
                  type="text"
                  placeholder="Full name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />

                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Phone (WhatsApp)
                  </label>
                  <input
                  type="text"
                  placeholder="+27821234567"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />

                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    PIN (4 digits) <span className="font-normal text-[#717171]">optional</span>
                  </label>
                  <input
                  type="text"
                  placeholder="1234"
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value)}
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />
                  <p className="mt-1 text-[11px] text-[#717171]">
                    {editingId ?
                    'Leave blank to keep their current PIN.' :
                    'Leave blank — Invite lets them choose their own.'}
                  </p>

                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Rate (ZAR)
                  </label>
                  <input
                  type="text"
                  placeholder="0"
                  value={formRate}
                  onChange={(e) => setFormRate(e.target.value)}
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />

                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Rate Type
                  </label>
                  <select
                    value={formRateType}
                    onChange={(e) => setFormRateType(e.target.value)}
                    className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] bg-white">
                    <option value="hourly">Hourly</option>
                    <option value="flat">Per Clean</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                    Email (optional)
                  </label>
                  <input
                  type="email"
                  placeholder="email@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full h-10 px-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]" />

                </div>
              </div>

              <div>
                <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-2">
                  Assign to Properties
                </label>
                <div className="space-y-2 border border-[#EBEBEB] rounded-[8px] p-3">
                  {properties.map((prop) =>
                <label key={prop.id} className="flex items-center gap-2">
                      <input
                    type="checkbox"
                    checked={formPropertyIds.includes(prop.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormPropertyIds([...formPropertyIds, prop.id]);
                      } else {
                        setFormPropertyIds(formPropertyIds.filter((pid) => pid !== prop.id));
                      }
                    }}
                    className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />

                      <span className="text-[13px] md:text-[14px] text-[#222222]">
                        {prop.name}
                      </span>
                    </label>
                )}
                  {properties.length === 0 && (
                    <span className="text-[13px] text-[#717171]">No properties found.</span>
                  )}
                </div>
              </div>

              <div ref={availabilityRef}>
                <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-3">
                  Weekly Availability
                </label>
                {/* Mobile: Vertical List */}
                <div className="block md:hidden space-y-3">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                  (day, idx) =>
                  <div
                    key={day}
                    className="flex items-center gap-3 bg-[#F7F7F7] p-2 rounded-[8px]">

                        <div className="flex items-center gap-2 w-[70px]">
                          <input
                        type="checkbox"
                        checked={formAvailability[idx].enabled}
                        onChange={(e) => {
                          const updated = [...formAvailability];
                          updated[idx] = { ...updated[idx], enabled: e.target.checked };
                          setFormAvailability(updated);
                        }}
                        className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />

                          <span className="text-[13px] font-medium text-[#222222]">
                            {day}
                          </span>
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                            <input
                          type="text"
                          value={formAvailability[idx].start}
                          onChange={(e) => {
                            const updated = [...formAvailability];
                            updated[idx] = { ...updated[idx], start: e.target.value };
                            setFormAvailability(updated);
                          }}
                          className="w-full text-[12px] text-center focus:outline-none" />

                          </div>
                          <span className="text-[12px] text-[#717171]">-</span>
                          <div className="flex-1 flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                            <input
                          type="text"
                          value={formAvailability[idx].end}
                          onChange={(e) => {
                            const updated = [...formAvailability];
                            updated[idx] = { ...updated[idx], end: e.target.value };
                            setFormAvailability(updated);
                          }}
                          className="w-full text-[12px] text-center focus:outline-none" />

                          </div>
                        </div>
                      </div>

                )}
                </div>

                {/* Desktop: Grid */}
                <div className="hidden md:grid grid-cols-7 gap-4">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                  (day, idx) =>
                  <div
                    key={day}
                    className="flex flex-col items-center gap-2">

                        <div className="flex items-center gap-2">
                          <input
                        type="checkbox"
                        checked={formAvailability[idx].enabled}
                        onChange={(e) => {
                          const updated = [...formAvailability];
                          updated[idx] = { ...updated[idx], enabled: e.target.checked };
                          setFormAvailability(updated);
                        }}
                        className="w-4 h-4 rounded border-[#EBEBEB] text-[#007AFF] focus:ring-[#007AFF]" />

                          <span className="text-[13px] font-medium text-[#222222]">
                            {day}
                          </span>
                        </div>
                        <div className="w-full flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                          <input
                        type="text"
                        value={formAvailability[idx].start}
                        onChange={(e) => {
                          const updated = [...formAvailability];
                          updated[idx] = { ...updated[idx], start: e.target.value };
                          setFormAvailability(updated);
                        }}
                        className="w-full text-[12px] text-center focus:outline-none" />

                        </div>
                        <div className="w-full flex items-center border border-[#EBEBEB] rounded-[6px] px-2 py-1 bg-white">
                          <input
                        type="text"
                        value={formAvailability[idx].end}
                        onChange={(e) => {
                          const updated = [...formAvailability];
                          updated[idx] = { ...updated[idx], end: e.target.value };
                          setFormAvailability(updated);
                        }}
                        className="w-full text-[12px] text-center focus:outline-none" />

                        </div>
                      </div>

                )}
                </div>
              </div>

              <div>
                <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
                  Notes
                </label>
                <textarea
                placeholder="e.g. deep cleaning specialist, has own transport"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="w-full h-20 p-3 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] resize-none">
              </textarea>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-[#F0F0F0]">
                <button
                onClick={() => { setShowAddForm(false); resetForm(); }}
                className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-[#222222] bg-white border border-[#EBEBEB] rounded-[8px] hover:bg-[#F7F7F7]">

                  Cancel
                </button>
                <button
                onClick={handleAddCleaner}
                className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-white bg-[#007AFF] rounded-[8px] hover:bg-[#0066CC] shadow-[0_1px_3px_rgba(0,122,255,0.3)]">

                  {editingId ? 'Save Changes' : 'Add Cleaner'}
                </button>
              </div>
            </div>
          </div>
        }
      </div>

      {/* Info Banner */}
      <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] p-3 md:p-4 flex items-start gap-3">
        <Info
          className="w-5 h-5 text-[#2563EB] flex-shrink-0 mt-0.5"
          strokeWidth={2} />

        <p className="text-[12px] md:text-[13px] text-[#1E3A8A] leading-relaxed">
          <span className="font-semibold">Cleaner Self-Service Portal:</span>{' '}
          Each cleaner can log in with their phone number to set their own
          availability, view upcoming jobs, and update their calendar. Send them
          their login link from the cleaner's Edit view.
        </p>
      </div>

      {/* Pay Summary */}
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] p-4 md:p-6">
        <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222] mb-3 md:mb-4">
          Pay Summary
        </h2>
        <div className="max-w-md">
          <label className="block text-[12px] md:text-[13px] font-medium text-[#222222] mb-1.5">
            Month
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full h-10 pl-3 pr-10 border border-[#EBEBEB] rounded-[8px] text-[13px] md:text-[14px] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF] bg-white cursor-pointer" />

              <CalendarIcon className="w-4 h-4 text-[#717171] absolute right-3 top-3 pointer-events-none" />
            </div>
            <button className="w-full sm:w-auto px-4 py-2 text-[13px] md:text-[14px] font-semibold text-[#222222] bg-[#F7F7F7] border border-[#EBEBEB] rounded-[8px] hover:bg-[#F0F0F0]">
              Export CSV
            </button>
          </div>
          {paySummary ? (
            <div className="mt-3 md:mt-4 space-y-3">
              {paySummary.cleaners.length === 0 ? (
                <p className="text-[12px] md:text-[13px] text-[#717171]">
                  No cleaning jobs recorded for {displayMonth}.
                </p>
              ) : (
                <>
                  {paySummary.cleaners.map((c) => (
                    <div key={c.cleaner_id} className="flex justify-between items-center py-2 border-b border-[#F0F0F0]">
                      <span className="text-[13px] text-[#222222]">{c.cleaner_name}</span>
                      <span className="text-[13px] font-semibold text-[#222222]">R {c.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-[14px] font-semibold text-[#222222]">Total</span>
                    <span className="text-[14px] font-bold text-[#222222]">R {paySummary.grand_total.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-[12px] md:text-[13px] text-[#717171] mt-2 md:mt-3">
              Select a month to view pay summary.
            </p>
          )}
        </div>
      </div>

      {askedNote &&
      <p className="mt-3 text-[13px] text-[#0F6E56]">{askedNote}</p>
      }

      {viewingCleaner &&
      <CleanerDetailSheet
        cleanerId={viewingCleaner.id}
        cleanerName={viewingCleaner.name}
        onClose={() => setViewingCleaner(null)} />
      }

      {askingCleaner &&
      <RequestCleanerDialog
        cleaner={askingCleaner}
        properties={properties}
        onClose={() => setAskingCleaner(null)}
        onDone={(m) => { setAskingCleaner(null); setAskedNote(m); fetchData(); }} />
      }
    </div>);

}
