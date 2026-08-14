import React, { useEffect, useState } from 'react';
import { Wrench, MessageSquare, ShoppingCart, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';

/**
 * Everything the cleaners have told you.
 *
 * There was nowhere to read it. `/api/maintenance` has had list, resolve
 * and delete since it was written and nothing in this app ever called
 * them — reported things surfaced only as at most five rows in "Needs
 * you" on Home, open ones only, behind a View button that did nothing.
 * So a sixth report was invisible, a resolved one left no trace, and the
 * one affordance was a no-op.
 *
 * ## Why the three kinds sit in one list
 *
 * The cleaner's app asks them to choose: Broken, Supplies, Anything. That
 * choice is a routing decision the app needs — supplies go on a shopping
 * list, faults go in the maintenance table — and it is of no interest to
 * the person reading. They asked one question, "what has Moreblessing
 * told me", and three lists is three places to ask it.
 *
 * They are still labelled, because a broken geyser and a request for bin
 * liners want different reactions. Labelled, not separated.
 *
 * ## Done is kept
 *
 * The point of the page is that nothing said out loud disappears. A
 * resolved fault and a bought item move to Done rather than vanishing,
 * because "did anybody deal with that" is the second question people ask
 * here and the old screen could not answer it at all.
 */

type Kind = 'broken' | 'note' | 'supply';

interface Report {
  key: string;
  id: number;
  kind: Kind;
  open: boolean;
  title: string;
  detail: string;
  property: string;
  who: string | null;
  /** YYYY-MM-DD, for sorting and for saying when. */
  date: string;
}

interface Issue {
  id: number;property_id: number;property_name: string;title: string;
  description: string;category: string;status: string;
  reported_date: string;assigned_to: string | null;
}

interface Supply {
  id: number;property: string;item_name: string;quantity: number;unit: string;
  notes: string;status: string;created_at: string;added_by_name: string | null;
}

/** A timestamp or a date string, as YYYY-MM-DD. */
const day = (v: string) => String(v || '').slice(0, 10);

const pretty = (d: string) => {
  if (!d) return '';
  const parsed = new Date(`${d}T00:00:00`);
  if (isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
};

const LOOK: Record<Kind, {Icon: any;label: string;tint: string}> = {
  broken: { Icon: Wrench, label: 'Broken', tint: 'bg-[#E8913A1A] text-[#E8913A]' },
  note: { Icon: MessageSquare, label: 'Note', tint: 'bg-[#6B7B8D1A] text-[#6B7B8D]' },
  supply: { Icon: ShoppingCart, label: 'Supplies', tint: 'bg-[#00A6991A] text-[#00A699]' },
};

export function ReportedPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      // Two tables, because they are genuinely two things — but one
      // request each and one list out, so the page cannot show a fault
      // and a supply as of different moments.
      const [issues, supplies] = await Promise.all([
        apiGet<Issue[]>('/api/maintenance'),
        apiGet<Supply[]>('/api/supplies'),
      ]);

      const fromIssues: Report[] = (issues || []).map((i) => ({
        key: `issue:${i.id}`,
        id: i.id,
        // The cleaner's "Anything" tab rides the maintenance route with
        // its own category, so this is the only thing telling a note
        // apart from a fault.
        kind: i.category === 'Note from cleaner' ? 'note' : 'broken',
        open: i.status !== 'resolved',
        title: i.title,
        detail: i.description || '',
        property: i.property_name,
        who: i.assigned_to || null,
        date: day(i.reported_date),
      }));

      const fromSupplies: Report[] = (supplies || []).map((s) => ({
        key: `supply:${s.id}`,
        id: s.id,
        kind: 'supply',
        open: s.status !== 'purchased',
        title: s.item_name,
        detail: [
          Number(s.quantity) > 1 ? `${Number(s.quantity)} ${s.unit || ''}`.trim() : '',
          s.notes,
        ].filter(Boolean).join(' · '),
        property: s.property,
        who: s.added_by_name,
        date: day(s.created_at),
      }));

      setReports(
        [...fromIssues, ...fromSupplies].sort((a, b) => b.date.localeCompare(a.date))
      );
      setFailed(false);
    } catch (e) {
      // A 401 has already sent us back to the sign-in screen. Anything
      // else means we do not know what has been reported, which is not
      // the same as nothing having been.
      if (!(e instanceof Unauthorized)) setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /**
   * Deal with it — resolve a fault, tick off an item.
   *
   * Both end the same way: the row moves to Done and stays readable
   * there. Neither deletes anything.
   */
  const settle = async (r: Report) => {
    setBusy(r.key);
    setError('');
    const url = r.kind === 'supply' ?
    `/api/supplies/${r.id}/purchased` :
    `/api/maintenance/${r.id}/resolve`;
    const res = await fetch(url, { method: 'PATCH', credentials: 'same-origin' });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not update that');
      return;
    }
    load();
  };

  const open = reports.filter((r) => r.open);
  const done = reports.filter((r) => !r.open);
  const shown = showDone ? done : open;

  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      <div className="lg:max-w-[860px]">

        {/* Open first, because that is what the page is for. Done is one
            tap away rather than below it — a list you scroll past to
            reach the live ones is a list that grows into a wall. */}
        <div className="flex gap-2 mb-4">
          {([[false, 'Open', open.length], [true, 'Done', done.length]] as const).map(
            ([isDone, label, count]) =>
            <button
              key={label}
              onClick={() => setShowDone(isDone)}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium border ${
              showDone === isDone ?
              'bg-[#222222] text-white border-[#222222]' :
              'bg-white border-[#DDDDDD] text-[#222222]'}`
              }>
              {label} {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          )}
        </div>

        {error && <p className="mb-2 text-[13px] text-[#991B1B]">{error}</p>}

        {failed ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] text-[#222222] flex-1">Could not load what has been reported.</span>
            <button
            onClick={() => load()}
            className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-[#FF385C]">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div> :

        loading ?
        <p className="text-[14px] text-[#717171]">Loading…</p> :

        shown.length === 0 ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F6E56]" />
            <span className="text-[14px] text-[#222222]">
              {showDone ? 'Nothing has been dealt with yet.' : 'Nothing outstanding.'}
            </span>
          </div> :

        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {shown.map((r, idx) => {
            const { Icon, label, tint } = LOOK[r.kind];
            return (
              <div
                key={r.key}
                className={`flex items-start gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${tint}`}>
                    <Icon className="w-[14px] h-[14px]" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium text-[#222222]">{r.title}</div>
                    <div className="text-[13px] text-[#717171]">
                      {[label, r.property, r.who, pretty(r.date)].filter(Boolean).join(' · ')}
                    </div>
                    {/* The detail in full. It is usually the only place
                        the actual request lives — three items typed into
                        one description — so truncating it would hide the
                        thing the row is about. */}
                    {r.detail &&
                  <div className="text-[13px] text-[#222222] mt-1 whitespace-pre-line">{r.detail}</div>
                  }
                  </div>
                  {r.open &&
                <button
                  disabled={busy === r.key}
                  onClick={() => settle(r)}
                  className="shrink-0 text-[13px] font-semibold text-[#FF385C] disabled:opacity-50">
                    {busy === r.key ? 'Saving…' : r.kind === 'supply' ? 'Bought' : 'Resolve'}
                  </button>
                }
                </div>);

          })}
          </div>
        }
      </div>
    </div>);

}
