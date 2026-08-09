import React, { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Ask one named cleaner to come, from wherever you happen to be.
 *
 * The calendar's version starts from a day and offers the people who
 * could take it. This one starts from a person — you are looking at their
 * card, you know you want them — and asks for the rest. Same endpoint,
 * opposite direction.
 *
 * It does not check whether they are free. That is deliberate: the answer
 * is theirs to give. The job is created pending, and the server words the
 * message as a request rather than an instruction when the day is not one
 * of theirs.
 */

const REASONS = [
{ key: 'checkout', label: 'After checkout' },
{ key: 'checkin', label: 'Before check-in' },
{ key: 'other', label: 'Something else' }];


export function RequestCleanerDialog({
  cleaner, properties, onClose, onDone,
}: {
  cleaner: {id: number;name: string;properties?: {id: number;name: string;}[];};
  properties: {id: number;name: string;}[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // Their own properties first — that is nearly always the answer — but
  // never only those. Covering for somebody at a property you do not
  // usually clean is the whole reason you would be doing this by hand.
  const theirs = cleaner.properties || [];
  const options = [
  ...theirs,
  ...properties.filter((p) => !theirs.some((t) => t.id === p.id))];


  const [propertyId, setPropertyId] = useState<number | ''>(options[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('checkout');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!propertyId || !date) return;
    setBusy(true);
    setError('');
    const res = await fetch('/api/cleaners/jobs/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        cleaner_id: cleaner.id, property_id: propertyId,
        cleaning_date: date, reason, note,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not send that');
      return;
    }
    onDone(`${cleaner.name} has been asked about ${date}.`);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[400px] sm:rounded-2xl sm:pb-5">
        <div className="flex justify-between items-start mb-3">
          <p className="text-[17px] font-semibold">Ask {cleaner.name}</p>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        <label className="block text-[12px] font-medium text-[#717171] mb-1">Property</label>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(Number(e.target.value))}
          className="w-full px-3 py-2 border border-[#DDDDDD] rounded-[8px] text-[14px] bg-white mb-3">
          {options.map((p) =>
          <option key={p.id} value={p.id}>
              {p.name}{theirs.some((t) => t.id === p.id) ? '' : ' (not one of theirs)'}
            </option>
          )}
        </select>

        <label className="block text-[12px] font-medium text-[#717171] mb-1">Day</label>
        {/* Not yesterday. A clean cannot be requested for a day that has
            already happened, and letting it be typed only produces a job
            nobody can ever start. */}
        <input
          type="date"
          value={date}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 border border-[#DDDDDD] rounded-[8px] text-[14px] mb-3" />

        <div className="flex flex-wrap gap-1.5 mb-3">
          {REASONS.map((r) =>
          <button
            key={r.key}
            onClick={() => setReason(r.key)}
            className={`px-3 py-1.5 rounded-full text-[13px] border ${
            reason === r.key ?
            'bg-[#222222] text-white border-[#222222]' :
            'bg-white text-[#222222] border-[#DDDDDD]'}`}>
              {r.label}
            </button>
          )}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything they should know (optional)"
          className="w-full px-3 py-2 border border-[#DDDDDD] rounded-[8px] text-[14px]" />

        {error && <p className="mt-2 text-[13px] text-[#991B1B]">{error}</p>}

        <button
          onClick={send}
          disabled={busy || !propertyId || !date}
          className="mt-4 w-full h-[44px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold disabled:opacity-40">
          {busy ? 'Sending…' : 'Send the request'}
        </button>
        <p className="mt-2 text-[12px] text-[#717171]">
          They can accept or decline. If the day is not one of theirs, it is
          worded as a request.
        </p>
      </div>
    </>);

}
