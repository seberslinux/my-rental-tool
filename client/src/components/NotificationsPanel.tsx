import React, { useEffect, useState } from 'react';
import { X, Check, MessageCircle, AlertCircle, CalendarX } from 'lucide-react';

/**
 * The activity feed, and the choice of how to be told.
 *
 * In-app is the baseline and is not offered as a toggle — the feed is
 * the record, and a record you can switch off is not one. WhatsApp is
 * the decision, per person: an owner who wants their phone buzzing and
 * a manager who does not are both reasonable, and a channel nobody
 * asked for is the fastest way to have it muted.
 */

interface Notification {
  id: number;
  event: string;
  title: string;
  body: string;
  link: string | null;
  severity: 'info' | 'attention';
  delivery: string;
  delivery_error: string | null;
  created_at: string;
  read_at: string | null;
  property_name: string | null;
  cleaner_name: string | null;
  /** The facts behind the sentence, when there is something to press. */
  meta: {action?: string;property_id?: number;from?: string;to?: string;} | null;
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
};

export function NotificationsPanel({ onClose, onRead }: {onClose: () => void;onRead: () => void;}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [whatsapp, setWhatsapp] = useState(false);
  const [hasPhone, setHasPhone] = useState(true);
  const [waAvailable, setWaAvailable] = useState(true);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = async () => {
    const [feed, prefs] = await Promise.all([
      fetch('/api/notifications', { credentials: 'same-origin' }),
      fetch('/api/notifications/preferences', { credentials: 'same-origin' }),
    ]);
    if (feed.ok) setItems((await feed.json()).notifications || []);
    if (prefs.ok) {
      const p = await prefs.json();
      setWhatsapp(p.whatsapp);
      setHasPhone(p.has_phone);
      setWaAvailable(p.whatsapp_available !== false);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const pretty = (d?: string) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '';

  /** Clear one. It has been read and dealt with; it does not need keeping. */
  const dismiss = async (id: number) => {
    setItems(items.filter((i) => i.id !== id));
    await fetch(`/api/notifications/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    onRead();
  };

  const clearRead = async () => {
    setItems(items.filter((i) => !i.read_at));
    await fetch('/api/notifications/clear-read', { method: 'POST', credentials: 'same-origin' });
  };

  /**
   * Do the thing the message is about, from the message.
   *
   * It already knows the property and the nights; making somebody carry
   * those to another screen and retype them is how the wrong dates get
   * blocked.
   */
  const blockFrom = async (n: Notification) => {
    if (!n.meta || !n.meta.property_id || !n.meta.from) return;
    setBusy(n.id);
    setError('');
    const res = await fetch(`/api/properties/${n.meta.property_id}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        from: n.meta.from,
        to: n.meta.to || n.meta.from,
        reason: 'No cleaner available',
      }),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not block those nights');
      return;
    }
    dismiss(n.id);
  };

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'same-origin' });
    setItems(items.map((i) => ({ ...i, read_at: new Date().toISOString() })));
    onRead();
  };

  const toggleWhatsapp = async () => {
    setError('');
    const res = await fetch('/api/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ whatsapp: !whatsapp }),
    });
    if (res.ok) setWhatsapp((await res.json()).whatsapp);
    else setError((await res.json().catch(() => ({}))).error || 'Could not save that');
  };

  const savePhone = async () => {
    setError('');
    const res = await fetch('/api/notifications/phone', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ phone }),
    });
    if (res.ok) { setHasPhone(true); setPhone(''); }
    else setError((await res.json().catch(() => ({}))).error || 'Could not save that');
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[60]" onClick={onClose} />

      <div
        role="dialog"
        aria-label="Notifications"
        className="fixed z-[70] bg-white shadow-2xl
                   inset-x-0 bottom-0 rounded-t-[16px] max-h-[85vh]
                   sm:inset-auto sm:top-14 sm:right-4 sm:bottom-auto
                   sm:w-[400px] sm:rounded-[14px] sm:max-h-[70vh]
                   flex flex-col overflow-hidden border border-[#EBEBEB]">

        <div className="flex items-center justify-between px-4 py-3 border-b border-[#EBEBEB] shrink-0">
          <p className="text-[15px] font-semibold">Activity</p>
          <div className="flex items-center gap-1">
            {items.some((i) => !i.read_at) &&
            <button
              onClick={markAllRead}
              className="text-[12px] font-medium text-[#717171] px-2 py-1 rounded-full hover:bg-[#F7F7F7]">
              Mark all read
            </button>
            }
            {items.some((i) => i.read_at) &&
            <button
              onClick={clearRead}
              className="text-[12px] font-medium text-[#717171] px-2 py-1 rounded-full hover:bg-[#F7F7F7]">
              Clear read
            </button>
            }
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-[#F7F7F7]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* How you hear about it. In-app is not a choice, so it is stated
            rather than offered.

            When WhatsApp is not set up there is nothing to offer either:
            a switch that cannot do anything reads as a broken app rather
            than an unconfigured one. */}
        <div className="px-4 py-3 border-b border-[#EBEBEB] bg-[#FAFAFA] shrink-0">
          {!waAvailable ?
          <p className="text-[13px] text-[#717171]">
              <span className="font-medium text-[#222222] flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp is not set up
              </span>
              Everything still arrives here. Add a WhatsApp token to also get the
              ones that need you on your phone.
            </p> :

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={whatsapp}
              onChange={toggleWhatsapp}
              disabled={!hasPhone}
              className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="text-[13px]">
              <span className="font-medium flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" /> Also send these to my WhatsApp
              </span>
              <span className="text-[#717171]">
                Only the ones that need you — a cleaner declining, nobody assigned,
                something broken. Everything still appears here.
              </span>
            </span>
          </label>
          }

          {waAvailable && !hasPhone &&
          <div className="mt-2.5 flex gap-2">
              <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+27 82 123 4567"
              className="flex-1 min-w-0 px-2 py-1.5 text-[13px] border border-[#DDDDDD] rounded-[6px]" />
              <button
              onClick={savePhone}
              disabled={!phone.trim()}
              className="shrink-0 px-3 py-1.5 text-[12px] font-semibold bg-[#222222] text-white rounded-[6px] disabled:opacity-40">
                Save
              </button>
            </div>
          }

          {error && <p className="mt-2 text-[12px] text-[#991B1B]">{error}</p>}
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && <p className="p-4 text-[13px] text-[#717171]">Loading…</p>}

          {!loading && items.length === 0 &&
          <div className="p-6 text-center">
              <p className="text-[14px] font-medium mb-1">Nothing yet</p>
              <p className="text-[13px] text-[#717171]">
                Cleanings, reports and anything needing you will show up here.
              </p>
            </div>
          }

          {items.map((n) =>
          <div
            key={n.id}
            className={`px-4 py-3 border-b border-[#F0F0F0] last:border-0 ${n.read_at ? '' : 'bg-[#FFFBEB]'}`}>
              <div className="flex items-start gap-2">
                {n.severity === 'attention' ?
              <AlertCircle className="w-4 h-4 text-[#C13515] shrink-0 mt-0.5" /> :
              <Check className="w-4 h-4 text-[#0F6E56] shrink-0 mt-0.5" />
              }
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{n.title}</p>
                  {n.body && <p className="text-[13px] text-[#717171] mt-0.5">{n.body}</p>}
                  <p className="text-[11px] text-[#B0B0B0] mt-1 tabular-nums">
                    {ago(n.created_at)}
                    {n.property_name ? ` · ${n.property_name}` : ''}
                  </p>

                  {/* A send that did not land is worth knowing about — this
                      is the app admitting it, rather than staying quiet. */}
                  {n.delivery === 'failed' && n.delivery_error &&
                <p className="text-[11px] text-[#991B1B] mt-1">
                      Not delivered: {n.delivery_error}
                    </p>
                }

                  {/* The thing the message is telling you to do, done from
                      here. It already knows which property and which
                      nights. */}
                  {n.meta && n.meta.action === 'block' &&
                <div className="flex flex-wrap items-center gap-2 mt-2">
                      <button
                    disabled={busy === n.id}
                    onClick={() => blockFrom(n)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#222222] text-white text-[12px] font-semibold disabled:opacity-60">
                        <CalendarX className="w-3.5 h-3.5" />
                        {busy === n.id ? 'Blocking…' :
                    n.meta.to && n.meta.to !== n.meta.from ?
                    `Block ${pretty(n.meta.from)} – ${pretty(n.meta.to)}` :
                    `Block ${pretty(n.meta.from)}`}
                      </button>
                      <button
                    onClick={() => dismiss(n.id)}
                    className="px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] text-[12px] font-semibold">
                        Leave it on sale
                      </button>
                    </div>
                }
                </div>

                {/* Clearing one it is done with. The feed used to only
                    grow: everything ever recorded, greyer once read. */}
                <button
                onClick={() => dismiss(n.id)}
                aria-label="Clear this message"
                className="shrink-0 -mt-1 -mr-1 p-2 rounded-full text-[#B0B0B0] hover:bg-[#F0F0F0]">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>);

}
