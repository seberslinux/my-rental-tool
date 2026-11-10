import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, RefreshCw, Send, Save } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';

/**
 * Everything about what a night costs, in one place.
 *
 * This was two screens. A sheet on the Properties page held the rate
 * plan — what each kind of night is worth — and a separate page held the
 * algorithms that move those numbers and the channel percentages that
 * decide what a guest is shown. Two places to set a price is one too
 * many: you could set a plan in one and never see what the rules in the
 * other would do to it.
 *
 * So they are one screen, in the order somebody actually asks:
 *
 *   What a night is worth      the plan, by kind of night
 *   What each channel adds     what the guest sees on top
 *   Rules                      what moves a price given the diary
 *   What would change          every night, old to new, before sending
 *
 * ## Nothing is written until you say so
 *
 * The preview takes the plan and the rules being tried rather than
 * reading what is stored, so a number can go in, be looked at, and come
 * out again with nothing persisted. Saving is a button. Applying saves
 * first, so what reaches Smoobu is always what is on the screen and
 * what the screen will show next time.
 *
 * The engine two versions ago ran every morning against numbers nobody
 * could see. The only thing that kept it from repricing two listings to
 * R80 a night was an unrelated bug in the API call.
 */

interface Param {
  key: string;label: string;type: 'int' | 'percent' | 'bool' | 'money';
  unit?: string;default: number | boolean;min: number;max: number;
}
interface Strategy {key: string;label: string;blurb: string;params: Param[];}
interface Entry {enabled: boolean;params: Record<string, any>;}

interface TrailStep {label: string;price?: number;change?: number;why: string;}
interface ChannelView {label: string;markup: number;guest: number;net: number;}
interface Row {
  date: string;label: string;
  plan_price: number;new_price: number;current_price: number | null;
  new_min_stay: number | null;current_min_stay: number | null;
  changes: boolean;trail: TrailStep[];
  views: {base: number;channels: Record<string, ChannelView>;};
}
interface Channel {key: string;label: string;markup: number;commission: number;}
interface Preview {
  nights: number;changing: number;occupancy: number | null;
  totals: {current: number;plan: number;strategies: number;};
  channels: Channel[];rows: Row[];
}

interface Rule {price: string;min_stay: string;}

/** Most specific first — the order a night is tested against. */
const ORDER = ['long_weekend', 'public_holiday', 'school_holiday', 'weekend', 'weekday'];

const EXPLAIN: Record<string, string> = {
  long_weekend: 'A public holiday next to a weekend — three nights, or four when the day between gets bridged',
  public_holiday: 'A public holiday in the middle of the week',
  school_holiday: 'Inside a school term in the markets these guests come from',
  weekend: 'Friday and Saturday',
  weekday: 'Everything else',
};

const money = (n: number | null | undefined) =>
n == null ? '—' : `R ${Math.round(n).toLocaleString('en-ZA')}`;

const pretty = (d: string) =>
new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });

const iso = (d: Date) => d.toISOString().slice(0, 10);

const SECTION = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';
const CARD = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';

export function RatesPage({ initialPropertyId = 0 }: {
  /**
   * Which property to open on.
   *
   * Set when somebody arrived from the Rates link on a property row, so
   * they land on the one they were looking at rather than on the first
   * in the list.
   */
  initialPropertyId?: number;
}) {
  const [properties, setProperties] = useState<{id: number;name: string;}[]>([]);
  const [propertyId, setPropertyId] = useState<number>(initialPropertyId);

  const [plan, setPlan] = useState<Record<string, Rule>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [markups, setMarkups] = useState<Record<string, string>>({});
  /**
   * The two numbers the morning health check measures against.
   *
   * Empty means not set, which the check reports as unchecked rather
   * than as passing — see services/health-check for why a default floor
   * would be the same mistake it exists to catch.
   */
  const [limits, setLimits] = useState<{floor: string;ceiling: string;}>({ floor: '', ceiling: '' });
  const [catalogue, setCatalogue] = useState<Strategy[]>([]);
  const [config, setConfig] = useState<Record<string, Entry>>({});
  /**
   * What each channel actually kept, measured off the booking rows.
   *
   * The reliable half of the same endpoint: no base in the ratio, so
   * nothing in it can go stale the way the markup above does.
   */
  const [commissions, setCommissions] = useState<Record<string, {
    commission: number;bookings: number;low: number;high: number;required_markup: number | null;
  }>>({});
  const [observed, setObserved] = useState<Record<string, {
    markup: number | null;bookings: number;nights: number;stale?: number;
    low: number | null;high: number | null;confident: boolean;
  }>>({});

  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date(Date.now() + 90 * 86400000)));

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  /** 'base', or a channel key — a way of reading the numbers, never what is sent. */
  const [view, setView] = useState('base');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (initialPropertyId) setPropertyId(initialPropertyId);
  }, [initialPropertyId]);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiGet<{id: number;name: string;}[]>('/api/properties');
        setProperties(list || []);
        if (list && list.length && !propertyId) setPropertyId(list[0].id);
      } catch (e) {
        if (!(e instanceof Unauthorized)) setFailed(true);
      }
    })();
  }, []);

  // Everything this property holds about its rates, in one load.
  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        const [p, s, prop] = await Promise.all([
          apiGet<{plan: Record<string, any>;labels: Record<string, string>;}>(
            `/api/properties/${propertyId}/rate-plan`),
          apiGet<{catalogue: Strategy[];config: Record<string, Entry>;}>(
            `/api/properties/${propertyId}/rate-strategies`),
          apiGet<any>(`/api/properties/${propertyId}`),
        ]);

        const next: Record<string, Rule> = {};
        for (const c of ORDER) {
          next[c] = {
            price: p.plan[c] ? String(Math.round(p.plan[c].price)) : '',
            min_stay: p.plan[c] && p.plan[c].min_stay ? String(p.plan[c].min_stay) : '',
          };
        }
        setPlan(next);
        setLabels(p.labels || {});
        setCatalogue(s.catalogue || []);
        setConfig(s.config || {});
        setMarkups({
          airbnb: String(prop.guest_markup_airbnb ?? 0),
          booking: String(prop.guest_markup_booking ?? 0),
          vrbo: String(prop.guest_markup_vrbo ?? 0),
        });
        setLimits({
          floor: Number(prop.price_floor) > 0 ? String(Math.round(prop.price_floor)) : '',
          ceiling: Number(prop.price_ceiling) > 0 ? String(Math.round(prop.price_ceiling)) : '',
        });
        setDone('');
        setFailed(false);

        // Best effort: a property with no synced rates has nothing to say.
        apiGet<{observed: any;commissions: any;}>(`/api/properties/${propertyId}/observed-markup`).
        then((o) => { setObserved(o.observed || {}); setCommissions(o.commissions || {}); }).
        catch(() => { setObserved({}); setCommissions({}); });
      } catch (e) {
        if (!(e instanceof Unauthorized)) setFailed(true);
      }
    })();
  }, [propertyId]);

  /**
   * Re-price on every change, against what is on the screen.
   *
   * Debounced, because dragging a number from 25 to 40 is a dozen
   * keystrokes and a dozen previews would answer for the numbers passed
   * through rather than the one stopped on.
   */
  const timer = useRef<any>(null);
  const runPreview = useCallback(() => {
    if (!propertyId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setPreviewing(true);
      setError('');
      try {
        const res = await fetch(`/api/properties/${propertyId}/rate-plan/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ from, to, strategies: config, plan }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not price that');
        setPreview(await res.json());
      } catch (e: any) {
        setError(e.message);
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 400);
  }, [propertyId, from, to, config, plan]);

  useEffect(() => { runPreview(); return () => clearTimeout(timer.current); }, [runPreview]);

  const setRule = (c: string, field: keyof Rule, v: string) => {
    setPlan((p) => ({ ...p, [c]: { ...p[c], [field]: v } }));
    setDone('');
  };
  const setParam = (key: string, param: string, value: any) => {
    setConfig((c) => ({
      ...c,
      [key]: { enabled: c[key]?.enabled ?? false, params: { ...(c[key]?.params || {}), [param]: value } },
    }));
    setDone('');
  };
  const toggle = (key: string) => {
    setConfig((c) => ({ ...c, [key]: { enabled: !(c[key]?.enabled), params: c[key]?.params || {} } }));
    setDone('');
  };

  /** Everything on this screen, written down. */
  const saveAll = async () => {
    const calls: Promise<Response>[] = [
      fetch(`/api/properties/${propertyId}/rate-plan`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ plan }),
      }),
      fetch(`/api/properties/${propertyId}/rate-strategies`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ config }),
      }),
      fetch(`/api/properties/${propertyId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          guest_markup_airbnb: Number(markups.airbnb) || 0,
          guest_markup_booking: Number(markups.booking) || 0,
          guest_markup_vrbo: Number(markups.vrbo) || 0,
          price_floor: Number(limits.floor) || 0,
          price_ceiling: Number(limits.ceiling) || 0,
        }),
      }),
    ];
    const results = await Promise.all(calls);
    const bad = results.find((r) => !r.ok);
    if (bad) {
      setError((await bad.json().catch(() => ({}))).error || 'Could not save that');
      return false;
    }
    return true;
  };

  const save = async () => {
    setBusy('save');
    setError('');
    const ok = await saveAll();
    setBusy('');
    if (ok) { setDone('Saved.'); runPreview(); }
  };

  /**
   * Send it.
   *
   * Saves first, so what reaches Smoobu is what the screen will still
   * show tomorrow. Applying settings that were never stored would leave
   * the two disagreeing the moment somebody reloaded.
   */
  const apply = async () => {
    if (!preview || preview.changing === 0) return;
    setBusy('apply');
    setError('');
    if (!(await saveAll())) return setBusy('');

    const res = await fetch(`/api/properties/${propertyId}/rate-plan/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ from, to }),
    });
    setBusy('');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error || 'Could not send those rates');
    const n = body.applied ?? preview.changing;
    setDone(`Sent ${n} night${n === 1 ? '' : 's'} to Smoobu.`);
    runPreview();
  };

  const changing = preview ? preview.rows.filter((r) => r.changes) : [];
  const shownPrice = (r: Row, which: 'current' | 'new') => {
    if (view === 'base') return which === 'new' ? r.new_price : r.current_price;
    // A channel view compares like with like: both sides marked up.
    const m = r.views?.channels?.[view]?.markup ?? 0;
    const base = which === 'new' ? r.new_price : r.current_price;
    return base == null ? null : Math.round(base * (1 + m / 100));
  };

  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      <div className="lg:max-w-[860px]">

        {failed &&
        <div className={`${CARD} px-4 py-3 mb-4 flex items-center gap-2`}>
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] flex-1">Could not load your rates.</span>
          </div>
        }

        {properties.length > 1 &&
        <select
          value={propertyId || ''}
          onChange={(e) => { setPropertyId(Number(e.target.value)); setPreview(null); }}
          className="w-full h-[44px] px-3 mb-4 border border-[#DDDDDD] rounded-[8px] text-[14px] bg-white">
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        }

        {/* 1. What a night is worth. */}
        <div className={SECTION}>What a night is worth</div>
        <div className={`${CARD} p-4 mb-6`}>
          <p className="text-[13px] text-[#717171] mb-3">
            A night gets one of these — the most specific that fits. Leave a rate blank and those nights are left alone.
          </p>
          {ORDER.map((c, i) =>
          <div key={c} className={`flex items-start gap-3 py-3 ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium">{labels[c] || c}</div>
                <div className="text-[13px] text-[#717171]">{EXPLAIN[c]}</div>
              </div>
              <input
              type="number" inputMode="numeric" placeholder="rate"
              value={plan[c]?.price ?? ''}
              onChange={(e) => setRule(c, 'price', e.target.value)}
              aria-label={`${labels[c] || c} rate`}
              className="w-[92px] shrink-0 h-[38px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] tabular-nums" />
              <input
              type="number" inputMode="numeric" placeholder="min"
              value={plan[c]?.min_stay ?? ''}
              onChange={(e) => setRule(c, 'min_stay', e.target.value)}
              aria-label={`${labels[c] || c} minimum nights`}
              className="w-[64px] shrink-0 h-[38px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] tabular-nums" />
            </div>
          )}
        </div>

        {/* 2. What each channel adds on top. */}
        <div className={SECTION}>What each channel adds</div>
        <div className={`${CARD} p-4 mb-6`}>
          <p className="text-[13px] text-[#717171] mb-3">
            The percentage a channel puts on your rate to make the price a guest sees. Set in Smoobu — this is where you
            tell this app what it is, so the numbers below can show both.
          </p>
          {(preview?.channels || []).map((ch, i) =>
          <div key={ch.key} className={`py-3 ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium">{ch.label}</div>
                  <div className="text-[13px] text-[#717171]">
                    {/* Not the commission. This section is what a channel
                        puts on top for the guest; commission is what it
                        takes off you, and the two ran in opposite
                        directions under one heading — "15% commission"
                        sat beside a markup field as though it were the
                        same kind of number. What you keep is shown where
                        it belongs, against a real nightly rate. */}
                    {markups[ch.key] && Number(markups[ch.key]) > 0 ?
                `A guest pays ${(1 + Number(markups[ch.key]) / 100).toFixed(3).replace(/0+$/, '')}× your rate` :
                'Adds nothing to your rate'}
                  </div>
                </div>
                <span className="shrink-0 flex items-center gap-1.5">
                  <input
                  type="number" inputMode="numeric"
                  value={markups[ch.key] ?? '0'}
                  onChange={(e) => { setMarkups((m) => ({ ...m, [ch.key]: e.target.value })); setDone(''); }}
                  aria-label={`${ch.label} guest markup`}
                  className="w-[72px] h-[38px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] text-right tabular-nums" />
                  <span className="text-[12px] text-[#717171] w-[14px]">%</span>
                </span>
              </div>

              {/* What the bookings say it has been, when they agree.
                  Three different things were being said with one
                  sentence: a reading, a doubt about it, and no reading
                  at all. A single booking was reported as "too varied",
                  which one observation cannot be — and a negative
                  markup was printed as though it were a measurement
                  rather than proof the rate had moved since. */}
              {observed[ch.key] &&
            <div className="mt-1.5 text-[12px] text-[#717171]">
                  {/* Said plainly, and no longer offered.

                      This read "your last 4 bookings imply +23.9%" on a
                      channel set to 20.5%, with a Use it button beside
                      it. Both of those bookings sold at R2,469 a night,
                      which is R2,048.96 at 20.5% — the rate those nights
                      were listed at. Today they are R2,000. The markup
                      was exactly right and the rate moved underneath it.

                      The ratio divides by what a night costs *now*,
                      because Smoobu keeps one price per date and forgets
                      the last one, so every reprice since a booking bends
                      it. That is not a measurement of a markup and must
                      not be offered as one. */}
                  {observed[ch.key].markup == null ?
                <>Nothing to compare — the rate for those nights has changed since they sold{observed[ch.key].stale ? ` (${observed[ch.key].stale} booking${observed[ch.key].stale === 1 ? '' : 's'} skipped)` : ''}</> :
                <>
                        Your last {observed[ch.key].bookings}{' '}
                        {observed[ch.key].bookings === 1 ? 'booking came to' : 'bookings came to'}
                        {' '}<span className="font-medium text-[#222222]">
                          +{observed[ch.key].markup}%
                        </span>
                        {' '}of what those nights cost today
                        {observed[ch.key].low !== observed[ch.key].high &&
                  <> ({observed[ch.key].low}–{observed[ch.key].high}%)</>}
                        . A rate changed since a booking sold moves this, so it is not the markup.
                      </>
                }
                </div>
            }

            {/* What the channel actually kept, which is a measurement.

                Two numbers on the same booking row — what the guest paid
                and what the channel took out of it — so there is no base
                to go stale. This is the figure the morning check uses,
                and the one worth acting on. */}
            {commissions[ch.key] &&
          <div className="mt-1 text-[12px] text-[#717171]">
                  {ch.label} kept{' '}
                  <span className="font-medium text-[#222222]">{commissions[ch.key].commission}%</span>
                  {' '}on your last {commissions[ch.key].bookings}{' '}
                  {commissions[ch.key].bookings === 1 ? 'booking' : 'bookings'}
                  {commissions[ch.key].low !== commissions[ch.key].high &&
            <> ({commissions[ch.key].low}–{commissions[ch.key].high}%)</>}
                  . Before VAT, so the markup needs to clear more than that.
                </div>
          }
            </div>
          )}
        </div>

        {/* 2b. The two numbers the morning check measures against.

               Here rather than on a settings page because this is the
               screen where somebody is already thinking about what a
               night is worth. A floor set nowhere is a check that
               cannot run, and the loft sold Booking.com nights at R113
               for four months because nothing knew what too cheap
               meant for it. */}
        <div className={SECTION}>Limits</div>
        <div className={`${CARD} p-4 mb-6`}>
          <p className="text-[13px] text-[#717171] mb-3">
            Not prices — tripwires. Every morning this app checks the next year of nights against them, in your rate and
            in what each channel charges the guest, and tells you if anything is outside.
          </p>
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-medium">Never under</div>
              <div className="text-[13px] text-[#717171]">
                {Number(limits.floor) > 0 ?
                'A night below this, on your rate or on any channel, is an alert' :
                'Not set — nothing is being checked'}
              </div>
            </div>
            <span className="shrink-0 flex items-center gap-1.5">
              <span className="text-[12px] text-[#717171]">R</span>
              <input
                type="number" inputMode="numeric" placeholder="none"
                value={limits.floor}
                onChange={(e) => { setLimits((l) => ({ ...l, floor: e.target.value })); setDone(''); }}
                aria-label="Price floor"
                className="w-[92px] h-[38px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] text-right tabular-nums" />
            </span>
          </div>
          <div className="flex items-center gap-3 py-2 border-t border-[#F0F0F0]">
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-medium">Never over</div>
              <div className="text-[13px] text-[#717171]">
                {Number(limits.ceiling) > 0 ?
                'Catches a layer applied twice, or dynamic pricing left behind' :
                'Not set — nothing is being checked'}
              </div>
            </div>
            <span className="shrink-0 flex items-center gap-1.5">
              <span className="text-[12px] text-[#717171]">R</span>
              <input
                type="number" inputMode="numeric" placeholder="none"
                value={limits.ceiling}
                onChange={(e) => { setLimits((l) => ({ ...l, ceiling: e.target.value })); setDone(''); }}
                aria-label="Price ceiling"
                className="w-[92px] h-[38px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] text-right tabular-nums" />
            </span>
          </div>
        </div>

        {/* 3. The rules that read the diary. */}
        <div className={SECTION}>Rules</div>
        <div className="space-y-3 mb-6">
          {catalogue.map((s) => {
            const entry = config[s.key] || { enabled: false, params: {} };
            return (
              <div key={s.key} className={`${CARD} p-4`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium">{s.label}</div>
                    <div className="text-[13px] text-[#717171]">{s.blurb}</div>
                  </div>
                  <button
                    role="switch" aria-checked={entry.enabled}
                    aria-label={`${entry.enabled ? 'Turn off' : 'Turn on'} ${s.label}`}
                    onClick={() => toggle(s.key)}
                    className={`shrink-0 w-[46px] h-[26px] rounded-full transition-colors ${
                    entry.enabled ? 'bg-[#0F6E56]' : 'bg-[#DDDDDD]'}`}>
                    <span className={`block w-[20px] h-[20px] bg-white rounded-full transition-transform ${
                    entry.enabled ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} />
                  </button>
                </div>

                {entry.enabled &&
                <div className="mt-3 pt-3 border-t border-[#F0F0F0] space-y-2">
                    {s.params.map((p) => {
                    const value = entry.params[p.key] ?? p.default;
                    return (
                      <div key={p.key} className="flex items-center gap-3">
                          <label className="flex-1 text-[13px]">{p.label}</label>
                          {p.type === 'bool' ?
                        <button
                          role="switch" aria-checked={Boolean(value)}
                          aria-label={p.label}
                          onClick={() => setParam(s.key, p.key, !value)}
                          className={`shrink-0 w-[40px] h-[22px] rounded-full ${value ? 'bg-[#0F6E56]' : 'bg-[#DDDDDD]'}`}>
                              <span className={`block w-[16px] h-[16px] bg-white rounded-full transition-transform ${
                          value ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
                            </button> :

                        <span className="shrink-0 flex items-center gap-1.5">
                              <input
                            type="number" value={String(value)} min={p.min} max={p.max}
                            aria-label={p.label}
                            onChange={(e) => setParam(s.key, p.key, Number(e.target.value))}
                            className="w-[76px] h-[36px] px-2 border border-[#DDDDDD] rounded-[8px] text-[14px] text-right tabular-nums" />
                              <span className="text-[12px] text-[#717171] w-[46px]">
                                {p.type === 'percent' ? '%' : p.type === 'money' ? 'R' : p.unit || ''}
                              </span>
                            </span>
                        }
                        </div>);

                  })}
                  </div>
                }
              </div>);

          })}
        </div>

        {/* 4. What would change. */}
        <div className={SECTION}>What would change</div>
        <div className={`${CARD} p-4`}>
          <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-[#F0F0F0]">
            <span className="text-[13px] text-[#717171]">Apply from</span>
            <input
              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              aria-label="First night"
              className="px-2 py-1.5 border border-[#DDDDDD] rounded-[8px] text-[13px]" />
            <span className="text-[13px] text-[#717171]">to</span>
            <input
              type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
              aria-label="Last night"
              className="px-2 py-1.5 border border-[#DDDDDD] rounded-[8px] text-[13px]" />
            {previewing && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#B0B0B0]" />}
          </div>

          {/* Whose price these are. Not a filter — it changes what the
              numbers mean, not which nights are listed. */}
          {preview && preview.channels.length > 0 &&
          <div className="flex flex-wrap items-center gap-2 py-3 border-b border-[#F0F0F0]">
              <span className="text-[13px] text-[#717171]">Showing</span>
              {[{ key: 'base', label: 'your rate', markup: 0 }, ...preview.channels.map(
              (c) => ({ key: c.key, label: `what a ${c.label} guest pays`, markup: c.markup })
            )].map((c) =>
            <button
              key={c.key}
              onClick={() => setView(c.key)}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium border ${
              view === c.key ?
              'bg-[#222222] text-white border-[#222222]' :
              'bg-white border-[#DDDDDD] text-[#222222]'}`
              }>
                  {c.label}{c.key !== 'base' && c.markup > 0 && ` +${c.markup}%`}
                </button>
            )}
            </div>
          }

          {error && <p className="mt-3 text-[13px] text-[#991B1B]">{error}</p>}
          {done &&
          <p className="mt-3 text-[13px] text-[#0F6E56] flex items-center gap-1.5">
              <Check className="w-4 h-4" strokeWidth={3} /> {done}
            </p>
          }

          {preview && changing.length === 0 &&
          <p className="mt-3 text-[13px] text-[#717171] flex items-center gap-1.5">
              <Check className="w-4 h-4 text-[#0F6E56]" strokeWidth={3} />
              Nothing would change — those nights already match.
            </p>
          }

          {preview && changing.length > 0 &&
          <>
              <p className="mt-3 mb-2 text-[13px] font-medium">
                {changing.length} night{changing.length === 1 ? '' : 's'} would change
                {' · '}
                <span className="text-[#717171] font-normal">
                  {money(preview.totals.current)} → {money(preview.totals.strategies)} over the range
                </span>
              </p>

              <div className="border border-[#EBEBEB] rounded-[8px] overflow-hidden max-h-[320px] overflow-y-auto">
                {changing.map((r, i) =>
              <div key={r.date} className={i > 0 ? 'border-t border-[#F0F0F0]' : ''}>
                    <button
                  onClick={() => setOpen(open === r.date ? null : r.date)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left">
                      <span className="w-[104px] shrink-0 text-[#717171]">{pretty(r.date)}</span>
                      <span className="flex-1 min-w-0 truncate text-[12px] text-[#717171]">{r.label}</span>
                      <span className="text-[#717171] tabular-nums">{money(shownPrice(r, 'current'))}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0" />
                      <span className="font-semibold tabular-nums">{money(shownPrice(r, 'new'))}</span>
                      {r.new_min_stay &&
                  <span className="text-[12px] text-[#717171] shrink-0">· min {r.new_min_stay}</span>
                  }
                    </button>

                    {/* Why, when a rule moved it. */}
                    {open === r.date &&
                <div className="px-3 pb-2 bg-[#FAFAFA]">
                        {r.trail.map((step, n) =>
                  <div key={n} className="flex items-baseline gap-2 text-[12px] py-0.5">
                            <span className="font-medium">{step.label}</span>
                            <span className="text-[#717171] flex-1">{step.why}</span>
                            <span className="tabular-nums text-[#717171]">
                              {step.price != null ? money(step.price) :
                    step.change != null ? `${step.change > 0 ? '+' : ''}${step.change}%` : ''}
                            </span>
                          </div>
                  )}
                        {view !== 'base' &&
                  <div className="flex items-baseline gap-2 text-[12px] py-0.5 border-t border-[#EBEBEB] mt-1 pt-1">
                            <span className="font-medium flex-1">You keep</span>
                            <span className="tabular-nums">{money(r.views?.channels?.[view]?.net)}</span>
                          </div>
                  }
                      </div>
                }
                  </div>
              )}
              </div>
            </>
          }

          <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-[#F0F0F0]">
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[12px] text-[#717171] flex-1 min-w-[200px]">
              Applying saves these settings and sends the new rates to Smoobu, which passes them to your channels.
            </span>
            <button
              onClick={save}
              disabled={busy !== '' || !propertyId}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#DDDDDD] text-[13px] font-semibold disabled:opacity-50">
              <Save className="w-4 h-4" /> {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={apply}
              disabled={busy !== '' || changing.length === 0}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-40">
              <Send className="w-4 h-4" />
              {busy === 'apply' ? 'Sending…' : `Apply to ${changing.length}`}
            </button>
          </div>
        </div>

        {preview && preview.occupancy != null &&
        <p className="mt-2 mb-6 text-[12px] text-[#717171]">
            {Math.round(preview.occupancy * 100)}% of this range is already booked. Booked nights are never repriced.
          </p>
        }
      </div>
    </div>);

}
