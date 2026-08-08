import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Info,
  Calendar as CalendarIcon,
  Plus,
  X,
  Check } from
'lucide-react';

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
  // Schedule and Edit open the same form — the weekly availability lives
  // in it — so Schedule scrolls straight to that section rather than
  // dropping the user at the top of a long form.
  const [focusAvailability, setFocusAvailability] = useState(false);
  const availabilityRef = React.useRef<HTMLDivElement>(null);
  const [invitingId, setInvitingId] = useState<number | null>(null);
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

      {/* Combined Availability & Jobs */}
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
        <div className="p-4 md:p-5 border-b border-[#EBEBEB] flex flex-col sm:flex-row sm:items-center justify-between gap-3 md:gap-4">
          <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
            Combined Availability & Jobs
          </h2>
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1 md:gap-2">
              <button
                onClick={() => setWeekOffset(weekOffset - 1)}
                className="w-8 h-8 flex items-center justify-center rounded-[6px] border border-[#EBEBEB] hover:bg-[#F7F7F7] text-[#717171]">

                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[13px] md:text-[14px] font-medium text-[#222222] min-w-[120px] md:min-w-[140px] text-center">
                {weekRangeLabel}
              </span>
              <button
                onClick={() => setWeekOffset(weekOffset + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-[6px] border border-[#EBEBEB] hover:bg-[#F7F7F7] text-[#717171]">

                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 text-[12px] md:text-[13px] font-medium border border-[#EBEBEB] rounded-[6px] hover:bg-[#F7F7F7] text-[#222222]">

              Today
            </button>
          </div>
        </div>
        <div className="p-4 md:p-5 overflow-x-auto">
          <div className="min-w-[500px]">
            {/* Header Row */}
            <div className="flex mb-2">
              <div className="w-[80px] md:w-[120px] flex-shrink-0"></div>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {days.map((d, i) =>
                <div
                  key={i}
                  className={`text-center pb-2 ${d.active ? 'border-b-2 border-[#007AFF]' : ''}`}>

                    <div
                    className={`text-[10px] md:text-[11px] font-medium ${d.active ? 'text-[#007AFF]' : 'text-[#717171]'}`}>

                      {d.day} {d.date}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cleaner Rows */}
            {cleaners.map((cleaner, ci) => {
              const color = COLORS[ci % COLORS.length];
              const availSet = new Set(cleaner.availability.map((a) => a.day_of_week));
              return (
                <div key={cleaner.id} className="flex items-center py-2 border-b border-[#F0F0F0]">
                  <div className="w-[80px] md:w-[120px] flex-shrink-0 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></div>
                    <span className="text-[13px] md:text-[14px] text-[#222222] truncate">
                      {cleaner.name}
                    </span>
                  </div>
                  <div className="flex-1 grid grid-cols-7 gap-1">
                    {days.map((d, i) =>
                    <div key={i} className="flex justify-center items-center">
                        {availSet.has(d.jsDay) ?
                      <div className="w-full max-w-[40px] h-7 md:h-8 bg-[#ECFDF5] rounded-[4px] flex items-center justify-center">
                            <Check
                          className="w-3 h-3 md:w-4 md:h-4 text-[#10B981]"
                          strokeWidth={3} />

                          </div> :

                      <div className="w-full max-w-[40px] h-7 md:h-8 bg-[#F7F7F7] rounded-[4px] flex items-center justify-center">
                            <span className="text-[#B0B0B0] text-[14px] md:text-[16px] leading-none">
                              -
                            </span>
                          </div>
                      }
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {cleaners.length === 0 && (
              <div className="flex items-center py-4 text-center">
                <span className="text-[13px] text-[#717171] w-full">No cleaners added yet.</span>
              </div>
            )}

            {/* Coverage Row */}
            <div className="flex items-center py-3">
              <div className="w-[80px] md:w-[120px] flex-shrink-0">
                <span className="text-[13px] md:text-[14px] font-medium text-[#222222]">
                  Coverage
                </span>
              </div>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {coverage.map((count, i) =>
                <div key={i} className="flex justify-center items-center">
                    <div
                    className={`w-full max-w-[40px] h-7 md:h-8 rounded-[4px] flex items-center justify-center text-[12px] md:text-[13px] font-bold ${count > 0 ? 'bg-[#FFFBEB] text-[#D97706]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>

                      {count}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Jobs */}
      <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] border border-[#EBEBEB] overflow-hidden">
        <div className="p-4 md:p-5 border-b border-[#EBEBEB]">
          <h2 className="text-[15px] md:text-[16px] font-semibold text-[#222222]">
            Upcoming Jobs (Next 7 Days)
          </h2>
        </div>

        {/* Mobile Card Layout */}
        <div className="block sm:hidden">
          {cleaningJobs.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-[#717171]">
              No upcoming jobs.
            </div>
          ) : (
            <div className="divide-y divide-[#F0F0F0]">
              {cleaningJobs.map((job) => (
                <div key={job.id} className="p-4 space-y-1">
                  <div className="text-[13px] font-semibold text-[#222222]">{job.property_name}</div>
                  <div className="text-[12px] text-[#717171]">{job.cleaning_date}</div>
                  <div className="text-[12px] text-[#717171]">{job.cleaner_name || 'Unassigned'}</div>
                  <div className="inline-block mt-1 px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-[#FFFBEB] text-[#D97706]">
                    {job.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Table Layout */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[#F7F7F7] text-[#717171]">
              <tr>
                <th className="p-3 pl-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Date
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Time
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Property
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Type
                </th>
                <th className="p-3 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Cleaner
                </th>
                <th className="p-3 pr-5 font-semibold uppercase tracking-[0.3px] text-[10px]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {cleaningJobs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-[13px] text-[#717171]">

                  No upcoming jobs.
                </td>
              </tr>
              ) : (
                cleaningJobs.map((job) => (
                  <tr key={job.id} className="border-b border-[#F0F0F0]">
                    <td className="p-3 pl-5 text-[13px] text-[#222222]">{job.cleaning_date}</td>
                    <td className="p-3 text-[13px] text-[#717171]">-</td>
                    <td className="p-3 text-[13px] text-[#222222]">{job.property_name}</td>
                    <td className="p-3 text-[13px] text-[#717171]">Clean</td>
                    <td className="p-3 text-[13px] text-[#222222]">{job.cleaner_name || 'Unassigned'}</td>
                    <td className="p-3 pr-5">
                      <span className="inline-block px-2 py-0.5 rounded-[4px] text-[11px] font-semibold bg-[#FFFBEB] text-[#D97706]">
                        {job.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Your Cleaners */}
      <div>
        <h2 className="text-[16px] md:text-[18px] font-semibold text-[#222222] mb-3 md:mb-4">
          Your Cleaners
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                      Availability
                    </div>
                    <div className="flex gap-1.5">
                      {dayOrder.map((dow, i) =>
                        availSet.has(dow) ? (
                          <div
                            key={i}
                            className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[#007AFF] text-white flex items-center justify-center text-[10px] md:text-[11px] font-semibold">
                              {dayLetters[i]}
                          </div>
                        ) : (
                          <div
                            key={i}
                            className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[#F0F0F0] text-[#B0B0B0] flex items-center justify-center text-[10px] md:text-[11px] font-semibold">
                              {dayLetters[i]}
                          </div>
                        )
                      )}
                    </div>
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
    </div>);

}
