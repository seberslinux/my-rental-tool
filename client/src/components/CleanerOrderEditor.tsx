import React, { useEffect, useState } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';

/**
 * Who to send here first.
 *
 * Assignment walks this list and takes the first person who is free. It
 * has always walked *a* list — whatever order the database happened to
 * return — so which of two available cleaners got a job was arbitrary and
 * unchangeable. The order is now the manager's, which is the only person
 * with an opinion worth having about it.
 *
 * Up and down rather than drag: this is a list of two or three people on
 * a phone, and drag-and-drop on a touch screen fights with scrolling.
 */

interface Cleaner {
  id: number;
  name: string;
  priority: number;
}

export function CleanerOrderEditor({
  propertyId, propertyName, onClose,
}: {
  propertyId: number;
  propertyName: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Cleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/cleaners', { credentials: 'same-origin' });
      if (res.ok) {
        const all = await res.json();
        setRows(
          all.
          filter((c: any) => (c.properties || []).some((p: any) => p.id === propertyId)).
          map((c: any) => ({ id: c.id, name: c.name, priority: 0 }))
        );
      }
      setLoading(false);
    })();
  }, [propertyId]);

  const move = (i: number, by: number) => {
    const next = [...rows];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/cleaner-order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ cleaner_ids: rows.map((r) => r.id) }),
    });
    setSaving(false);
    if (!res.ok) return setError('Could not save that order');
    setSaved(true);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      max-h-[85vh] overflow-y-auto
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[420px] sm:rounded-2xl sm:pb-5">

        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[18px] font-semibold">Who to send first</p>
            <p className="text-[13px] text-[#717171]">{propertyName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        <p className="text-[13px] text-[#717171] mb-4">
          The first person on this list who is free that day gets the job.
        </p>

        {loading && <p className="text-[13px] text-[#717171]">Loading…</p>}

        {!loading && rows.length === 0 &&
        <p className="text-[13px] text-[#717171]">
            Nobody is assigned to this property yet. Add them from the Cleaners page.
          </p>
        }

        {rows.map((c, i) =>
        <div key={c.id} className="flex items-center gap-2 py-2 border-b border-[#F0F0F0] last:border-0">
            <span className="w-6 text-[13px] text-[#B0B0B0] tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 text-[14px] truncate">{c.name}</span>
            <button
            onClick={() => move(i, -1)}
            disabled={i === 0}
            aria-label={`Move ${c.name} up`}
            className="p-1.5 rounded-full border border-[#DDDDDD] disabled:opacity-30">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
            onClick={() => move(i, 1)}
            disabled={i === rows.length - 1}
            aria-label={`Move ${c.name} down`}
            className="p-1.5 rounded-full border border-[#DDDDDD] disabled:opacity-30">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        )}

        {rows.length > 1 &&
        <button
          onClick={save}
          disabled={saving || saved}
          className={`mt-4 w-full h-[44px] rounded-[8px] text-[14px] font-semibold ${
          saving || saved ?
          'bg-[#F7F7F7] text-[#B0B0B0] border border-[#EBEBEB]' :
          'bg-[#222222] text-white'}`}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save order'}
          </button>
        }

        {error && <p className="mt-2 text-[13px] text-[#991B1B]">{error}</p>}
      </div>
    </>);

}
