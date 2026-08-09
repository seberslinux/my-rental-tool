import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

/**
 * What a cleaner counts at a property, and how many there should be.
 *
 * The API for this existed in full — GET, POST, PUT, DELETE, scoped to
 * the properties you can see — and nothing in the app had ever called it.
 * So every property's list was empty, every cleaner who opened their
 * checklist read "no checklist has been set up", and the inventory
 * feature was unreachable from the only side that could fill it in.
 *
 * The expected quantity is the point of the whole thing. Without it a
 * count is a tick; with it, six towels going out and four coming back is
 * a number somebody can act on.
 */

interface Item {
  id: number;
  item_name: string;
  category: string;
  expected_quantity: number;
  sort_order: number;
}

/** Sensible groupings, and a free-text escape for anything else. */
const CATEGORIES = ['Linen', 'Kitchen', 'Bathroom', 'Cleaning', 'General'];

export function ChecklistEditor({
  propertyId, propertyName, onClose, bookingId, guestName,
}: {
  propertyId: number;
  propertyName: string;
  onClose: () => void;
  /**
   * Editing the extras for one stay rather than the standing list.
   *
   * The property's list is right for towels and coffee pods. It is wrong
   * for "the cot is out for this family" — true of one booking and
   * nonsense on every other.
   */
  bookingId?: number;
  guestName?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Linen');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch(
      `/api/inventory/${propertyId}${bookingId ? `?booking_id=${bookingId}` : ''}`,
      { credentials: 'same-origin' });
    if (res.ok) setItems(await res.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, [propertyId, bookingId]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    const res = await fetch(`/api/inventory/${propertyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        item_name: name.trim(), category, expected_quantity: qty,
        sort_order: items.length, booking_id: bookingId || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not add that');
      return;
    }
    setName('');
    setQty(1);
    load();
  };

  const setQuantity = async (item: Item, next: number) => {
    if (next < 0) return;
    setItems(items.map((i) => i.id === item.id ? { ...i, expected_quantity: next } : i));
    await fetch(`/api/inventory/items/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ...item, expected_quantity: next }),
    });
  };

  const remove = async (item: Item) => {
    setItems(items.filter((i) => i.id !== item.id));
    await fetch(`/api/inventory/items/${item.id}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
  };

  const grouped = items.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.category] = acc[i.category] || []).push(i);
    return acc;
  }, {});

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      max-h-[85vh] overflow-y-auto
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[460px] sm:rounded-2xl sm:pb-5 sm:max-h-[80vh]">

        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[18px] font-semibold">
              {bookingId ? 'Just for this stay' : 'Checklist'}
            </p>
            <p className="text-[13px] text-[#717171]">
              {bookingId ? `${guestName || 'This booking'} · ${propertyName}` : propertyName}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        <p className="text-[13px] text-[#717171] mb-4">
          {bookingId ?
          'Counted on this stay\u2019s clean only, on top of the property\u2019s usual list.' :
          'What the cleaner counts before they can finish. Leave it empty and they are never asked.'}
        </p>

        {error && <p className="mb-3 text-[13px] text-[#991B1B]">{error}</p>}
        {loading && <p className="text-[13px] text-[#717171]">Loading…</p>}

        {!loading && items.length === 0 &&
        <p className="text-[13px] text-[#717171] mb-4">
            {bookingId ? 'Nothing extra for this stay.' : 'Nothing on the list yet.'}
          </p>
        }

        {Object.entries(grouped).map(([cat, list]) =>
        <div key={cat} className="mb-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#717171] mb-1">
              {cat}
            </p>
            {list.map((i) =>
          <div key={i.id} className="flex items-center gap-2 py-2 border-b border-[#F0F0F0] last:border-0">
                <span className="flex-1 min-w-0 text-[14px] truncate">{i.item_name}</span>

                {/* The expected count, editable in place. Typing into a
                    form and saving is too much ceremony for a number that
                    changes when somebody buys more towels. */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                onClick={() => setQuantity(i, i.expected_quantity - 1)}
                aria-label={`One fewer ${i.item_name}`}
                className="w-7 h-7 rounded-full border border-[#DDDDDD] text-[15px] leading-none">
                    −
                  </button>
                  <span className="w-7 text-center text-[14px] tabular-nums">{i.expected_quantity}</span>
                  <button
                onClick={() => setQuantity(i, i.expected_quantity + 1)}
                aria-label={`One more ${i.item_name}`}
                className="w-7 h-7 rounded-full border border-[#DDDDDD] text-[15px] leading-none">
                    +
                  </button>
                </div>

                <button
              onClick={() => remove(i)}
              aria-label={`Remove ${i.item_name}`}
              className="shrink-0 p-1.5 rounded-full text-[#B0B0B0] hover:bg-[#F7F7F7] hover:text-[#C13515]">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
          )}
          </div>
        )}

        <div className="pt-3 border-t border-[#EBEBEB]">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="Bath towels"
              className="flex-1 min-w-0 px-3 py-2 border border-[#DDDDDD] rounded-[8px] text-[14px]" />
            <input
              type="number"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(Math.max(0, Number(e.target.value)))}
              aria-label="How many there should be"
              className="w-[64px] shrink-0 px-2 py-2 border border-[#DDDDDD] rounded-[8px] text-[14px] text-center tabular-nums" />
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {CATEGORIES.map((c) =>
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-full text-[13px] border ${
              category === c ?
              'bg-[#222222] text-white border-[#222222]' :
              'bg-white text-[#222222] border-[#DDDDDD]'}`}>
                {c}
              </button>
            )}
          </div>

          <button
            onClick={add}
            disabled={busy || !name.trim()}
            className="mt-3 w-full h-[44px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5">
            <Plus className="w-4 h-4" /> {busy ? 'Adding…' : 'Add item'}
          </button>
        </div>
      </div>
    </>);

}
