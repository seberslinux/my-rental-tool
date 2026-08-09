import React, { useState } from 'react';
import { X, Check, AlertCircle, UserPlus } from 'lucide-react';
import { CleaningDay, properties as allProperties } from '../data/properties';

/**
 * One day at one property: what is happening, and who to send.
 *
 * Cleaning used to be something that only happened because a guest left.
 * Jobs were created solely by assignment, assignment runs off a checkout,
 * and the only thing offerable here was a checkout nobody was on. There
 * was no way to send somebody to prepare for an arrival, or for a deep
 * clean in a quiet week. The work belongs to the property; a booking, when
 * there is one, is only what prompted it.
 *
 * Two lists of people, deliberately kept apart. Whoever is free that day,
 * and whoever is not. The second is not hidden: a manager one cleaner
 * short needs to see who there is to ask before deciding to block the
 * nights instead. Asking is a request — the job is created pending and
 * the cleaner answers it — so the button says ask, and the message they
 * get says no is an answer.
 */

type Reason = 'checkout' | 'checkin' | 'other';

const REASONS: {key: Reason;label: string;hint: string;}[] = [
{ key: 'checkout', label: 'After checkout', hint: 'Starts when the guests leave' },
{ key: 'checkin', label: 'Before check-in', hint: 'Finished before the next guests arrive' },
{ key: 'other', label: 'Something else', hint: 'A morning at the property' }];


export function CleaningDaySheet({
  date, day, propertyId, propertyName, onClose, onAssigned,
  lockProperty = false, initialReason = 'checkout',
}: {
  date: string;
  day: CleaningDay | undefined;
  propertyId: number;
  propertyName: string;
  onClose: () => void;
  onAssigned: () => void;
  /**
   * True when the property came from the thing that was clicked — a
   * booking bar or a blocked bar is already about one property, and
   * offering to change it there would only invite a mis-tap. Opened from
   * a bare day, the property is a choice and the picker is shown.
   */
  lockProperty?: boolean;
  initialReason?: Reason;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState<Reason>(initialReason);
  const [note, setNote] = useState('');
  const [propId, setPropId] = useState(propertyId);

  const jobs = (day?.jobs || []).filter((j) => j.property_id === propId);
  const unmet = (day?.unmet || []).filter((u) => u.property_id === propId);
  const free = (day?.available || []).filter((c) => c.property_ids.includes(propId));
  const busyFolk = (day?.unavailable || []).filter((c) => c.property_ids.includes(propId));
  const chosenName = allProperties.find((p) => p.id === propId)?.name || propertyName;

  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const send = async (cleanerId: number) => {
    setBusy(cleanerId);
    setError('');
    const res = await fetch('/api/cleaners/jobs/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        cleaner_id: cleanerId,
        property_id: propId,
        // Attached to the booking only when the day actually has one to
        // attach to. Everything else belongs to the property alone.
        booking_id: reason === 'checkout' ? unmet[0]?.booking_id ?? null : null,
        cleaning_date: date,
        reason,
        note,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not assign that');
      return;
    }
    onAssigned();
  };

  const Person = ({ c, ask }: {c: {id: number;name: string;reason?: string;};ask: boolean;}) =>
  <button
    disabled={busy === c.id}
    onClick={() => send(c.id)}
    title={ask ? c.reason : undefined}
    className={`flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold disabled:opacity-60 ${
    ask ? 'border border-[#DDDDDD] bg-white text-[#222222]' : 'bg-[#222222] text-white'}`}>
      <UserPlus className="w-4 h-4" />
      {busy === c.id ? 'Sending…' : c.name}
      {ask && c.reason && <span className="font-normal text-[#717171]">· {c.reason}</span>}
    </button>;


  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      max-h-[85vh] overflow-y-auto
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[460px] sm:rounded-2xl sm:pb-5 sm:max-h-[80vh]">

        <div className="flex justify-between items-start">
          <div>
            <p className="text-[18px] font-semibold">{label}</p>
            <p className="text-[13px] text-[#717171]">{chosenName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        {/* Which property. Shown whenever the click did not already say —
            a day in the grid is a date, not a place, and the one on
            screen is only a default. */}
        {!lockProperty && allProperties.length > 1 &&
        <select
          value={propId}
          onChange={(e) => setPropId(Number(e.target.value))}
          className="mt-3 w-full px-3 py-2 border border-[#DDDDDD] rounded-[8px] text-[14px] bg-white">
            {allProperties.map((p) =>
          <option key={p.id} value={p.id}>{p.name}</option>
          )}
          </select>
        }

        {error && <p className="mt-3 text-[13px] text-[#991B1B]">{error}</p>}

        {/* A checkout nobody is on. Stated first, because it is the only
            thing here that is a problem rather than an option. */}
        {unmet.length > 0 &&
        <p className="mt-4 text-[14px] font-medium flex items-center gap-1.5 text-[#92400E]">
            <AlertCircle className="w-4 h-4 text-[#BA7517]" />
            Checks out that day, with no cleaner
          </p>
        }

        {/* Who is already coming. */}
        {jobs.length > 0 &&
        <div className="mt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
              Already booked
            </p>
            {jobs.map((j) =>
          <div key={j.id} className="flex items-start gap-2 py-2 border-b border-[#F0F0F0] last:border-0">
                {j.cleaner_available ?
            <Check className="w-4 h-4 text-[#0F6E56] mt-0.5 shrink-0" /> :
            <AlertCircle className="w-4 h-4 text-[#BA7517] mt-0.5 shrink-0" />
            }
                <div className="min-w-0">
                  <p className="text-[14px]">
                    {j.cleaner_name || 'Nobody'} · {j.start_time}–{j.end_time}
                    {j.reason && j.reason !== 'checkout' &&
                <span className="text-[#717171]"> · {j.reason === 'checkin' ? 'before check-in' : 'other'}</span>
                }
                  </p>
                  {j.note && <p className="text-[13px] text-[#717171]">{j.note}</p>}
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

        {/* Send somebody. Always offered — a day needs no booking to be
            worth a visit. */}
        <div className="mt-5 pt-4 border-t border-[#F0F0F0]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
            Send someone
          </p>

          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) =>
            <button
              key={r.key}
              onClick={() => setReason(r.key)}
              title={r.hint}
              className={`px-3 py-1.5 rounded-full text-[13px] border ${
              reason === r.key ?
              'bg-[#222222] text-white border-[#222222]' :
              'bg-white text-[#222222] border-[#DDDDDD]'}`}>
                {r.label}
              </button>
            )}
          </div>
          <p className="text-[12px] text-[#717171] mt-1.5">
            {REASONS.find((r) => r.key === reason)?.hint}
          </p>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything they should know (optional)"
            className="mt-2.5 w-full px-3 py-2 border border-[#DDDDDD] rounded-[8px] text-[13px]" />

          {free.length > 0 &&
          <div className="mt-3 flex flex-wrap gap-2">
              {free.map((c) => <Person key={c.id} c={c} ask={false} />)}
            </div>
          }

          {/* Not hidden. Being short of a cleaner is exactly when you need
              to know who there is to ask. */}
          {busyFolk.length > 0 &&
          <div className="mt-4">
              <p className="text-[13px] text-[#717171] mb-2">
                {free.length === 0 ?
              'Nobody is free that day. You can still ask:' :
              'Not free that day, but you can ask:'}
              </p>
              <div className="flex flex-wrap gap-2">
                {busyFolk.map((c) => <Person key={c.id} c={c} ask />)}
              </div>
              <p className="text-[12px] text-[#717171] mt-2">
                They will be asked rather than told, and can decline.
              </p>
            </div>
          }

          {free.length === 0 && busyFolk.length === 0 &&
          <p className="mt-3 text-[13px] text-[#717171]">
              No cleaner is assigned to this property yet.
            </p>
          }
        </div>
      </div>
    </>);

}
