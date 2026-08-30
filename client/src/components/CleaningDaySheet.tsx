import React, { useState } from 'react';
import { X, Check, AlertCircle, UserPlus } from 'lucide-react';
import { CleaningDay, properties as allProperties, getRate, formatRate, holidayOn, schoolHolidaysOn } from '../data/properties';

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
  date, day, propertyId, propertyName, onClose, onAssigned, onRatesChanged,
  lockProperty = false, initialReason = 'checkout',
}: {
  date: string;
  day: CleaningDay | undefined;
  propertyId: number;
  propertyName: string;
  onClose: () => void;
  onAssigned: () => void;
  /** A price changed: reload the rates, but stay on this day. */
  onRatesChanged?: () => void | Promise<void>;
  /**
   * True when the property came from the thing that was clicked — a
   * booking bar or a blocked bar is already about one property, and
   * offering to change it there would only invite a mis-tap. Opened from
   * a bare day, the property is a choice and the picker is shown.
   */
  lockProperty?: boolean;
  initialReason?: Reason;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [rateValue, setRateValue] = useState('');
  const [rateUntil, setRateUntil] = useState('');
  const [minStay, setMinStay] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [rateError, setRateError] = useState('');
  const [rateNote, setRateNote] = useState('');

  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState<Reason>(initialReason);

  /**
   * Send the new rate to Smoobu, and only then believe it.
   *
   * The server pushes before it stores, so a refusal leaves both sides
   * as they were. A price on this calendar that Smoobu never accepted
   * would be a number no guest could book.
   */
  const saveRate = async () => {
    setSavingRate(true);
    setRateError('');
    const res = await fetch(`/api/properties/${propId}/rates`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        from: date,
        to: rateUntil || date,
        price: Number(rateValue),
        // Blank means "leave it alone", not "set it to one".
        ...(minStay === '' ? {} : { min_stay: Number(minStay) }),
      }),
    });
    setSavingRate(false);
    if (!res.ok) {
      setRateError((await res.json().catch(() => ({}))).error || 'Could not set that rate');
      return;
    }
    const out = await res.json().catch(() => ({}));
    setEditingRate(false);
    // A range can partly skip, so say what actually changed rather than
    // leaving somebody to count cells.
    const nights = `${out.nights} night${out.nights === 1 ? '' : 's'} set`;
    const min = out.min_stay ? `, minimum ${out.min_stay}` : '';
    setRateNote(out.skipped ?
    `${nights}${min} · ${out.skipped} already booked` :
    `${nights}${min}`);
    // Not onAssigned: that closes the sheet, and having just set a price
    // the thing you want is to see it.
    if (onRatesChanged) await onRatesChanged();
  };
  const [note, setNote] = useState('');
  const [propId, setPropId] = useState(propertyId);

  const allJobs = (day?.jobs || []).filter((j) => j.property_id === propId);
  // A job with nobody on it is not a booking, it is a gap. Listing it
  // under "already booked" said the opposite of what it meant.
  // Still to happen, versus been and gone. Listing a finished clean under
  // "coming that day" says the opposite of what happened, and putting the
  // two together makes it impossible to see at a glance whether the day is
  // covered or already behind you.
  const jobs = allJobs.filter((j) => j.cleaner_name && !j.done);
  const doneJobs = allJobs.filter((j) => j.cleaner_name && j.done);
  const unstaffed = allJobs.filter((j) => !j.cleaner_name);
  const unmet = (day?.unmet || []).filter((u) => u.property_id === propId);
  // Whoever is already down for this property that day is not somebody
  // you can send: that choice is made. Offering them again produced the
  // same person twice on one day — which is a mis-tap, not a second pair
  // of hands. A genuinely different cleaner is still offered, because two
  // people on one turnover is a real thing.
  // Only work still live. A clean somebody finished this morning does not
  // stop them being asked back this afternoon — the same rule the database
  // enforces, so the screen and the constraint agree.
  const alreadyOn = new Set(
    allJobs.filter((j) => !j.done).map((j) => j.cleaner_id).filter(Boolean));
  const free = (day?.available || []).filter(
    (c) => c.property_ids.includes(propId) && !alreadyOn.has(c.id));
  const busyFolk = (day?.unavailable || []).filter(
    (c) => c.property_ids.includes(propId) && !alreadyOn.has(c.id));
  const everyoneOn = alreadyOn.size > 0 && free.length === 0 && busyFolk.length === 0;
  const chosenName = allProperties.find((p) => p.id === propId)?.name || propertyName;

  // The same facts the cell draws as marks, for the property in view.
  const asDate = new Date(date + 'T00:00:00');
  const rate = getRate(propId, asDate);
  const holiday = holidayOn(asDate);
  // Shown whatever the calendar toggle says: opening a day is asking
  // for everything about it, and which market a term belongs to is the
  // whole reason it is worth knowing.
  const terms = schoolHolidaysOn(asDate);
  const freeHere = day ?
  day.available.filter((c) => c.property_ids.includes(propId)) :
  [];

  // What actually happens at this property that day. "After checkout" on
  // a day nothing checks out of, or "before check-in" on a day nobody
  // arrives, are not choices — they are words that cannot mean anything,
  // and a button you can press that does something senseless is worse
  // than one that is not there.
  const hasCheckout = (day?.checkouts || []).some((c) => c.property_id === propId);
  const hasCheckin = (day?.checkins || []).some((c) => c.property_id === propId);
  const allowed = (r: Reason) =>
  r === 'checkout' ? hasCheckout : r === 'checkin' ? hasCheckin : true;

  // Changing property can invalidate what was picked, so settle on
  // something that is actually possible before anything is sent.
  const effectiveReason: Reason = allowed(reason) ? reason : 'other';

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
        booking_id: effectiveReason === 'checkout' ? unmet[0]?.booking_id ?? null : null,
        cleaning_date: date,
        reason: effectiveReason,
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

        {/* Everything the cell was showing, in words.

            The grid says all of this already, but in marks: a moon for
            the minimum stay, a struck-through price for a closed night,
            a grey number for how many cleaners are free, a dot for a
            public holiday. Those are fine once you know them and opaque
            until you do, and on a phone they are a few pixels wide.
            Opening the day is the moment to say them plainly. */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
          {/* The rate, and the one number the owner sets.
              Smoobu takes a nightly figure and adds each channel's
              percentage before pushing it out, so this is the whole
              input. Until now the app could show it and not change it. */}
          {rate && !editingRate &&
          <span className={rate.available ? 'text-[#222222]' : 'text-[#8A8A8A]'}>
              <span className="text-[#717171]">Rate </span>
              {rate.available ? formatRate(rate.price) : `${formatRate(rate.price)} · not for sale`}
              <button
              onClick={() => { setRateValue(String(Math.round(rate.price))); setRateUntil(date); setMinStay(rate.minStay > 1 ? String(rate.minStay) : ''); setEditingRate(true); setRateError(''); }}
              className="ml-1.5 text-[#FF385C] font-semibold">
                Change
              </button>
            </span>
          }

          {editingRate &&
          <div className="w-full">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[#717171]">Rate</span>
                <input
                type="number"
                inputMode="numeric"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                aria-label="Nightly rate"
                className="w-24 px-2 py-1 border border-[#DDDDDD] rounded-[6px] text-[13px] tabular-nums" />

                {/* One night unless you say otherwise. Most changes are a
                    single day; a season is the same action with an end
                    date on it, so it is one field rather than a mode. */}
                {/* The other half of a discount. "Cheaper, but three
                    nights" protects the rate while filling the gap, and
                    it is the same call — so it is the same form. Left
                    blank it is not sent, and whatever restriction the
                    night already had stays put. */}
                <span className="text-[#717171]">min</span>
                <input
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                placeholder="—"
                value={minStay}
                onChange={(e) => setMinStay(e.target.value)}
                aria-label="Minimum nights"
                className="w-16 px-2 py-1 border border-[#DDDDDD] rounded-[6px] text-[13px] tabular-nums" />

                <span className="text-[#717171]">until</span>
                <input
                type="date"
                value={rateUntil}
                min={date}
                onChange={(e) => setRateUntil(e.target.value)}
                aria-label="Last night at this rate"
                className="px-2 py-1 border border-[#DDDDDD] rounded-[6px] text-[13px]" />

                <button
                disabled={savingRate}
                onClick={saveRate}
                className="px-2.5 py-1 rounded-[6px] bg-[#222222] text-white text-[12px] font-semibold disabled:opacity-50">
                  {savingRate ? 'Sending…' : 'Save'}
                </button>
                <button
                onClick={() => { setEditingRate(false); setRateError(''); }}
                className="text-[12px] text-[#717171] underline underline-offset-2">
                  Cancel
                </button>
              </div>
              <p className="text-[12px] text-[#717171] mt-1">
                {rateUntil && rateUntil !== date ?
              `Every night from ${date} to ${rateUntil} that nobody has booked.` :
              'This night only.'}
                {minStay === '' && ' Minimum stay unchanged.'}
              </p>
            </div>
          }
          {rateError && <span className="w-full text-[12px] text-[#991B1B]">{rateError}</span>}
          {rateNote && !editingRate &&
          <span className="w-full text-[12px] text-[#0F6E56]">{rateNote}</span>
          }
          {rate && rate.minStay > 1 &&
          <span>
              <span className="text-[#717171]">Minimum stay </span>
              {rate.minStay} nights
            </span>
          }
          <span>
            <span className="text-[#717171]">Cleaners free </span>
            {freeHere.length === 0 ? 'nobody' : `${freeHere.length} · ${freeHere.map((c) => c.name).join(', ')}`}
          </span>
          {holiday &&
          <span className="flex items-center gap-1.5">
              <span className="w-[5px] h-[5px] rounded-full bg-[#C9A227] shrink-0" />
              {holiday.name} · {holiday.label}
            </span>
          }
          {terms.length > 0 &&
          <span className="flex items-center gap-1.5">
              <span className="w-[8px] h-[3px] rounded-full bg-[#C9A227] shrink-0" />
              <span>
                <span className="text-[#717171]">School holidays </span>
                {terms.map((t) => `${t.label} (${t.name})`).join(', ')}
              </span>
            </span>
          }
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
        {(unmet.length > 0 || unstaffed.length > 0) &&
        <div className="mt-4 border border-[#F0C36D] bg-[#FFFBEB] rounded-[10px] px-3 py-2.5">
            <p className="text-[14px] font-medium flex items-center gap-1.5 text-[#92400E]">
              <AlertCircle className="w-4 h-4 text-[#BA7517] shrink-0" />
              {unmet.length > 0 ? 'Checks out that day, with no cleaner' : 'A visit is scheduled with nobody on it'}
            </p>
            {unstaffed.map((j) =>
          <p key={j.id} className="text-[13px] text-[#92400E] mt-0.5">
                {j.start_time}–{j.end_time} — picking somebody below fills this.
              </p>
          )}
          </div>
        }

        {/* Who is already coming. */}
        {jobs.length > 0 &&
        <div className="mt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
              Coming that day
            </p>
            {jobs.map((j) =>
          <div key={j.id} className="flex items-start gap-2 py-2 border-b border-[#F0F0F0] last:border-0">
                {/* The icon is about whether there is a problem, and
                    nothing else. A tick beside the word "Pending" read as
                    "confirmed" — two different facts wearing one mark. */}
                {j.cleaner_available ?
            <Check className="w-4 h-4 text-[#0F6E56] mt-0.5 shrink-0" /> :
            <AlertCircle className="w-4 h-4 text-[#BA7517] mt-0.5 shrink-0" />
            }
                <div className="min-w-0">
                  <p className="text-[14px]">
                    <span className="font-medium">{j.cleaner_name}</span> · {j.start_time}–{j.end_time}
                    {j.reason && j.reason !== 'checkout' &&
                <span className="text-[#717171]"> · {j.reason === 'checkin' ? 'before check-in' : 'other'}</span>
                }
                  </p>
                  {j.note && <p className="text-[13px] text-[#717171]">{j.note}</p>}
                  {/* Only for work still ahead. Once somebody has turned
                      up, what they later said about their availability is
                      history, not a problem. */}
                  {!j.cleaner_available && !j.started &&
              <p className="text-[13px] text-[#92400E]">
                      Has marked themselves unavailable that day.
                    </p>
              }
                  <p className="text-[12px] text-[#717171]">
                    {j.status === 'pending' ? 'Waiting for them to accept' :
                j.status === 'confirmed' ? 'Accepted' :
                j.status === 'in_progress' ? 'On site now' :
                j.status === 'completed' ? 'Done' : j.status}
                  </p>
                </div>
              </div>
          )}
          </div>
        }

        {doneJobs.length > 0 &&
        <div className="mt-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-2">
              Already done
            </p>
            {doneJobs.map((j) =>
          <div key={j.id} className="flex items-start gap-2 py-2 border-b border-[#F0F0F0] last:border-0">
                <Check className="w-4 h-4 text-[#0F6E56] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[14px]">
                    <span className="font-medium">{j.cleaner_name}</span> · {j.start_time}–{j.end_time}
                  </p>
                  {j.note && <p className="text-[13px] text-[#717171]">{j.note}</p>}
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
            {REASONS.map((r) => {
              const can = allowed(r.key);
              return (
                <button
                  key={r.key}
                  disabled={!can}
                  onClick={() => setReason(r.key)}
                  title={can ? r.hint :
                  r.key === 'checkout' ? 'Nothing checks out that day' : 'Nobody arrives that day'}
                  className={`px-3 py-1.5 rounded-full text-[13px] border ${
                  !can ?
                  'bg-[#F7F7F7] text-[#B0B0B0] border-[#EBEBEB] cursor-not-allowed' :
                  effectiveReason === r.key ?
                  'bg-[#222222] text-white border-[#222222]' :
                  'bg-white text-[#222222] border-[#DDDDDD]'}`}>
                  {r.label}
                </button>);

            })}
          </div>
          <p className="text-[12px] text-[#717171] mt-1.5">
            {REASONS.find((r) => r.key === effectiveReason)?.hint}
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
              {everyoneOn ?
            'Everybody who cleans this property is already down for that day.' :
            'No cleaner is assigned to this property yet.'}
            </p>
          }
        </div>
      </div>
    </>);

}
