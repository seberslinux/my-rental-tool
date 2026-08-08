import React, { useEffect, useState } from 'react';
import { X, Check, MessageCircle, AlertCircle } from 'lucide-react';

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
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

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
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-[#F7F7F7]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* How you hear about it. In-app is not a choice, so it is stated
            rather than offered. */}
        <div className="px-4 py-3 border-b border-[#EBEBEB] bg-[#FAFAFA] shrink-0">
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

          {!hasPhone &&
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
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>);

}
