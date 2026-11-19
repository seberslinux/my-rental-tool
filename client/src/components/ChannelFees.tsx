import React, { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../data/session';

/**
 * What each channel keeps, per property — the one table every fee in the
 * app comes from. Commission, VAT on commission and bank charges, as a
 * percentage of what the guest pays, entered from the channel's invoices;
 * total fees is their sum, and total markup = 1 / (1 − total fees) − 1 is
 * what Smoobu must add to the base for the payout to be the base again.
 * Beside it, the markup Smoobu adds today and what that pays out.
 */

interface Row {
  channel: string; label: string;
  commission: number | null; vat_on_commission: number | null; bank_charges: number | null;
  total_fees: number | null; total_markup: number | null; smoobu_markup: number; payout: number | null; vat_rate: number;
}

const CARD = 'bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)]';
const SECTION = 'text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2';
const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100) / 100}%`);
const FIELDS: [keyof Row, string][] = [['commission', 'Commission'], ['bank_charges', 'Bank charges']];

export function ChannelFees({ propertyId }: { propertyId: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    apiGet<{ channels: Row[] }>(`/api/properties/${propertyId}/channel-fees`).then((d) => {
      setRows(d.channels);
      setDraft(Object.fromEntries(d.channels.map((r) => [r.channel,
        Object.fromEntries(FIELDS.map(([k]) => [k, r[k] == null ? '' : String(r[k])]))])));
    }).catch(() => setNote('Could not load the fees.'));
  }, [propertyId]);
  useEffect(() => { setNote(''); load(); }, [load]);

  if (!rows) return note ? <p className="text-[13px] text-[#C13515] mb-6">{note}</p> : null;

  const filled = (ch: string) => FIELDS.some(([k]) => (draft[ch]?.[k] ?? '') !== '');
  const vatRate = rows[0]?.vat_rate ?? 15;
  const live = (ch: string) => {
    const d = draft[ch] || {};
    const commission = Number(d.commission) || 0;
    const vat = commission * vatRate / 100;
    const total = commission + vat + (Number(d.bank_charges) || 0);
    return { vat, total, markup: total < 100 ? (1 / (1 - total / 100) - 1) * 100 : null };
  };
  const save = async () => {
    setNote('');
    const channels = rows.filter((r) => filled(r.channel)).map((r) => ({
      channel: r.channel, ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(draft[r.channel][k]) || 0])),
    }));
    const res = await fetch(`/api/properties/${propertyId}/channel-fees`, {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setNote(body.error || 'Could not save.'); return; }
    setNote('Saved. Net revenue now uses these fees.');
    load();
  };

  return (
    <div className="mb-8">
      <div className={SECTION}>Channel fees</div>
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[12px] text-[#717171] align-bottom">
              <th className="font-medium px-3 py-2 text-left">Channel</th>
              <th className="font-medium px-2 py-2 text-right whitespace-nowrap">Commission</th>
              <th className="font-medium px-2 py-2 text-right whitespace-nowrap">VAT on commission ({vatRate}%)</th>
              <th className="font-medium px-2 py-2 text-right whitespace-nowrap">Bank charges</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Total fees</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Total markup</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap border-l border-[#F0F0F0]">Smoobu markup</th>
              <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Paid per R1 000</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = live(r.channel);
              const short = filled(r.channel) && l.markup != null && r.smoobu_markup < l.markup - 0.005;
              const payout = filled(r.channel) ? (1 + r.smoobu_markup / 100) * (1 - l.total / 100) : null;
              return (
                <tr key={r.channel} className="border-t border-[#F0F0F0]">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.label}</td>
                  {(['commission', 'vat', 'bank_charges'] as const).map((k) => k === 'vat' ?
                  <td key={k} className="px-2 py-2 text-right tabular-nums text-[#717171]">{filled(r.channel) ? pct(l.vat) : '–'}</td> :
                  <td key={k} className="px-2 py-1.5 text-right">
                      <input
                      type="number" inputMode="decimal" step="0.01" placeholder="–"
                      aria-label={`${r.label} ${k === 'commission' ? 'Commission' : 'Bank charges'}`}
                      value={draft[r.channel]?.[k] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [r.channel]: { ...draft[r.channel], [k]: e.target.value } })}
                      className="w-[70px] h-[32px] px-1.5 border border-[#DDDDDD] rounded-[6px] text-right tabular-nums" />
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{filled(r.channel) ? pct(l.total) : '–'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{filled(r.channel) ? pct(l.markup) : '–'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums border-l border-[#F0F0F0] ${short ? 'text-[#C13515] font-semibold' : ''}`}>{pct(r.smoobu_markup)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${payout != null && payout < 1 ? 'text-[#C13515] font-semibold' : ''}`}>{payout == null ? '–' : `R${Math.round(payout * 1000)}`}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button onClick={save} className="px-4 h-[36px] rounded-[8px] bg-[#222222] text-white text-[14px] font-semibold">Save fees</button>
        <span className="text-[13px] text-[#717171]">{note}</span>
      </div>
      <p className="text-[12px] text-[#B0B0B0] mt-1.5">
        Each as a % of what the guest pays, from the channel's invoices; VAT on commission is {vatRate}% of the commission. Total markup = 1 ÷ (1 − total fees) − 1: the least
        Smoobu must add to your rate for the payout to be your rate. Red: the Smoobu markup is below it. Discounts such as
        Genius are not fees and are not in this table.
      </p>
    </div>);
}
