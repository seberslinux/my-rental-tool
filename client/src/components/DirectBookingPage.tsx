import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../data/session';

/**
 * Direct bookings: a payment link for a guest.
 *
 * Pick the property, dates and guests; the app quotes what the stay costs
 * on Airbnb and suggests a direct price 10% below it, which can be
 * overwritten. The link goes to the guest by WhatsApp or email; they pay
 * the whole amount on Paystack and the booking is created in Smoobu as a
 * paid direct booking. Below, every link and where it stands.
 *
 * Each property is paid into its own Paystack account (the Loft into one
 * owner's, the Lodge into the joint one); an admin connects each with its
 * secret key, which is stored encrypted and never shown again.
 */

interface Quote {
  nights: number; rates: number; cleaning: number; airbnb_markup: number;
  airbnb_total: number; direct_total: number; discount_percent: number;
  available: boolean; taken: string[]; unpriced: string[]; min_stay: number | null; below_min_stay: boolean;
}
interface Account { property_id: number; name: string; connected: boolean; mode: 'test' | 'live' | null; account_name: string | null; }
interface Website { property_id: number; enabled: boolean; slug: string; terms: string; paystack: boolean; }
interface Link {
  id: number; token: string; property_id: number; property_name?: string;
  check_in: string; check_out: string; adults: number; children: number;
  first_name: string; last_name: string; email: string; phone: string | null;
  amount: number; airbnb: number | null; status: string; expires_at: string; error: string | null;
  smoobu_reservation_id: number | null; created_at: string; source?: string;
}

const CARD = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const SECTION = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';
const INPUT = 'w-full h-[40px] px-2.5 border border-[#DDDDDD] rounded-[8px] text-[15px] bg-white';
const LABEL = 'block text-[12px] text-[#717171] mb-1';
const rand = (n: number) => `R${Math.round(n).toLocaleString('en-ZA')}`;
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const linkUrl = (token: string) => `${window.location.origin}/pay/${token}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Sent', cls: 'bg-[#F0F0F0] text-[#484848]' },
  pending: { label: 'At checkout', cls: 'bg-[#FFF4E5] text-[#B25E09]' },
  booking: { label: 'Booking…', cls: 'bg-[#FFF4E5] text-[#B25E09]' },
  booked: { label: 'Paid · booked', cls: 'bg-[#E8F5E9] text-[#008A05]' },
  paid_unbooked: { label: 'Paid · not booked', cls: 'bg-[#FDECEA] text-[#C13515]' },
  expired: { label: 'Expired', cls: 'bg-[#F0F0F0] text-[#B0B0B0]' },
  cancelled: { label: 'Cancelled', cls: 'bg-[#F0F0F0] text-[#B0B0B0]' },
};

/** A South African mobile number as WhatsApp wants it: 082… → 2782…. */
const waNumber = (phone: string | null) => {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('0') ? `27${d.slice(1)}` : d;
};
const message = (l: Link, property: string) =>
  `Hi ${l.first_name}, here is your booking for ${property}, ${day(l.check_in)} to ${day(l.check_out)}: ${rand(l.amount)} in total. ` +
  `You can pay securely here: ${linkUrl(l.token)}`;

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong');
  return json as T;
}

function AccountRow({ a, onSaved }: { a: Account; onSaved: (list: Account[]) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState(a.account_name || '');
  const [note, setNote] = useState('');
  const save = async () => {
    setNote('');
    try {
      const res = await fetch(`/api/payment-links/accounts/${a.property_id}`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret_key: key, account_name: name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(json.error || 'Could not connect.'); return; }
      setKey(''); setOpen(false); onSaved(json.accounts);
    } catch { setNote('Could not connect.'); }
  };
  const remove = async () => {
    const res = await fetch(`/api/payment-links/accounts/${a.property_id}`, { method: 'DELETE', credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (res.ok) onSaved(json.accounts); else setNote(json.error || 'Could not disconnect.');
  };
  return (
    <div className="p-3 px-4 border-t border-[#F0F0F0] first:border-t-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium">{a.name}</div>
          <div className="text-[13px] text-[#717171]">
            {a.connected ? <>Paid into <b className="text-[#222222]">{a.account_name}</b>'s Paystack</> : 'No Paystack account: links can be made, not paid'}
          </div>
        </div>
        {a.connected && <span className={`text-[12px] font-semibold px-2 py-1 rounded-full ${a.mode === 'live' ? 'bg-[#E8F5E9] text-[#008A05]' : 'bg-[#FFF4E5] text-[#B25E09]'}`}>{a.mode === 'live' ? 'Live' : 'Test'}</span>}
        <button onClick={() => setOpen(!open)} className="text-[13px] underline">{a.connected ? 'Change' : 'Connect'}</button>
      </div>
      {open && (
        <div className="mt-2 grid gap-2">
          <input className={INPUT} placeholder="Whose account, e.g. Francesca" value={name} onChange={(e) => setName(e.target.value)} aria-label={`${a.name} account name`} />
          <input className={INPUT} type="password" autoComplete="off" placeholder="Secret key from Paystack (sk_test_… or sk_live_…)" value={key} onChange={(e) => setKey(e.target.value)} aria-label={`${a.name} Paystack secret key`} />
          <div className="flex gap-3 items-center">
            <button onClick={save} disabled={!key || !name} className="px-4 h-[36px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold disabled:opacity-40">Save</button>
            {a.connected && <button onClick={remove} className="text-[13px] text-[#C13515] underline">Disconnect</button>}
          </div>
          <p className="text-[12px] text-[#B0B0B0]">Paystack → Settings → API Keys &amp; Webhooks. Stored encrypted; it can't be shown again. Set the webhook URL there to {window.location.origin}/paystack/webhook.</p>
        </div>)}
      {note && <p className="text-[13px] text-[#C13515] mt-1">{note}</p>}
    </div>);
}

function WebsiteRow({ w, name, onSaved }: { w: Website; name: string; onSaved: (w: Website) => void }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(w.enabled);
  const [slug, setSlug] = useState(w.slug);
  const [terms, setTerms] = useState(w.terms);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState('');
  const url = `${window.location.origin}/book/${w.slug}`;
  const button = `<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;background:#222;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Book direct</a>`;
  const save = async () => {
    setNote('');
    const res = await fetch(`/api/payment-links/website/${w.property_id}`, {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, slug, terms }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setNote(json.error || 'Could not save.'); return; }
    onSaved(json); setNote('Saved.');
  };
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch {} };
  return (
    <div className="p-3 px-4 border-t border-[#F0F0F0] first:border-t-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-medium">{name}</div>
          <div className="text-[13px] text-[#717171] truncate">
            {w.enabled ? <a href={url} target="_blank" rel="noreferrer" className="underline">{url.replace(/^https?:\/\//, '')}</a>
              : w.paystack ? 'Not on the website' : 'Needs a Paystack account first'}
          </div>
        </div>
        {w.enabled && <span className="text-[12px] font-semibold px-2 py-1 rounded-full bg-[#E8F5E9] text-[#008A05]">On</span>}
        <button onClick={() => setOpen(!open)} className="text-[13px] underline">{open ? 'Close' : 'Set up'}</button>
      </div>
      {open && (
        <div className="mt-2 grid gap-2">
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={enabled} disabled={!w.paystack} onChange={(e) => setEnabled(e.target.checked)} aria-label={`${name} on the website`} />
            Guests can book and pay on the website
          </label>
          <div>
            <label className={LABEL}>Address</label>
            <div className="flex items-center gap-1 text-[14px] text-[#717171]">/book/<input className={INPUT} value={slug} onChange={(e) => setSlug(e.target.value)} aria-label={`${name} address`} /></div>
          </div>
          <div>
            <label className={LABEL}>Booking terms the guest accepts before paying (cancellation, house rules)</label>
            <textarea className={`${INPUT} h-[120px] py-2`} value={terms} onChange={(e) => setTerms(e.target.value)} aria-label={`${name} booking terms`} />
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={save} className="px-4 h-[36px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold">Save</button>
            <span className="text-[13px] text-[#717171]">{note}</span>
          </div>
          {w.enabled && (
            <div className="text-[12px] text-[#717171]">
              For the website: a link to the page, or this button (WordPress: add a "Code" or "Custom HTML" block).
              <div className="flex gap-3 mt-1">
                <button onClick={() => copy('link', url)} className="underline">{copied === 'link' ? 'Copied' : 'Copy link'}</button>
                <button onClick={() => copy('button', button)} className="underline">{copied === 'button' ? 'Copied' : 'Copy button code'}</button>
              </div>
            </div>)}
        </div>)}
    </div>);
}

export function DirectBookingPage({ initialPropertyId, isAdmin = false }: { initialPropertyId?: number; isAdmin?: boolean }) {
  const [properties, setProperties] = useState<{ id: number; name: string }[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [website, setWebsite] = useState<Website[]>([]);
  const [form, setForm] = useState({
    property_id: initialPropertyId || 0, check_in: addDays(todayIso(), 7), check_out: addDays(todayIso(), 9),
    adults: '2', children: '0', first_name: '', last_name: '', email: '', phone: '', note: '', hours: '48',
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<Link | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(() => {
    apiGet<{ links: Link[]; accounts: Account[]; website: Website[] }>('/api/payment-links')
      .then((d) => { setLinks(d.links); setAccounts(d.accounts); setWebsite(d.website || []); })
      .catch(() => setError('Could not load the links.'));
  }, []);
  useEffect(() => {
    load();
    apiGet<{ id: number; name: string }[]>('/api/properties').then((list) => {
      setProperties(list);
      setForm((f) => (f.property_id ? f : { ...f, property_id: list[0]?.id || 0 }));
    }).catch(() => {});
  }, [load]);

  // A fresh quote whenever the stay changes; the price follows it until edited.
  useEffect(() => {
    if (!form.property_id || !form.check_in || !form.check_out || form.check_out <= form.check_in) { setQuote(null); return; }
    let live = true;
    setQuoteError('');
    post<Quote>('/api/payment-links/quote', { property_id: form.property_id, check_in: form.check_in, check_out: form.check_out })
      .then((q) => { if (!live) return; setQuote(q); setAmount(String(q.direct_total)); })
      .catch((e) => { if (live) { setQuote(null); setQuoteError(e.message); } });
    return () => { live = false; };
  }, [form.property_id, form.check_in, form.check_out]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: k === 'property_id' ? Number(e.target.value) : e.target.value });
  const total = Number(amount) || 0;
  const below = quote && quote.airbnb_total ? Math.round(100 * (1 - total / quote.airbnb_total)) : null;
  // What each way pays out: Airbnb keeps 17.25%; Paystack about 3% + R1, plus VAT on it.
  const airbnbPayout = quote ? quote.airbnb_total * (1 - 0.1725) : 0;
  const directPayout = total ? total - (total * 0.031 + 1) * 1.15 : 0;
  const account = accounts.find((a) => a.property_id === form.property_id);
  const propertyName = useMemo(() => Object.fromEntries(properties.map((p) => [p.id, p.name])), [properties]);

  const create = async () => {
    setError(''); setBusy(true);
    try {
      const l = await post<Link>('/api/payment-links', {
        ...form, adults: Number(form.adults), children: Number(form.children), hours: Number(form.hours), amount: total,
      });
      setMade(l);
      setForm({ ...form, first_name: '', last_name: '', email: '', phone: '', note: '' });
      load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  const copy = async (l: Link) => {
    try { await navigator.clipboard.writeText(linkUrl(l.token)); setCopied(l.id); setTimeout(() => setCopied(null), 1500); } catch {}
  };
  const act = async (l: Link, what: 'cancel' | 'retry') => {
    setError('');
    try { await post(`/api/payment-links/${l.id}/${what}`); load(); } catch (e: any) { setError(e.message); }
  };

  const canCreate = quote?.available && total >= 100 && form.first_name.trim() && /\S+@\S+\.\S+/.test(form.email) && !busy;

  return (
    <div className="p-4 bg-[#F7F7F7] min-h-full max-w-[720px] mx-auto">
      <div className={SECTION}>New payment link</div>
      <div className={`${CARD} p-4 mb-6`}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL}>Property</label>
            <select className={INPUT} value={form.property_id} onChange={set('property_id')} aria-label="Property">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {account && (account.connected
              ? <p className="text-[12px] text-[#717171] mt-1">Paid into {account.account_name}'s Paystack{account.mode === 'test' ? ' (test mode: no real money)' : ''}.</p>
              : <p className="text-[12px] text-[#B25E09] mt-1">No Paystack account for {account.name} yet: the guest won't be able to pay this link.</p>)}
          </div>
          <div><label className={LABEL}>Check-in</label><input type="date" className={INPUT} value={form.check_in} min={todayIso()} onChange={set('check_in')} aria-label="Check-in" /></div>
          <div><label className={LABEL}>Check-out</label><input type="date" className={INPUT} value={form.check_out} min={form.check_in} onChange={set('check_out')} aria-label="Check-out" /></div>
          <div><label className={LABEL}>Adults</label><input type="number" min={1} className={INPUT} value={form.adults} onChange={set('adults')} aria-label="Adults" /></div>
          <div><label className={LABEL}>Children</label><input type="number" min={0} className={INPUT} value={form.children} onChange={set('children')} aria-label="Children" /></div>
        </div>

        {quoteError && <p className="text-[13px] text-[#C13515] mt-3">{quoteError}</p>}
        {quote && (
          <div className="mt-4 rounded-[10px] bg-[#F7F7F7] p-3 text-[14px]">
            {!quote.available && (
              <p className="text-[#C13515] font-semibold mb-2">
                {quote.taken.length ? `Not available: ${quote.taken.map(day).join(', ')}` : `No price in Smoobu for ${quote.unpriced.map(day).join(', ')}`}
              </p>)}
            {quote.below_min_stay && <p className="text-[#B25E09] mb-2">Shorter than the minimum stay in Smoobu ({quote.min_stay} nights). A direct booking may still allow it.</p>}
            <div className="flex justify-between"><span className="text-[#717171]">On Airbnb ({quote.nights} night{quote.nights === 1 ? '' : 's'})</span><span className="tabular-nums">{rand(quote.airbnb_total)}</span></div>
            <div className="text-[12px] text-[#B0B0B0] mb-2">Smoobu rates {rand(quote.rates)} + {quote.airbnb_markup}% Airbnb markup + cleaning {rand(quote.cleaning)}</div>
            <label className={LABEL}>Direct price (suggested: {quote.discount_percent}% below Airbnb)</label>
            <div className="flex items-center gap-2">
              <span className="text-[15px]">R</span>
              <input type="number" inputMode="decimal" className={`${INPUT} max-w-[160px] tabular-nums font-semibold`} value={amount}
                onChange={(e) => setAmount(e.target.value)} aria-label="Direct price" />
              {below != null && <span className="text-[13px] text-[#717171]">{below >= 0 ? `${below}% below Airbnb` : `${-below}% above Airbnb`}</span>}
            </div>
            {total > 0 && (
              <div className="text-[12px] text-[#717171] mt-2">
                You receive about <b className="text-[#222222]">{rand(directPayout)}</b> (after Paystack's fee),
                against {rand(airbnbPayout)} through Airbnb.
              </div>)}
          </div>)}

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div><label className={LABEL}>Guest first name</label><input className={INPUT} value={form.first_name} onChange={set('first_name')} aria-label="Guest first name" /></div>
          <div><label className={LABEL}>Last name</label><input className={INPUT} value={form.last_name} onChange={set('last_name')} aria-label="Guest last name" /></div>
          <div><label className={LABEL}>Email (for the receipt)</label><input type="email" className={INPUT} value={form.email} onChange={set('email')} aria-label="Guest email" /></div>
          <div><label className={LABEL}>Phone (WhatsApp)</label><input type="tel" className={INPUT} value={form.phone} onChange={set('phone')} aria-label="Guest phone" /></div>
          <div>
            <label className={LABEL}>Offer open for</label>
            <select className={INPUT} value={form.hours} onChange={set('hours')} aria-label="Offer open for">
              <option value="24">24 hours</option><option value="48">2 days</option><option value="72">3 days</option><option value="168">7 days</option>
            </select>
          </div>
          <div><label className={LABEL}>Note in Smoobu (optional)</label><input className={INPUT} value={form.note} onChange={set('note')} aria-label="Note" /></div>
        </div>
        <p className="text-[12px] text-[#B0B0B0] mt-2">The dates aren't held: they're checked again when the guest pays.</p>
        <button onClick={create} disabled={!canCreate}
          className="mt-3 w-full h-[44px] rounded-[8px] bg-[#222222] text-white text-[15px] font-semibold disabled:opacity-40">
          {busy ? 'Making the link…' : `Make link for ${rand(total)}`}
        </button>
        {error && <p className="text-[13px] text-[#C13515] mt-2">{error}</p>}

        {made && (
          <div className="mt-4 p-3 rounded-[10px] bg-[#E8F5E9] text-[14px]">
            <div className="font-semibold text-[#008A05] mb-1">Link ready for {made.first_name}</div>
            <div className="break-all text-[13px] mb-2">{linkUrl(made.token)}</div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => copy(made)} className="px-3 h-[36px] rounded-[8px] bg-white border border-[#DDDDDD] text-[14px]">{copied === made.id ? 'Copied' : 'Copy link'}</button>
              <a href={`https://wa.me/${waNumber(made.phone)}?text=${encodeURIComponent(message(made, propertyName[made.property_id] || ''))}`}
                target="_blank" rel="noreferrer" className="px-3 h-[36px] leading-[36px] rounded-[8px] bg-[#25D366] text-white text-[14px] font-semibold">Send on WhatsApp</a>
              <a href={`mailto:${made.email}?subject=${encodeURIComponent(`Your booking at ${propertyName[made.property_id] || ''}`)}&body=${encodeURIComponent(message(made, propertyName[made.property_id] || ''))}`}
                className="px-3 h-[36px] leading-[36px] rounded-[8px] bg-white border border-[#DDDDDD] text-[14px]">Email</a>
            </div>
          </div>)}
      </div>

      {isAdmin && accounts.length > 0 && <>
        <div className={SECTION}>Paystack accounts</div>
        <div className={`${CARD} overflow-hidden mb-6`}>
          {accounts.map((a) => <AccountRow key={a.property_id} a={a} onSaved={(list) => { setAccounts(list); load(); }} />)}
        </div>
        <div className={SECTION}>Website booking</div>
        <div className={`${CARD} overflow-hidden mb-6`}>
          {website.map((w) => <WebsiteRow key={w.property_id} w={w} name={propertyName[w.property_id] || ''}
            onSaved={(saved) => setWebsite(website.map((x) => (x.property_id === saved.property_id ? saved : x)))} />)}
        </div>
      </>}

      <div className={SECTION}>Payment links</div>
      <div className={`${CARD} overflow-hidden`}>
        {links.length === 0 && <p className="p-4 text-[14px] text-[#717171]">No links yet.</p>}
        {links.map((l, i) => {
          const s = STATUS[l.status] || { label: l.status, cls: 'bg-[#F0F0F0]' };
          return (
            <div key={l.id} className={`p-3 px-4 ${i ? 'border-t border-[#F0F0F0]' : ''}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium truncate">{l.first_name} {l.last_name} · {rand(l.amount)}{l.source === 'website' && <span className="text-[12px] text-[#717171] font-normal"> · website</span>}</div>
                  <div className="text-[13px] text-[#717171]">{l.property_name || propertyName[l.property_id]} · {day(l.check_in)}–{day(l.check_out)} · {l.adults + l.children} guest{l.adults + l.children === 1 ? '' : 's'}</div>
                </div>
                <span className={`text-[12px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
              </div>
              {l.error && <p className="text-[12px] text-[#C13515] mt-1">{l.error}</p>}
              <div className="flex gap-3 mt-1.5 text-[13px]">
                {['open', 'pending'].includes(l.status) && <>
                  <button onClick={() => copy(l)} className="text-[#222222] underline">{copied === l.id ? 'Copied' : 'Copy link'}</button>
                  <a href={`https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(message(l, l.property_name || propertyName[l.property_id] || ''))}`} target="_blank" rel="noreferrer" className="text-[#222222] underline">WhatsApp</a>
                  <button onClick={() => act(l, 'cancel')} className="text-[#C13515] underline">Cancel</button>
                </>}
                {l.status === 'paid_unbooked' && <button onClick={() => act(l, 'retry')} className="text-[#222222] underline">Try booking again</button>}
                {l.status === 'booked' && l.smoobu_reservation_id && <span className="text-[#717171]">Smoobu booking {l.smoobu_reservation_id}</span>}
              </div>
            </div>);
        })}
      </div>
    </div>);
}
