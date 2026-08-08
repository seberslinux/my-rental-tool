import React, { useEffect, useState } from 'react';
import { Home, LogOut, MapPin, Clock, Users } from 'lucide-react';

interface Job {
  id: number;
  property_name: string;
  property_address: string | null;
  cleaning_date: string;
  start_time: string;
  end_time: string;
  status: string;
  guest_name: string | null;
  num_guests: number | null;
  special_requirements: string | null;
  check_in: string | null;
}

interface CleanerDashboardProps {
  onSignOut: () => void;
}

/**
 * What a cleaner sees.
 *
 * There was no such screen. A cleaner who logged in was handed the
 * manager's app — home, calendar, analytics, finances — and the API
 * answered: revenue KPIs, guest names and what they paid, the other
 * cleaners' rates. That is now refused at the door, which without this
 * page would leave a cleaner staring at a shell of failed requests.
 *
 * The job is a short one: where am I going, when, and is anyone arriving
 * after me. Nothing here reports money.
 */
export function CleanerDashboard({ onSignOut }: CleanerDashboardProps) {
  const [name, setName] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [meRes, jobsRes] = await Promise.all([
          fetch('/api/cleaner-portal/me', { credentials: 'same-origin' }),
          fetch('/api/cleaner-portal/jobs', { credentials: 'same-origin' }),
        ]);
        if (meRes.ok) setName((await meRes.json()).name || '');
        if (!jobsRes.ok) throw new Error('Could not load your jobs');
        setJobs(await jobsRes.json());
      } catch (err: any) {
        setError(err.message || 'Something went wrong');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = new Date();
  const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = iso(today);

  // Past jobs are dropped rather than greyed: a cleaner opening this is
  // asking what is next, not reviewing what is done.
  const upcoming = jobs.filter((j) => j.cleaning_date >= todayStr);
  const todays = upcoming.filter((j) => j.cleaning_date === todayStr);
  const later = upcoming.filter((j) => j.cleaning_date > todayStr);

  const dayLabel = (date: string) => {
    const d = new Date(date + 'T00:00:00');
    const diff = Math.round((d.getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'short' });
  };

  const JobCard = ({ job }: { job: Job }) =>
  <div className="bg-white rounded-[12px] border border-[#EBEBEB] p-4 mb-3">
      <div className="flex justify-between items-start gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[#222222] truncate">
            {job.property_name}
          </p>
          {job.property_address &&
        <p className="text-[13px] text-[#717171] flex items-center gap-1 mt-0.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{job.property_address}</span>
            </p>
        }
        </div>
        <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full bg-[#F0F0F0] text-[#717171] uppercase tracking-[0.3px]">
          {job.status}
        </span>
      </div>

      <p className="text-[14px] text-[#222222] flex items-center gap-1.5">
        <Clock className="w-4 h-4 text-[#717171]" />
        {job.start_time}–{job.end_time}
      </p>

      {/* The next arrival is the deadline, and the only reason a cleaner
          needs to know anything about a guest at all. No name, no price. */}
      {job.check_in === job.cleaning_date &&
    <p className="mt-2 text-[13px] text-[#C13515] flex items-center gap-1.5">
          <Users className="w-4 h-4 shrink-0" />
          Guests arrive today{job.num_guests ? ` · ${job.num_guests} people` : ''}
        </p>
    }

      {job.special_requirements &&
    <p className="mt-2 text-[13px] text-[#222222] bg-[#F7F7F7] rounded-[8px] px-3 py-2">
          {job.special_requirements}
        </p>
    }
    </div>;

  return (
    <div className="min-h-screen bg-[#F7F7F7] font-sans text-[#222222] antialiased">
      <div className="bg-white border-b border-[#EBEBEB] px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#FF385C14] rounded-full flex items-center justify-center">
            <Home className="w-4 h-4 text-[#FF385C]" strokeWidth={2} />
          </div>
          <span className="text-[16px] font-bold">My Cleanings</span>
        </div>
        <button
          onClick={onSignOut}
          aria-label="Sign out"
          className="p-2 rounded-full hover:bg-[#F7F7F7] text-[#717171]">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 max-w-[560px] mx-auto">
        {name && <h1 className="text-[22px] font-bold mb-4">Hi {name}</h1>}

        {loading && <p className="text-[14px] text-[#717171]">Loading your jobs…</p>}

        {error &&
        <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-[8px] px-3 py-2 text-[13px] text-[#991B1B]">
            {error}
          </div>
        }

        {!loading && !error && upcoming.length === 0 &&
        <div className="bg-white rounded-[12px] border border-[#EBEBEB] p-6 text-center">
            <p className="text-[15px] font-medium mb-1">Nothing scheduled</p>
            <p className="text-[13px] text-[#717171]">
              You'll see your cleanings here once they're assigned.
            </p>
          </div>
        }

        {todays.length > 0 &&
        <>
            <p className="text-[12px] font-semibold text-[#717171] uppercase tracking-[0.5px] mb-2">
              Today
            </p>
            {todays.map((j) => <JobCard key={j.id} job={j} />)}
          </>
        }

        {later.length > 0 &&
        <>
            <p className="text-[12px] font-semibold text-[#717171] uppercase tracking-[0.5px] mb-2 mt-6">
              Coming up
            </p>
            {later.map((j) =>
          <div key={j.id}>
                <p className="text-[13px] font-medium text-[#717171] mb-1.5">
                  {dayLabel(j.cleaning_date)}
                </p>
                <JobCard job={j} />
              </div>
          )}
          </>
        }
      </div>
    </div>);

}
