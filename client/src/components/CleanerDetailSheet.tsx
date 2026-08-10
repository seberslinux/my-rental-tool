import React, { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { MonthCalendar } from './MonthCalendar';

/**
 * When this cleaner can actually work.
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
 */

interface Day {state: 'free' | 'off' | 'booked';why: string;}
interface Job {
  id: number;cleaning_date: string;start_time: string;end_time: string;
  status: string;property_name: string;reason: string | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

  useEffect(() => {
    (async () => {
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
    })();
  }, [cleanerId]);

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
            <p className="text-[13px] text-[#717171]">Usually works {usual}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

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
            plainBars />

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
