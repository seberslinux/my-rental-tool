import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, RefreshCw, Send, Save } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';

/**
 * Trying pricing algorithms, and seeing what they would do.
 *
 * The rate plan says what a night is worth by what kind of night it is —
 * a weekend, a school break, a long weekend. That is a statement about
 * the calendar, and the calendar does not know whether anybody has
 * booked. This is where the rules that read the diary get switched on:
 * small gaps between bookings, nights still empty as they approach, a
 * month selling slower than it should.
 *
 * ## Nothing is sent until it has been seen
 *
 * Every change here re-previews against the real diary and shows what it
 * would do — night by night, and as a total. The settings are not even
 * saved until you say so: the preview endpoint takes the configuration
 * being tried rather than reading the stored one, which is what makes it
 * safe to turn something up to 40%, look, and put it back.
 *
 * The engine two versions ago ran every morning against numbers nobody
 * could see. The only thing that stopped it repricing two listings to
 * R80 a night was an unrelated bug in the API call.
 *
 * ## Why each night can explain itself
 *
 * A price nobody can account for is a price nobody will send. Every row
 * carries the trail that produced it — what the plan said, what each
 * rule did to it, and what came out — because the question people
 * actually ask of a screen like this is not "what is the number" but
 * "why is it that".
 */

interface Param {
  key: string;
  label: string;
  type: 'int' | 'percent' | 'bool' | 'money';
  unit?: string;
  default: number | boolean;
  min: number;
  max: number;
}

interface Strategy {key: string;label: string;blurb: string;params: Param[];}
interface Entry {enabled: boolean;params: Record<string, any>;}

interface TrailStep {label: string;price?: number;change?: number;why: string;}

interface ChannelView {label: string;markup: number;guest: number;net: number;}
interface Views {base: number;channels: Record<string, ChannelView>;}

interface Row {
  date: string;label: string;
  plan_price: number;new_price: number;current_price: number | null;
  new_min_stay: number | null;current_min_stay: number | null;
  changes: boolean;
  trail: TrailStep[];
  views: Views;
}

interface Channel {key: string;label: string;markup: number;commission: number;}

interface Preview {
  nights: number;changing: number;occupancy: number | null;
  totals: {current: number;plan: number;strategies: number;};
  channels: Channel[];
  rows: Row[];
}

const money = (n: number | null | undefined) =>
n == null ? '—' : `R ${Math.round(n).toLocaleString('en-ZA')}`;

const pretty = (d: string) =>
new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function RatesPage() {
  const [properties, setProperties] = useState<{id: number;name: string;}[]>([]);
  const [propertyId, setPropertyId] = useState<number>(0);
  const [catalogue, setCatalogue] = useState<Strategy[]>([]);
  const [config, setConfig] = useState<Record<string, Entry>>({});
  const [plan, setPlan] = useState<Record<string, {price: number;min_stay: number | null;}>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});

  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date(Date.now() + 90 * 86400000)));

  /**
   * Whose price we are looking at.
   *
   * 'base' is what you set and what gets sent; a channel key shows what
   * a guest on that channel is charged instead. Only ever a way of
   * looking — the number pushed to Smoobu is the base rate whichever of
   * these is selected, or the markup would be applied twice.
   */
  const [view, setView] = useState<string>('base');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [failed, setFailed] = useState(false);

  // Which properties, and which one we are pricing.
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

  // The catalogue and this property's saved settings, together.
  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        const [s, p] = await Promise.all([
          apiGet<{catalogue: Strategy[];config: Record<string, Entry>;}>(
            `/api/properties/${propertyId}/rate-strategies`),
          apiGet<{plan: Record<string, any>;labels: Record<string, string>;}>(
            `/api/properties/${propertyId}/rate-plan`),
        ]);
        setCatalogue(s.catalogue || []);
        setConfig(s.config || {});
        setPlan(p.plan || {});
        setLabels(p.labels || {});
        setDone('');
        setFailed(false);
      } catch (e) {
        if (!(e instanceof Unauthorized)) setFailed(true);
      }
    })();
  }, [propertyId]);

  /**
   * Re-price on every change, against what is on screen.
   *
   * Debounced, because dragging a number from 25 to 40 is a dozen
   * keystrokes and a dozen previews would show the answer to the number
   * you were passing through rather than the one you stopped on.
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
          body: JSON.stringify({ from, to, strategies: config }),
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
  }, [propertyId, from, to, config]);

  useEffect(() => { runPreview(); return () => clearTimeout(timer.current); }, [runPreview]);

  const setParam = (key: string, param: string, value: any) => {
    setConfig((c) => ({
      ...c,
      [key]: { enabled: c[key]?.enabled ?? false, params: { ...(c[key]?.params || {}), [param]: value } },
    }));
    setDone('');
  };

  const toggle = (key: string) => {
    setConfig((c) => ({
      ...c,
      [key]: { enabled: !(c[key]?.enabled), params: c[key]?.params || {} },
    }));
    setDone('');
  };

  const save = async () => {
    setBusy('save');
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/rate-strategies`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ config }),
    });
    setBusy('');
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not save that');
      return;
    }
    setDone('Saved. These are this property’s settings from now on.');
  };

  /**
   * Send it.
   *
   * The same configuration the preview used goes with it, so what is
   * sent is the list on the screen rather than whatever happens to be
   * saved — somebody who has changed a number and not pressed Save is
   * looking at the thing they mean to apply.
   */
  const apply = async () => {
    if (!preview || preview.changing === 0) return;
    setBusy('apply');
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/rate-plan/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ from, to, strategies: config }),
    });
    setBusy('');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Could not send those rates');
      return;
    }
    setDone(`Sent ${body.applied ?? preview.changing} night${(body.applied ?? preview.changing) === 1 ? '' : 's'} to Smoobu.`);
    runPreview();
  };

  const delta = preview ? preview.totals.strategies - preview.totals.plan : 0;

  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      <div className="lg:max-w-[860px]">

        {failed &&
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] flex-1">Could not load your rates.</span>
          </div>
        }

        {/* What we are pricing, and over what. */}
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-4 mb-4">
          {properties.length > 1 &&
          <select
            value={propertyId || ''}
            onChange={(e) => { setPropertyId(Number(e.target.value)); setPreview(null); }}
            className="w-full h-[44px] px-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px]">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          }
          <div className="flex items-center gap-2">
            <input
              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="flex-1 h-[44px] px-3 border border-[#DDDDDD] rounded-[8px] text-[14px]" />
            <span className="text-[13px] text-[#717171]">to</span>
            <input
              type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="flex-1 h-[44px] px-3 border border-[#DDDDDD] rounded-[8px] text-[14px]" />
          </div>

          {/* The base these rules move. Read-only here: it is set on the
              property itself, and two editors for one number is how they
              come to disagree. */}
          {Object.keys(plan).length > 0 ?
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(plan).map(([cat, rule]) =>
            <span key={cat} className="text-[12px] text-[#717171]">
                  {labels[cat] || cat} <span className="text-[#222222] font-medium tabular-nums">{money(rule.price)}</span>
                </span>
            )}
            </div> :
          <p className="mt-3 text-[13px] text-[#92400E]">
              No rate plan set for this property yet — set one on Properties first, or these rules have nothing to work on.
            </p>
          }
        </div>

        {/* What the rules would do, in money. The reason to look at this
            page at all. */}
        {preview &&
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-4 mb-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[20px] font-semibold tabular-nums leading-tight">{money(preview.totals.plan)}</div>
                <div className="text-[12px] text-[#717171] leading-snug">the plan alone</div>
              </div>
              <div>
                <div className={`text-[20px] font-semibold tabular-nums leading-tight ${
                delta < 0 ? 'text-[#D93900]' : delta > 0 ? 'text-[#0F6E56]' : ''}`}>
                  {money(preview.totals.strategies)}
                </div>
                <div className="text-[12px] text-[#717171] leading-snug">
                  {/* The sign in front of the R, not inside it — money()
                      renders a negative as "R -1,100", which reads as a
                      currency nobody uses. */}
                  with these rules{delta !== 0 && <> · {delta > 0 ? '+' : '−'}{money(Math.abs(delta))}</>}
                </div>
              </div>
              <div>
                <div className="text-[20px] font-semibold tabular-nums leading-tight">{preview.changing}</div>
                <div className="text-[12px] text-[#717171] leading-snug">
                  of {preview.nights} nights move
                </div>
              </div>
            </div>

            {/* The same window as the guest sees it, and as it lands.
                Summed from the rows rather than recomputed, so it cannot
                disagree with the list underneath. */}
            {view !== 'base' &&
          <div className="mt-3 pt-3 border-t border-[#F0F0F0] flex gap-6">
                <div>
                  <div className="text-[16px] font-semibold tabular-nums leading-tight">
                    {money(preview.rows.reduce((n, r) => n + (r.views?.channels?.[view]?.guest || 0), 0))}
                  </div>
                  <div className="text-[12px] text-[#717171]">guests pay</div>
                </div>
                <div>
                  <div className="text-[16px] font-semibold tabular-nums leading-tight">
                    {money(preview.rows.reduce((n, r) => n + (r.views?.channels?.[view]?.net || 0), 0))}
                  </div>
                  <div className="text-[12px] text-[#717171]">you keep</div>
                </div>
              </div>
          }
            {preview.occupancy != null &&
          <p className="mt-2 text-[12px] text-[#717171]">
                {Math.round(preview.occupancy * 100)}% of this window is already booked.
              </p>
          }
          </div>
        }

        {/* Whose number this is.
            A guest comparing your flat with the one next door is
            comparing what they are charged, not what you are paid — so
            pricing against the market means looking at the middle
            column, while the number you type is the first. */}
        {preview && preview.channels && preview.channels.length > 0 &&
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {[{ key: 'base', label: 'Your rate', markup: 0 }, ...preview.channels].map((c) =>
          <button
            key={c.key}
            onClick={() => setView(c.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium border ${
            view === c.key ?
            'bg-[#222222] text-white border-[#222222]' :
            'bg-white border-[#DDDDDD] text-[#222222]'}`
            }>
                {c.label}
                {c.key !== 'base' && c.markup > 0 && <span className="opacity-70"> +{c.markup}%</span>}
              </button>
          )}
          </div>
        }

        {view !== 'base' &&
        <p className="mb-3 text-[12px] text-[#717171]">
            What a guest on {(preview?.channels.find((c) => c.key === view) || {}).label} is charged.
            The rate sent to Smoobu is still your own.
          </p>
        }

        {error && <p className="mb-3 text-[13px] text-[#991B1B]">{error}</p>}
        {done && <p className="mb-3 text-[13px] text-[#0F6E56]">{done}</p>}

        {/* The algorithms. Rendered from the catalogue the server sends,
            so a new one appears here by existing. */}
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Algorithms
        </div>
        <div className="space-y-3 mb-4">
          {catalogue.map((s) => {
            const entry = config[s.key] || { enabled: false, params: {} };
            return (
              <div key={s.key} className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium">{s.label}</div>
                    <div className="text-[13px] text-[#717171]">{s.blurb}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={entry.enabled}
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
                          <label className="flex-1 text-[13px] text-[#222222]">{p.label}</label>
                          {p.type === 'bool' ?
                        <button
                          role="switch"
                          aria-checked={Boolean(value)}
                          onClick={() => setParam(s.key, p.key, !value)}
                          className={`shrink-0 w-[40px] h-[22px] rounded-full ${
                          value ? 'bg-[#0F6E56]' : 'bg-[#DDDDDD]'}`}>
                              <span className={`block w-[16px] h-[16px] bg-white rounded-full transition-transform ${
                          value ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
                            </button> :

                        <span className="shrink-0 flex items-center gap-1.5">
                              <input
                            type="number"
                            value={String(value)}
                            min={p.min} max={p.max}
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

        <div className="flex gap-2 mb-6">
          <button
            onClick={save}
            disabled={busy !== '' || !propertyId}
            className="flex-1 h-[44px] flex items-center justify-center gap-1.5 rounded-[8px] border border-[#DDDDDD] bg-white text-[14px] font-semibold disabled:opacity-50">
            <Save className="w-4 h-4" /> {busy === 'save' ? 'Saving…' : 'Save these settings'}
          </button>
          <button
            onClick={apply}
            disabled={busy !== '' || !preview || preview.changing === 0}
            className="flex-1 h-[44px] flex items-center justify-center gap-1.5 rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold disabled:opacity-40">
            <Send className="w-4 h-4" />
            {busy === 'apply' ? 'Sending…' : `Send ${preview ? preview.changing : 0} to Smoobu`}
          </button>
        </div>

        {/* Night by night, each able to account for itself. */}
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2 flex items-center gap-2">
          Every night
          {previewing && <RefreshCw className="w-3 h-3 animate-spin text-[#B0B0B0]" />}
        </div>
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
          {!preview || preview.rows.length === 0 ?
          <div className="px-4 py-3 flex items-center gap-2">
              <Check className="w-4 h-4 text-[#0F6E56]" />
              <span className="text-[14px] text-[#717171]">
                {preview ? 'Nothing to price in this range.' : 'Pricing…'}
              </span>
            </div> :

          preview.rows.map((r, idx) =>
          <div key={r.date} className={idx > 0 ? 'border-t border-[#F0F0F0]' : ''}>
                <button
              onClick={() => setOpen(open === r.date ? null : r.date)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium">{pretty(r.date)}</div>
                    <div className="text-[12px] text-[#717171] truncate">
                      {r.label}
                      {r.new_min_stay ? ` · min ${r.new_min_stay} night${r.new_min_stay === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                  {/* In whichever currency of meaning is selected. The
                      struck-through figure stays the plan's, in the same
                      view, so the comparison is like for like. */}
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-medium tabular-nums">
                      {view === 'base' ?
                    money(r.new_price) :
                    money(r.views?.channels?.[view]?.guest)}
                    </div>
                    {view === 'base' ?
                  r.new_price !== r.plan_price &&
                  <div className="text-[12px] text-[#717171] tabular-nums line-through">{money(r.plan_price)}</div> :

                  <div className="text-[12px] text-[#717171] tabular-nums">
                        you keep {money(r.views?.channels?.[view]?.net)}
                      </div>
                  }
                  </div>
                </button>

                {open === r.date &&
            <div className="px-4 pb-3 -mt-1">
                    {r.trail.map((step, i) =>
              <div key={i} className="flex items-baseline gap-2 text-[12px]">
                        <span className="text-[#222222] font-medium">{step.label}</span>
                        <span className="text-[#717171] flex-1">{step.why}</span>
                        <span className="tabular-nums text-[#717171]">
                          {step.price != null ? money(step.price) :
                  step.change != null ? `${step.change > 0 ? '+' : ''}${step.change}%` : ''}
                        </span>
                      </div>
              )}
                    <div className="flex items-baseline gap-2 text-[12px] mt-1 pt-1 border-t border-[#F0F0F0]">
                      <span className="font-medium flex-1">Comes to</span>
                      <span className="tabular-nums font-medium">{money(r.new_price)}</span>
                    </div>
                  </div>
            }
              </div>
          )}
        </div>
      </div>
    </div>);

}
