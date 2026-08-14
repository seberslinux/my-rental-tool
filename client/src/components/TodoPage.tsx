import React, { useEffect, useState } from 'react';
import { Wrench, MessageSquare, ShoppingCart, Check, AlertCircle, RefreshCw, Plus, X, Share2 } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';

/**
 * The list of things to do.
 *
 * There was nowhere to read any of it. `/api/maintenance` has had list,
 * resolve and delete since it was written and nothing in this app ever
 * called them — reported things surfaced only as at most five rows in
 * "Needs you" on Home, open ones only, behind a View button that did
 * nothing. So a sixth report was invisible, a resolved one left no
 * trace, and the one affordance was a no-op.
 *
 * ## Why the kinds sit in one list
 *
 * The cleaner's app asks them to choose: Broken, Supplies, Anything.
 * That choice is a routing decision the backend needs — supplies go on a
 * shopping list, faults go in the maintenance table — and it is of no
 * interest to the person reading. They are asking one question, "what is
 * outstanding", and three lists is three places to ask it.
 *
 * They are still labelled and filterable, because a broken geyser and a
 * request for bin liners want different reactions and get dealt with on
 * different trips. Labelled, not separated.
 *
 * ## What is deliberately not here
 *
 * "Needs you" on Home stays where it is. Those rows are derived — an
 * unstaffed checkout, a cleaner who has not answered — and are not
 * things you tick off: they resolve when you assign somebody, and a Done
 * button on one would be a lie. This page is the things that are
 * records: somebody wrote them down, somebody closes them.
 *
 * ## Done is kept
 *
 * Nothing written down disappears. A resolved fault and a bought item
 * move to Done rather than vanishing, because "did anybody deal with
 * that" is the next question and the old screen could not answer it.
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
  property_id: number;
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
  id: number;property_id: number;property: string;item_name: string;
  quantity: number;unit: string;notes: string;status: string;
  created_at: string;added_by_name: string | null;
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

/** What the Add form is holding, before it is sent. */
const BLANK = { kind: 'supply' as Kind, property_id: 0, title: '', detail: '' };

export function TodoPage({ propertyId = 0 }: {
  /** The property filter in the top nav. 0 is every property. */
  propertyId?: number;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [properties, setProperties] = useState<{id: number;name: string;}[]>([]);
  const [showDone, setShowDone] = useState(false);
  // null is every kind. A single value rather than a set: the reason to
  // filter here is "I am going to the shops" or "I am fixing things",
  // and those are one errand at a time.
  const [kindFilter, setKindFilter] = useState<Kind | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      // Two tables, because they are genuinely two things — but one
      // request each and one list out, so the page cannot show a fault
      // and a supply as of different moments.
      const [issues, supplies, props] = await Promise.all([
        apiGet<Issue[]>('/api/maintenance'),
        apiGet<Supply[]>('/api/supplies'),
        // For the Add form. Already scoped by the server, so this is
        // also the answer to "which properties may I add against".
        apiGet<{id: number;name: string;}[]>('/api/properties'),
      ]);
      setProperties(props || []);

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
        property_id: i.property_id,
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
        property_id: s.property_id,
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

  /**
   * Write one down yourself.
   *
   * Everything here arrived from a cleaner, because asking was only ever
   * built into their app — an owner who notices the coffee is finished
   * had to tell somebody to report it. Which of the two tables it lands
   * in follows from the kind, exactly as it does on the cleaner's side.
   */
  const add = async () => {
    if (!draft.title.trim() || !draft.property_id) return;
    setSaving(true);
    setError('');
    const [url, body] = draft.kind === 'supply' ?
    ['/api/supplies', { property_id: draft.property_id, item_name: draft.title, notes: draft.detail }] :
    ['/api/maintenance', {
      property_id: draft.property_id,
      title: draft.title,
      description: draft.detail,
      // The same categories the cleaner's app writes, so a thing an
      // owner adds and the same thing a cleaner reports read alike.
      category: draft.kind === 'note' ? 'Note from cleaner' : 'Reported by cleaner',
      priority: draft.kind === 'note' ? 'low' : 'medium',
    }];

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not add that');
      return;
    }
    // Keep the kind and the property: adding three things for one
    // property is the normal case, and re-picking both each time is the
    // fastest way to make somebody stop using the form.
    setDraft({ ...draft, title: '', detail: '' });
    setAdding(false);
    load();
  };

  /**
   * Hand the list to somebody.
   *
   * A shopping list that lives only in an app is a list you read off a
   * screen in an aisle. The useful thing is getting it out — into a
   * WhatsApp message to whoever is going, or a note on the way.
   *
   * It shares what is on screen, filters and all. That is the point:
   * pick Supplies, pick a property if you like, share exactly that.
   *
   * navigator.share first, because on a phone it opens the sheet that
   * has Copy in it anyway. A cancelled share is not a failure and must
   * not fall through to quietly copying instead — the only reason to
   * cancel is not wanting it.
   */
  const share = async () => {
    const heading = [
      kindFilter ? LOOK[kindFilter].label : 'To do',
      propertyId ? (properties.find((p) => p.id === propertyId) || {}).name : null,
    ].filter(Boolean).join(' · ');

    const text = [
      heading,
      ...shown.map((r) => [
        `• ${r.title}`,
        // The property only when the list spans more than one, or every
        // line carries the same name for nothing.
        !propertyId && r.property ? `(${r.property})` : '',
        r.detail ? `— ${r.detail}` : '',
      ].filter(Boolean).join(' ')),
    ].join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e: any) {
        // Cancelled. Not an error, and not a reason to do something else.
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the list');
    }
  };

  // The top nav's property filter applies here as it does elsewhere, so
  // switching to one property does not leave this page showing all of
  // them.
  const inScope = propertyId ?
  reports.filter((r) => r.property_id === propertyId) :
  reports;
  const open = inScope.filter((r) => r.open);
  const done = inScope.filter((r) => !r.open);
  const byState = showDone ? done : open;
  const shown = kindFilter ? byState.filter((r) => r.kind === kindFilter) : byState;

  return (
    <div className="p-4 lg:px-8 lg:py-6 bg-[#F7F7F7] min-h-full">
      <div className="lg:max-w-[860px]">

        {/* Open first, because that is what the page is for. Done is one
            tap away rather than below it — a list you scroll past to
            reach the live ones is a list that grows into a wall. */}
        <div className="flex items-center gap-2 mb-3">
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

          {/* Out of the app and into whoever is actually going. Only
              when there is something to send. */}
          {shown.length > 0 &&
          <button
            onClick={share}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-semibold border border-[#DDDDDD] bg-white text-[#222222]">
            <Share2 className="w-3.5 h-3.5" />
            {copied ? 'Copied' : 'Share'}
          </button>
          }

          <button
            onClick={() => { setAdding(!adding); setError(''); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#222222] text-white ${
            shown.length > 0 ? '' : 'ml-auto'}`}>
            {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {adding ? 'Cancel' : 'Add'}
          </button>
        </div>

        {/* Which errand this is. One trip to the shops does not want the
            broken geyser in the middle of the list. Counted against what
            is actually on screen, so a zero here is the truth. */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {([null, 'supply', 'broken', 'note'] as const).map((k) => {
            const count = k ? byState.filter((r) => r.kind === k).length : byState.length;
            return (
              <button
                key={k || 'all'}
                onClick={() => setKindFilter(k)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium border ${
                kindFilter === k ?
                'bg-[#222222] text-white border-[#222222]' :
                'bg-white border-[#DDDDDD] text-[#222222]'}`
                }>
                {k ? LOOK[k].label : 'All'}{' '}
                <span className="tabular-nums">{count}</span>
              </button>);

          })}
        </div>

        {adding &&
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] p-4 mb-4">
            <div className="flex gap-2 mb-3">
              {(['supply', 'broken', 'note'] as const).map((k) => {
              const { Icon, label } = LOOK[k];
              return (
                <button
                  key={k}
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-[13px] font-semibold border ${
                  draft.kind === k ?
                  'bg-[#222222] text-white border-[#222222]' :
                  'border-[#DDDDDD] text-[#222222]'}`
                  }>
                    <Icon className="w-4 h-4" /> {label}
                  </button>);

            })}
            </div>

            <select
            value={draft.property_id || ''}
            onChange={(e) => setDraft({ ...draft, property_id: Number(e.target.value) })}
            className="w-full h-[44px] px-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px]">
              <option value="">Which property?</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            {/* Supplies get room for several. Each line becomes its own
                row, because a row is the unit you tick off — three
                things in one row means buying one closes all three. */}
            {draft.kind === 'supply' ?
            <textarea
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={'What is needed?\nOne per line'}
              className="w-full h-[88px] p-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px] resize-none" /> :

            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={draft.kind === 'broken' ? 'What is broken?' : 'What is worth noting?'}
              className="w-full h-[44px] px-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px]" />
            }

            <textarea
            value={draft.detail}
            onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
            placeholder="Anything else worth knowing (optional)"
            className="w-full h-[72px] p-3 mb-3 border border-[#DDDDDD] rounded-[8px] text-[14px] resize-none" />

            <button
            onClick={add}
            disabled={saving || !draft.title.trim() || !draft.property_id}
            className="w-full h-[44px] bg-[#222222] text-white rounded-[8px] text-[14px] font-semibold disabled:opacity-40">
              {saving ? 'Adding…' : 'Add to the list'}
            </button>
          </div>
        }

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
