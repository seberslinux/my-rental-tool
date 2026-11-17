import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Zap } from 'lucide-react';
import { apiGet } from '../data/session';

/**
 * Automatic pricing, on the Rates page.
 *
 * Every morning the app prices each open night against the market — what
 * the competitors ask for that date and how full they are — and sends
 * the chosen price to Smoobu by itself. Three ways to choose, each shown
 * with what it is expected to sell and earn over the nights ahead, so the
 * choice is made on numbers rather than names. Off until a mode and a
 * floor are set; the guardrails are here, and so is every change it made.
 */

type Mode = 'off' | 'occupancy' | 'balanced' | 'revenue';
interface Rec { rate: number; chance: number; }
interface Night {
  date: string; kind: string; current: number | null; competitors: number; floor?: number | null; skip?: string;
  lead?: number; market?: number; market_rate?: number; fullness?: number;
  recommended?: Record<Exclude<Mode, 'off'>, Rec>; target: number | null;
}
interface Settings { mode: Mode; floor: number | null; floors: Record<number, number>; ceiling: number | null; max_step: number; horizon: number; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
interface Change { date: string; old_price: number | null; new_price: number; mode: string; market: number | null; fullness: number | null; changed_at: string; }
interface Data {
  modes: { key: Exclude<Mode, 'off'>; label: string }[];
  settings: Settings; currency: string; conversion: { markup: number; cleaning: number; competitors_cleaning: number | null; competitors_measured: number };
  totals: Record<'current' | Exclude<Mode, 'off'>, { nights: number; money: number }>;
  open_nights: number; priced_nights: number; nights: Night[]; changes: Change[];
}

const CARD = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const SECTION = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';
const SIGNS: Record<string, string> = { ZAR: 'R', EUR: '€', USD: '$', GBP: '£' };
const money = (n: number | null | undefined, c: string) =>
  n == null ? '–' : `${SIGNS[c] || `${c} `}${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
const BLURB: Record<Exclude<Mode, 'off'>, string> = {
  occupancy: 'Cheaper, to fill the calendar. Counts a sale four times over.',
  balanced: 'A little under the top price, surer to sell. Counts a sale twice.',
  revenue: 'The price with the most money expected, even if fewer nights sell.',
};

export function AutoPricing({ propertyId }: { propertyId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    if (!propertyId) return;
    apiGet<Data>(`/api/properties/${propertyId}/auto-pricing`)
      .then((d) => { setData(d); setForm(d.settings); setError(''); })
      .catch(() => setError('Could not work out the prices.'));
  }, [propertyId]);
  useEffect(() => { setData(null); setNote(''); load(); }, [load]);

  if (error) return <div className={`${CARD} px-4 py-3 mb-6 text-[14px] text-[#C13515]`}>{error}</div>;
  if (!data || !form) return null;
  const c = data.currency;
  const saved = data.settings;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch(`/api/properties/${propertyId}/auto-pricing`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(body.error || 'Could not save.'); return; }
      setNote(form.mode === 'off' ? 'Saved. Automatic pricing is off.' : 'Saved. It runs every morning at 08:30.');
      load();
    } finally { setBusy(false); }
  };
  const runNow = async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch(`/api/properties/${propertyId}/auto-pricing/run`, { method: 'POST', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      setNote(res.ok ? `Sent: ${body.changed} night${body.changed === 1 ? '' : 's'} repriced, ${body.up} up, ${body.down} down.` : body.error || 'Could not run.');
      load();
    } finally { setBusy(false); }
  };
  const set = (k: keyof Settings, v: string) => setForm({ ...form, [k]: k === 'mode' ? v : v === '' ? null : Number(v) } as Settings);
  const setMonth = (m: number, v: string) => {
    const floors = { ...form.floors };
    if (v === '') delete floors[m]; else floors[m] = Number(v);
    setForm({ ...form, floors });
  };

  const shown = data.nights.filter((n) => n.recommended).slice(0, all ? undefined : 21);
  const current = data.totals.current;

  return (
    <div className="mb-8">
      <div className={SECTION}>Automatic pricing</div>
      <div className={`${CARD} p-4 space-y-4`}>
        <p className="text-[13px] text-[#717171]">
          Every morning it prices each open night against the market — what the competitors ask for that date and how
          full they are — and sends the price to Smoobu by itself. Booked and blocked nights are never touched.
        </p>

        {/* The choice, with what each is worth. */}
        <div>
          <div className="text-[13px] text-[#717171] mb-2">
            Over the next {saved.horizon} days: {data.priced_nights} open nights priced
            {data.open_nights > data.priced_nights ? ` (${data.open_nights - data.priced_nights} with too little market data, left alone)` : ''}.
            At today's prices you'd expect about <b className="text-[#222222]">{current.nights} nights</b> sold for <b className="text-[#222222]">{money(current.money, c)}</b>.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {data.modes.map((m) => {
              const t = data.totals[m.key];
              const on = form.mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => set('mode', on ? 'off' : m.key)}
                  className={`text-left rounded-[10px] border p-3 ${on ? 'border-[#222222] bg-[#FAFAFA] ring-1 ring-[#222222]' : 'border-[#DDDDDD] bg-white'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-semibold text-[#222222]">{m.label}</span>
                    {on && <Check className="w-4 h-4 text-[#0F6E56]" />}
                  </div>
                  <div className="text-[12px] text-[#717171] mt-0.5">{BLURB[m.key]}</div>
                  <div className="text-[13px] text-[#222222] mt-2 tabular-nums">
                    ~{t.nights} nights · <b>{money(t.money, c)}</b>
                  </div>
                  <div className="text-[12px] text-[#717171] tabular-nums">
                    {t.money >= current.money ? '+' : '−'}{money(Math.abs(t.money - current.money), c)} · {t.nights >= current.nights ? '+' : '−'}{Math.abs(t.nights - current.nights)} nights against today
                  </div>
                </button>);
            })}
          </div>
          <p className="text-[12px] text-[#B0B0B0] mt-1.5">
            Expected, not promised: the chance each night sells at each price, added up. Your rate, before channel fees.
            Tap the chosen one again to switch it off.
          </p>
        </div>

        {/* Guardrails. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            ['floor', 'Floor, other months', 'rate'],
            ['ceiling', 'Never above', 'no limit'],
            ['max_step', 'Move at most, per day', '%'],
            ['horizon', 'Days ahead', 'days'],
          ] as [Exclude<keyof Settings, 'mode' | 'floors'>, string, string][]).map(([k, l, ph]) =>
          <label key={k} className="block">
              <span className="block text-[12px] text-[#717171] mb-1">{l}{k === 'max_step' ? ' (%)' : ''}</span>
              <input
              type="number" inputMode="numeric" placeholder={ph}
              value={form[k] ?? ''}
              onChange={(e) => set(k, e.target.value)}
              className="w-full h-[38px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] tabular-nums" />
            </label>
          )}
        </div>

        {/* A floor per month: summer and winter are not the same night. */}
        <div>
          <div className="text-[12px] text-[#717171] mb-1">Floor by month — leave a month blank to use the floor above</div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {MONTHS.map((name, i) =>
            <label key={name} className="block">
                <span className="block text-[11px] text-[#717171] mb-0.5">{name}</span>
                <input
                type="number" inputMode="numeric" placeholder={form.floor ? String(form.floor) : '–'}
                value={form.floors[i + 1] ?? ''}
                onChange={(e) => setMonth(i + 1, e.target.value)}
                aria-label={`Floor for ${name}`}
                className="w-full h-[34px] px-1.5 border border-[#DDDDDD] rounded-[8px] text-[13px] tabular-nums" />
              </label>
            )}
          </div>
        </div>
        {form.mode !== 'off' && !form.floor && MONTHS.some((_, i) => !form.floors[i + 1]) &&
        <p className="text-[13px] text-[#C13515] flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Set a floor for the other months before switching it on.</p>
        }

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="px-4 h-[38px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold disabled:opacity-40">
            Save
          </button>
          {saved.mode !== 'off' &&
          <button
            onClick={runNow}
            disabled={busy || dirty}
            className="px-4 h-[38px] rounded-[8px] border border-[#DDDDDD] bg-white text-[14px] font-semibold flex items-center gap-1.5 disabled:opacity-40">
              <Zap className="w-4 h-4" /> Send now
            </button>
          }
          <span className="text-[13px] text-[#717171]">
            {note || (saved.mode === 'off' ? 'Off.' : `On: ${data.modes.find((m) => m.key === saved.mode)?.label.toLowerCase()}, every morning at 08:30.`)}
          </span>
        </div>
      </div>

      {/* Night by night. */}
      {shown.length > 0 &&
      <div className="mt-4">
          <div className={SECTION}>Night by night</div>
          <div className={`${CARD} divide-y divide-[#F0F0F0]`}>
            {shown.map((n) => {
            const r = n.recommended!;
            return (
              <div key={n.date} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium text-[#222222]">{day(n.date)}</span>
                    <span className="text-[13px] tabular-nums">
                      {money(n.current, c)}
                      {n.target != null && saved.mode !== 'off' &&
                      <span className={n.target > (n.current || 0) ? 'text-[#0F6E56] font-semibold' : 'text-[#C13515] font-semibold'}> → {money(n.target, c)}</span>
                      }
                    </span>
                  </div>
                  <div className="text-[12px] text-[#717171] tabular-nums">
                    Market {money(n.market_rate, c)} · {n.fullness}% of competitors full · {n.lead} days out{n.floor ? ` · floor ${money(n.floor, c)}` : ''}
                  </div>
                  <div className="text-[12px] text-[#222222] tabular-nums">
                    Most nights {money(r.occupancy.rate, c)} <span className="text-[#B0B0B0]">({Math.round(r.occupancy.chance * 100)}%)</span>
                    {' · '}Balanced {money(r.balanced.rate, c)} <span className="text-[#B0B0B0]">({Math.round(r.balanced.chance * 100)}%)</span>
                    {' · '}Most money {money(r.revenue.rate, c)} <span className="text-[#B0B0B0]">({Math.round(r.revenue.chance * 100)}%)</span>
                  </div>
                </div>);
          })}
          </div>
          <p className="text-[12px] text-[#B0B0B0] mt-1.5">
            Prices in your rate. The market is the competitors' median asking price for the nearest stay of the same kind,
            the price leader left out. Airbnb shows every listing all-in, so each quote is taken apart the same way: its own
            one-off cleaning fee off (measured weekly{data.conversion.competitors_cleaning != null ? `; competitors average ${money(data.conversion.competitors_cleaning, c)} over ${data.conversion.competitors_measured}` : ''}),
            the rest over the nights, the {data.conversion.markup}% service fee off. Your rate is compared on the same footing; a guest
            sees it with the markup and your {money(data.conversion.cleaning, c)} cleaning added back.
          </p>
          {!all && data.priced_nights > shown.length &&
          <button onClick={() => setAll(true)} className="mt-1 text-[13px] font-semibold underline underline-offset-2">Show all {data.priced_nights} nights</button>
          }
        </div>
      }

      {/* What it did. */}
      {data.changes.length > 0 &&
      <div className="mt-4">
          <div className={SECTION}>Changes it sent</div>
          <div className={`${CARD} divide-y divide-[#F0F0F0]`}>
            {data.changes.slice(0, 20).map((x, i) =>
          <div key={i} className="px-4 py-2 flex items-baseline justify-between gap-2 text-[13px]">
                <span>{day(x.date)} <span className="text-[#B0B0B0]">· {new Date(x.changed_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</span></span>
                <span className="tabular-nums">{money(x.old_price, c)} → <b>{money(x.new_price, c)}</b> <span className="text-[#717171]">{x.fullness != null ? `· ${x.fullness}% full` : ''}</span></span>
              </div>
          )}
          </div>
        </div>
      }
    </div>);
}
