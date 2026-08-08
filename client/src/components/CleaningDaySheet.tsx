import React, { useState } from 'react';
import { X, Check, AlertCircle, UserPlus } from 'lucide-react';
import { CleaningDay } from '../data/properties';

/**
 * One day's cleaning, and the means to fix it.
 *
 * Every checkout needs a cleaner or its nights get blocked. That rule was
 * already enforced by the assignment service and visible nowhere: the
 * manager's calendar drew a dot from pending jobs keyed by day-of-month
 * and knew nothing about who was free. Deciding who cleans meant guessing
 * from another screen.
 *
 * The order here is the order of the questions actually being asked. What
 * needs a cleaner. Who is already coming. Who could. Anything that cannot
 * be acted on is stated rather than offered — a name shown with no way to
 * pick it is worse than not showing it.
 */

export function CleaningDaySheet({
  date, day, propertyName, onClose, onAssigned,
}: {
  date: string;
  day: CleaningDay | undefined;
  propertyName: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  const jobs = day?.jobs || [];
  const unmet = day?.unmet || [];
  const free = day?.available || [];

  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const assign = async (cleanerId: number, propertyId: number, bookingId: number) => {
    setBusy(cleanerId);
    setError('');
    const res = await fetch('/api/cleaners/jobs/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        cleaner_id: cleanerId,
        property_id: propertyId,
        booking_id: bookingId,
        cleaning_date: date,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not assign that');
      return;
    }
    onAssigned();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      max-h-[85vh] overflow-y-auto
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[440px] sm:rounded-2xl sm:pb-5 sm:max-h-[80vh]">

        <div className="flex justify-between items-start">
          <div>
            <p className="text-[18px] font-semibold">{label}</p>
            <p className="text-[13px] text-[#717171]">{propertyName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        {error && <p className="mt-3 text-[13px] text-[#991B1B]">{error}</p>}

        {/* What needs doing and has nobody. First, because it is the only
            thing on this screen that is a problem. */}
        {unmet.map((u) =>
        <div key={u.booking_id} className="mt-4 border border-[#F0C36D] bg-[#FFFBEB] rounded-[10px] p-3">
            <p className="text-[14px] font-medium flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-[#BA7517]" />
              {u.property_name} checks out — no cleaner
            </p>

            {free.filter((c) => c.property_ids.includes(u.property_id)).length === 0 ?
          <p className="text-[13px] text-[#717171] mt-1.5">
                Nobody assigned to this property is free. Without a cleaner these
                nights get blocked.
              </p> :

          <div className="mt-2 flex flex-wrap gap-2">
                {free.filter((c) => c.property_ids.includes(u.property_id)).map((c) =>
            <button
              key={c.id}
              disabled={busy === c.id}
              onClick={() => assign(c.id, u.property_id, u.booking_id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-60">
                    <UserPlus className="w-4 h-4" />
                    {busy === c.id ? 'Assigning…' : c.name}
                  </button>
            )}
              </div>
          }
          </div>
        )}

        {/* Who is already coming. */}
        {jobs.length > 0 &&
        <div className="mt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
              Scheduled
            </p>
            {jobs.map((j) =>
          <div key={j.id} className="flex items-start gap-2 py-2 border-b border-[#F0F0F0] last:border-0">
                {j.cleaner_available ?
            <Check className="w-4 h-4 text-[#0F6E56] mt-0.5 shrink-0" /> :
            <AlertCircle className="w-4 h-4 text-[#BA7517] mt-0.5 shrink-0" />
            }
                <div className="min-w-0">
                  <p className="text-[14px]">
                    {j.property_name} — {j.cleaner_name || 'nobody'}
                  </p>
                  {/* Assigned is not the same as still willing, and this
                      is the only place that difference is visible. */}
                  {!j.cleaner_available && j.cleaner_name &&
              <p className="text-[13px] text-[#92400E]">
                      {j.cleaner_name} has marked themselves unavailable that day.
                    </p>
              }
                  <p className="text-[12px] text-[#717171] capitalize">{j.status}</p>
                </div>
              </div>
          )}
          </div>
        }

        {/* Who could work, whether or not anything needs them. This is the
            half the manager could never see. */}
        <div className="mt-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
            Free that day
          </p>
          {free.length === 0 ?
          <p className="text-[13px] text-[#717171]">Nobody is available.</p> :

          <p className="text-[13px]">{free.map((c) => c.name).join(', ')}</p>
          }
        </div>

        {unmet.length === 0 && jobs.length === 0 &&
        <p className="mt-4 text-[13px] text-[#717171]">Nothing checks out that day.</p>
        }
      </div>
    </>);

}
