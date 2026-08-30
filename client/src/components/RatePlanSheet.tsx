import React, { useEffect, useState } from 'react';
import { X, Check, AlertCircle, ArrowRight } from 'lucide-react';

/**
 * What each kind of night is worth.
 *
 * Five categories, most specific first. A night gets exactly one, and
 * the order is fixed rather than a matter of which rule ran last — the
 * engine this replaces applied its rules in sequence and let each
 * overwrite the previous, so a Friday close to today came out discounted
 * and the weekend uplift silently disappeared.
 *
 * Nothing is sent until it has been shown. You set the numbers, pick a
 * stretch of dates, and see every night that would move — old price to
 * new — before pressing anything. That engine ran every morning against
 * a figure nobody could see; the only thing that kept it from repricing
 * two listings to R80 a night was an unrelated bug in the API call.
 */

interface Rule {price: string;min_stay: string;}
interface Row {
  date: string;category: string;label: string;
  current_price: number | null;new_price: number;
  current_min_stay: number | null;new_min_stay: number | null;
  changes: boolean;
}

const ORDER = ['long_weekend', 'public_holiday', 'school_holiday', 'weekend', 'weekday'];

const EXPLAIN: Record<string, string> = {
  long_weekend: 'A public holiday next to a weekend — three nights, or four when the day between gets bridged',
  public_holiday: 'A public holiday in the middle of the week',
  school_holiday: 'Inside a school term in the markets these guests come from',
  weekend: 'Friday and Saturday',
  weekday: 'Everything else',
};

const money = (n: number | null) => n == null ? '—' : `R ${n.toLocaleString('en-ZA')}`;
const pretty = (d: string) =>
new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });

export function RatePlanSheet({
  propertyId, propertyName, onClose, onApplied,
}: {
  propertyId: number;
  propertyName: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [plan, setPlan] = useState<Record<string, Rule>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/properties/${propertyId}/rate-plan`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const d = await res.json();
      const next: Record<string, Rule> = {};
      for (const c of ORDER) {
        next[c] = {
          price: d.plan[c] ? String(Math.round(d.plan[c].price)) : '',
          min_stay: d.plan[c] && d.plan[c].min_stay ? String(d.plan[c].min_stay) : '',
        };
      }
      setPlan(next);
      setLabels(d.labels || {});
    })();
  }, [propertyId]);

  const set = (c: string, field: keyof Rule, v: string) => {
    setPlan((p) => ({ ...p, [c]: { ...p[c], [field]: v } }));
    // The preview belongs to the numbers it was made from.
    setRows(null);
    setDone('');
  };

  const save = async () => {
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/rate-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not save that plan');
      return false;
    }
    return true;
  };

  const preview = async () => {
    setBusy('preview');
    setError('');
    setDone('');
    if (!(await save())) return setBusy('');
    const res = await fetch(`/api/properties/${propertyId}/rate-plan/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ from, to }),
    });
    setBusy('');
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not work out the changes');
      return;
    }
    setRows((await res.json()).rows || []);
  };

  const apply = async () => {
    setBusy('apply');
    setError('');
    const res = await fetch(`/api/properties/${propertyId}/rate-plan/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ from, to }),
    });
    setBusy('');
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(out.error || 'Could not send those to Smoobu');
      return;
    }
    setDone(`${out.applied} night${out.applied === 1 ? '' : 's'} sent to Smoobu`);
    setRows(null);
    onApplied();
  };

  const changing = rows ? rows.filter((r) => r.changes) : [];

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[70] bg-white rounded-t-[16px] shadow-2xl p-5 pb-8
                      max-h-[90vh] overflow-y-auto
                      sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                      sm:w-[620px] sm:rounded-2xl sm:pb-5 sm:max-h-[86vh]">

        <div className="flex justify-between items-start mb-1">
          <div>
            <p className="text-[18px] font-semibold">What a night is worth</p>
            <p className="text-[13px] text-[#717171]">{propertyName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1">
            <X className="w-5 h-5 text-[#717171]" />
          </button>
        </div>

        <p className="text-[13px] text-[#717171] mt-2 mb-3">
          A night gets one of these — the most specific that fits. Leave a rate blank
          and those nights are left alone.
        </p>

        <div className="space-y-2">
          {ORDER.map((c) =>
          <div key={c} className="flex items-start gap-2">
              <div className="flex-1 min-w-0 pt-1.5">
                <div className="text-[14px] font-medium text-[#222222]">{labels[c] || c}</div>
                <div className="text-[12px] text-[#717171] leading-snug">{EXPLAIN[c]}</div>
              </div>
              <input
              type="number"
              inputMode="numeric"
              placeholder="rate"
              value={plan[c]?.price ?? ''}
              onChange={(e) => set(c, 'price', e.target.value)}
              aria-label={`${labels[c] || c} rate`}
              className="w-24 shrink-0 px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px] tabular-nums" />
              <input
              type="number"
              inputMode="numeric"
              placeholder="min"
              value={plan[c]?.min_stay ?? ''}
              onChange={(e) => set(c, 'min_stay', e.target.value)}
              aria-label={`${labels[c] || c} minimum nights`}
              className="w-16 shrink-0 px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px] tabular-nums" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-[#F0F0F0]">
          <span className="text-[13px] text-[#717171]">Apply from</span>
          <input
            type="date"
            value={from}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => { setFrom(e.target.value); setRows(null); }}
            aria-label="First night"
            className="px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px]" />
          <span className="text-[13px] text-[#717171]">to</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => { setTo(e.target.value); setRows(null); }}
            aria-label="Last night"
            className="px-2 py-1.5 border border-[#DDDDDD] rounded-[6px] text-[13px]" />
          <button
            disabled={busy !== ''}
            onClick={preview}
            className="px-3 py-1.5 rounded-[8px] border border-[#DDDDDD] text-[13px] font-semibold disabled:opacity-50">
            {busy === 'preview' ? 'Working…' : 'Show me'}
          </button>
        </div>

        {error && <p className="mt-2 text-[13px] text-[#991B1B]">{error}</p>}
        {done &&
        <p className="mt-2 text-[13px] text-[#0F6E56] flex items-center gap-1.5">
            <Check className="w-4 h-4" strokeWidth={3} /> {done}
          </p>
        }

        {/* Nothing is sent until this has been read. */}
        {rows &&
        <div className="mt-4">
            {changing.length === 0 ?
          <p className="text-[13px] text-[#717171] flex items-center gap-1.5">
                <Check className="w-4 h-4 text-[#0F6E56]" strokeWidth={3} />
                Nothing would change — those nights already match the plan.
              </p> :

          <>
                <p className="text-[13px] font-medium text-[#222222] mb-2">
                  {changing.length} night{changing.length === 1 ? '' : 's'} would change
                </p>
                <div className="border border-[#EBEBEB] rounded-[8px] overflow-hidden max-h-[240px] overflow-y-auto">
                  {changing.map((r, i) =>
              <div key={r.date} className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${i > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                      <span className="w-[110px] shrink-0 text-[#717171]">{pretty(r.date)}</span>
                      <span className="flex-1 min-w-0 truncate text-[12px] text-[#717171]">{r.label}</span>
                      <span className="text-[#717171] tabular-nums">{money(r.current_price)}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#B0B0B0] shrink-0" />
                      <span className="font-semibold tabular-nums">{money(r.new_price)}</span>
                      {r.new_min_stay &&
                <span className="text-[12px] text-[#717171] shrink-0">· min {r.new_min_stay}</span>
                }
                    </div>
              )}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
                  <span className="text-[12px] text-[#717171] flex-1">
                    This sends the new rates to Smoobu, which passes them to your channels.
                  </span>
                  <button
                disabled={busy !== ''}
                onClick={apply}
                className="shrink-0 px-3 py-1.5 rounded-[8px] bg-[#222222] text-white text-[13px] font-semibold disabled:opacity-50">
                    {busy === 'apply' ? 'Sending…' : `Apply to ${changing.length}`}
                  </button>
                </div>
              </>
          }
          </div>
        }
      </div>
    </>);

}
