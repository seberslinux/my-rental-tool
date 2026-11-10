import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, AlertCircle, Send, MessageCircle } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';

/**
 * Guest messages: read them, answer them.
 *
 * Smoobu already gathers every channel's messages into one inbox, so an
 * Airbnb guest and a Booking.com guest are answered from the same place,
 * and the reply goes back through whichever channel they booked on. This
 * page reads that inbox and writes to it; it keeps no copy.
 *
 * Text only, on purpose. A guest's message can arrive as HTML, and the
 * server reduces it to words before it gets here — nothing a guest typed
 * is ever rendered as markup.
 */

interface Thread {
  booking_id: number;
  guest_name: string;
  property_id: number;
  property: string;
  latest: {id: number | null;text: string;at: string | null;};
  unread: boolean;
}

interface Message {id: number;from: 'guest' | 'you';subject: string;text: string;at?: string | null;empty?: boolean;}

interface Conversation {
  booking: {smoobu_id: number;guest_name: string;property: string;check_in: string;check_out: string;platform: string;
    /** The conversation on the channel's own site, where photos still are. */
    channel_link?: {label: string;url: string;} | null;};
  messages: Message[];
}

const CARD = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';

/** Smoobu's "YYYY-MM-DD HH:MM:SS", said the way a person would. */
function when(at: string | null): string {
  if (!at) return '';
  const d = new Date(at.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days < 7) return d.toLocaleDateString('en-ZA', { weekday: 'short' });
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

/** Under a message: the time today, otherwise the date with it. */
function stamp(at: string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}, ${time}`;
}

const stay = (b: Conversation['booking']) => {
  const fmt = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  return `${b.property} · ${fmt(b.check_in)} – ${fmt(b.check_out)}`;
};

export function MessagesPage({ initialBookingId = null, onUnreadChange, propertyId = 0 }: {
  /** Open straight into one conversation — the push notification's link. */
  initialBookingId?: number | null;
  /** How many conversations are waiting, for the tab badge. */
  onUnreadChange?: (n: number) => void;
  propertyId?: number;
}) {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [failed, setFailed] = useState('');
  const [openId, setOpenId] = useState<number | null>(initialBookingId);

  const loadThreads = useCallback(async () => {
    setFailed('');
    try {
      const d = await apiGet<{threads: Thread[];unread: number;}>(
        propertyId ? `/api/messages/threads?property_id=${propertyId}` : '/api/messages/threads');
      setThreads(d.threads || []);
      if (onUnreadChange && !propertyId) onUnreadChange(d.unread || 0);
    } catch (e) {
      if (!(e instanceof Unauthorized)) setFailed('Could not reach Smoobu for your messages.');
    }
  }, [propertyId, onUnreadChange]);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (initialBookingId) setOpenId(initialBookingId); }, [initialBookingId]);

  if (openId) {
    return (
      <ConversationView
        bookingId={openId}
        onBack={() => { setOpenId(null); loadThreads(); }} />);
  }

  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      <div className="lg:max-w-[860px]">
        {failed ?
        <div className={`${CARD} px-4 py-3 flex items-center gap-2`}>
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] text-[#222222] flex-1">{failed}</span>
            <button onClick={loadThreads} className="flex items-center gap-1 text-[13px] font-semibold text-[#FF385C]">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div> :
        threads === null ?
        <p className="text-[14px] text-[#717171] px-1">Loading your messages…</p> :
        threads.length === 0 ?
        <div className={`${CARD} px-4 py-6 text-center`}>
            <MessageCircle className="w-6 h-6 text-[#B0B0B0] mx-auto mb-2" />
            <p className="text-[15px] font-medium text-[#222222]">No conversations yet</p>
            <p className="text-[13px] text-[#717171]">When a guest writes, it shows up here and on your phone.</p>
          </div> :

        <div className={`${CARD} overflow-hidden`}>
            {threads.map((t, i) =>
          <button
            key={t.booking_id}
            onClick={() => setOpenId(t.booking_id)}
            className={`w-full text-left flex items-start gap-3 px-4 py-3 ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                <span className={`mt-[7px] w-[8px] h-[8px] rounded-full shrink-0 ${t.unread ? 'bg-[#FF385C]' : 'bg-transparent'}`}
            aria-label={t.unread ? 'Unread' : undefined} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`flex-1 text-[15px] text-[#222222] leading-snug ${t.unread ? 'font-semibold' : 'font-medium'}`}>
                      {t.guest_name}
                    </span>
                    <span className="shrink-0 text-[12px] text-[#717171] tabular-nums">{when(t.latest.at)}</span>
                  </div>
                  <div className="text-[12px] text-[#717171]">{t.property}</div>
                  <div className={`text-[13px] leading-snug line-clamp-2 ${t.unread ? 'text-[#222222]' : 'text-[#717171]'}`}>
                    {t.latest.text}
                  </div>
                </div>
              </button>
          )}
          </div>
        }
      </div>
    </div>);

}

function ConversationView({ bookingId, onBack }: {bookingId: number;onBack: () => void;}) {
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [failed, setFailed] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setFailed('');
    try {
      setConvo(await apiGet<Conversation>(`/api/messages/${bookingId}`));
    } catch (e) {
      if (!(e instanceof Unauthorized)) setFailed('Could not load this conversation.');
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [convo]);

  const send = async () => {
    const text = draft.trim();
    if (!text) { setError('Write something first'); return; }
    setSending(true);
    setError('');
    const res = await fetch(`/api/messages/${bookingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      // Kept in the box: a reply that did not go must not be lost.
      setError(body.error || 'That did not send.');
      return;
    }
    setDraft('');
    if (body.messages) setConvo((c) => c ? { ...c, messages: body.messages } : c);else
    load();
  };

  return (
    <div className="flex flex-col min-h-full bg-[#F7F7F7]">
      <div className="sticky top-0 z-10 bg-white border-b border-[#EBEBEB] px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} aria-label="Back to messages" className="p-1 -ml-1">
          <ArrowLeft className="w-5 h-5 text-[#222222]" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-[#222222] leading-snug">
            {convo ? convo.booking.guest_name : 'Conversation'}
          </div>
          {convo && <div className="text-[12px] text-[#717171]">{stay(convo.booking)} · {convo.booking.platform}</div>}
        </div>
        {convo?.booking.channel_link &&
        <a
          href={convo.booking.channel_link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[13px] font-semibold text-[#FF385C]">
            Open in {convo.booking.channel_link.label}
          </a>
        }
      </div>

      <div className="flex-1 px-4 py-4 space-y-2 lg:max-w-[860px] w-full">
        {failed &&
        <div className={`${CARD} px-4 py-3 flex items-center gap-2`}>
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] flex-1">{failed}</span>
            <button onClick={load} className="text-[13px] font-semibold text-[#FF385C]">Try again</button>
          </div>
        }
        {convo && convo.messages.length === 0 &&
        <p className="text-[13px] text-[#717171] text-center py-6">No messages yet. Say hello.</p>
        }
        {convo && convo.messages.map((m) =>
        <div key={m.id} className={`flex flex-col ${m.from === 'you' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[82%] rounded-[16px] px-3.5 py-2.5 text-[14px] leading-snug whitespace-pre-wrap break-words ${
          m.from === 'you' ? 'bg-[#222222] text-white rounded-br-[4px]' : 'bg-white text-[#222222] rounded-bl-[4px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]'}`}>
              {m.subject && m.from === 'you' && <div className="text-[11px] opacity-70 mb-0.5">{m.subject}</div>}
              {/* A photo or file: Smoobu sends it with no text and no
                  attachment, so say there is something rather than
                  showing nothing — or dropping it, which made a guest
                  look as if they had sent nothing at all. */}
              {m.empty ? (
            convo.booking.channel_link ?
            <a href={convo.booking.channel_link.url} target="_blank" rel="noopener noreferrer"
            className="italic underline opacity-80">
                    Sent a photo or file — open it in {convo.booking.channel_link.label}
                  </a> :
            <span className="italic opacity-70">
                    Sent a photo or file — open it in {convo.booking.platform || 'the channel'} to see it
                  </span>) :
            m.text}
            </div>
            {m.at && <span className="text-[11px] text-[#B0B0B0] mt-0.5 px-1 tabular-nums">{stamp(m.at)}</span>}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[64px] lg:bottom-0 bg-white border-t border-[#EBEBEB] px-3 py-2.5">
        {error && <p className="text-[12px] text-[#991B1B] mb-1.5 px-1">{error}</p>}
        <div className="flex items-end gap-2 lg:max-w-[860px]">
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (error) setError(''); }}
            placeholder="Write a reply"
            rows={1}
            maxLength={2000}
            className="flex-1 resize-none rounded-[18px] border border-[#DDDDDD] px-3.5 py-2 text-[14px] leading-snug max-h-[120px]" />
          <button
            onClick={send}
            disabled={sending}
            aria-label="Send reply"
            className="shrink-0 w-[38px] h-[38px] rounded-full bg-[#FF385C] text-white flex items-center justify-center disabled:opacity-50">
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-[#B0B0B0] mt-1 px-1">Goes to the guest through the channel they booked on.</p>
      </div>
    </div>);

}
