import React from 'react';
import { Check, UserCheck, UserX, TriangleAlert } from 'lucide-react';
/**
 * Only the three lists these marks actually read. Asking for the whole
 * CleaningDay would tie this to whichever caller has the widest type —
 * the month grid declares a narrower one of its own.
 */
export interface MarkSource {
  available: {property_ids: number[];}[];
  unmet: {property_id: number;}[];
  jobs: {
    property_id: number;cleaner_name: string | null;
    cleaner_available: boolean;status: string;
  }[];
}

/**
 * What is happening with the cleaning on one day, at one property.
 *
 * The month grid worked this out inline, and the timeline — the view you
 * get with more than one property — drew a single teal dot instead, from
 * a different source: a map keyed by day-of-month, built from the pending
 * jobs. Keyed by the number alone, so a job on the 11th of September put
 * a dot on the 11th of August too, and the timeline spans two months. The
 * dot was not only vague, it was often on the wrong day.
 *
 * So the marks live here, computed once, and both views render this.
 * Adding a third calendar cannot reintroduce a third answer.
 *
 * Icons rather than dots, and one mark per fact:
 *
 *   crossed-out person   a checkout with nobody on it — the only thing
 *                        here that has to be acted on. Amber if somebody
 *                        could still take it, red if nobody is free.
 *   warning triangle     assigned, then the cleaner marked themselves
 *                        off. Looks covered; is not.
 *   tick                 settled — somebody said yes and can still come.
 *   person with a tick   asked, no answer yet. Not the same as settled,
 *                        so not the same mark.
 *   a grey number        how many could take it. Context, not an alarm.
 */

export function marksFor(day: MarkSource | undefined, propertyId: number) {
  const jobs = day ? day.jobs.filter((j) => j.property_id === propertyId) : [];
  return {
    free: day ? day.available.filter((c) => c.property_ids.includes(propertyId)).length : 0,
    unmet: day ? day.unmet.some((u) => u.property_id === propertyId) : false,
    clash: jobs.some((j) => j.cleaner_name && !j.cleaner_available),
    settled: jobs.some(
      (j) => j.cleaner_name && j.cleaner_available &&
      ['confirmed', 'in_progress', 'completed'].includes(j.status)
    ),
    asked: jobs.some((j) => j.cleaner_name && j.status === 'pending'),
  };
}

/** True when the day should read as settled — used for the green tint. */
export function isSettled(day: MarkSource | undefined, propertyId: number) {
  const m = marksFor(day, propertyId);
  return m.settled && !m.clash && !m.unmet;
}

export function CleaningMarks({
  day, propertyId, compact = false,
}: {
  day: MarkSource | undefined;
  propertyId: number;
  /** The timeline's cells are narrower than the month grid's. */
  compact?: boolean;
}) {
  if (!day) return null;
  const m = marksFor(day, propertyId);
  if (!m.unmet && !m.clash && !m.settled && !m.asked && m.free === 0) return null;

  const box = compact ? 'px-0.5 py-0' : 'px-1 py-0.5';
  const icon = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div className={`flex items-center ${compact ? 'gap-0.5' : 'gap-1'}`}>
      {m.unmet &&
      <span
        title={m.free > 0 ? 'Checks out — no cleaner yet' : 'Checks out — no cleaner, and nobody free'}
        className={`flex items-center rounded-[4px] ${box} ${
        m.free > 0 ? 'bg-[#FAEEDA] text-[#854F0B]' : 'bg-[#FCEBEB] text-[#A32D2D]'}`}>
          <UserX className={icon} strokeWidth={2.25} />
        </span>
      }

      {m.clash && !m.unmet &&
      <span
        title="Assigned, but that cleaner is no longer available"
        className={`flex items-center rounded-[4px] ${box} bg-[#FAEEDA] text-[#854F0B]`}>
          <TriangleAlert className={icon} strokeWidth={2.25} />
        </span>
      }

      {m.settled && !m.unmet && !m.clash &&
      <span title="Confirmed" className="flex items-center text-[#0F6E56]">
          <Check className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} strokeWidth={3} />
        </span>
      }

      {m.asked && !m.settled && !m.unmet && !m.clash &&
      <span title="Asked, waiting for an answer" className="flex items-center text-[#717171]">
          <UserCheck className={icon} strokeWidth={2.25} />
        </span>
      }

      {m.free > 0 && !m.settled && !m.asked && !m.unmet &&
      <span
        title={`${m.free} cleaner${m.free === 1 ? '' : 's'} free`}
        className="text-[10px] leading-none text-[#B0B0B0] tabular-nums">
          {m.free}
        </span>
      }
    </div>);

}
