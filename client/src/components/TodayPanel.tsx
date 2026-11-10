import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, Check, AlertCircle, ArrowRight, RefreshCw, Sparkles, ShoppingCart, X } from 'lucide-react';
import { apiGet, Unauthorized } from '../data/session';
import { PropertyRows, PropertyRow } from './PropertyRows';

/**
 * The home screen.
 *
 * It had nine sections. Three of them — a board of arrivals and
 * departures, a properties card, and a list of who was currently
 * staying — each answered a slice of "what is the state of my flats",
 * so you read three places and joined them up yourself. Two more,
 * "Upcoming" and "Today and tomorrow", were different-length windows
 * onto the same events. The remaining four were analysis: revenue,
 * occupancy, cancellations and holidays, which either live in the
 * Analytics tab already or belong nearer the dates they describe.
 *
 * What is left is three questions, in the order somebody asks them:
 *
 *   Needs you        what will go wrong if I do nothing
 *   Your properties  what state is each one in, right now
 *   Next 7 days      what is coming, and is somebody on it
 *
 * All three come from one call. Sections fetching their own data is how
 * this page came to contradict itself.
 */

interface Need {
  key: string;
  title: string;
  subtitle: string;
  /** Information somebody can take off the front page without resolving it. */
  dismissible?: boolean;
  severity?: string;
  detail?: string;
  action: {label: string;kind: string;property_id?: number;date?: string;block_id?: number;};
}

interface HolidaySoon {
  name: string;label: string;kind: 'public' | 'school';
  start: string;end: string;days_away: number;
}

interface Money {
  holidays: HolidaySoon[];
  open_nights_30: number;capacity_30: number;occupancy_30: number;
  open_nights_14: number;capacity_14: number;booked_revenue_30: number;
  /** What the arrivals leave after the channel's cut. */
  kept_30?: number;
  /** Taken off sale — not sold, and not sellable either. */
  blocked_nights_14?: number;blocked_nights_30?: number;
}

interface Supply {
  id: number;
  property_id: number | null;
  property: string | null;
  item: string;
  amount: string;
  notes: string;
  who: string | null;
  asked: string;
}

interface UpcomingRow {
  key: string;
  kind: 'in' | 'out';
  when: string;
  date: string;
  guest: string;
  property: string;
  property_id: number;
  cleaner: {name: string;status: string;} | null;
  time?: string;
  smoobu_id?: number;
  nights?: number;
  guests?: number | null;
}

/**
 * When it happens, as a sentence.
 *
 * The label and the verb were concatenated, so a departure that had
 * already happened read "Leaves already left" — the relative time is
 * sometimes a phrase in its own right and cannot always take a prefix.
 */
const phrase = (b: UpcomingRow) => {
  if (b.when === 'already left') return 'Already left';
  return `${b.kind === 'in' ? 'Arrives' : 'Leaves'} ${b.when}`;
};

/**
 * The forward list by day, because that is how it is planned: who leaves
 * and who arrives on the same morning, and who is cleaning in between.
 */
function groupByDay(rows: UpcomingRow[]) {
  const out: {date: string;label: string;rows: UpcomingRow[];}[] = [];
  for (const r of rows) {
    let g = out.find((x) => x.date === r.date);
    if (!g) {
      const d = new Date(r.date + 'T00:00:00');
      const label = r.when === 'today' || r.when === 'already left' ? 'Today' :
      r.when === 'tomorrow' ? 'Tomorrow' :
      d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'short' });
      g = { date: r.date, label, rows: [] };
      out.push(g);
    }
    // Departures before arrivals on a day: the clean happens between.
    g.rows.push(r);
    g.rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'out' ? -1 : 1));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const cleanerLabel = (c: UpcomingRow['cleaner']) => {
  if (!c) return null;
  if (c.status === 'pending') return `${c.name} · not answered yet`;
  if (c.status === 'completed') return `${c.name} · done`;
  if (c.status === 'in_progress') return `${c.name} · on site`;
  return `${c.name} · accepted`;
};

export function TodayPanel({ onGoToDay, onNeedsChange, onNavigate, propertyId = 0, onOpenBooking }: {
  onGoToDay?: (propertyId: number, date: string) => void;
  /**
   * The property picked at the top of Home. It was drawn and never sent,
   * so choosing The loft changed nothing on this page.
   */
  propertyId?: number;
  /** Open a booking's own sheet, by Smoobu id. */
  onOpenBooking?: (smoobuId: number) => void;
  /** How many things need somebody, for the tab badge. */
  onNeedsChange?: (count: number | null) => void;
  /** Somewhere to send a row that is not about a particular day. */
  onNavigate?: (tab: string) => void;
}) {
  const [needs, setNeeds] = useState<Need[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [money, setMoney] = useState<Money | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);

  const load = async () => {
    try {
      const data = await apiGet<{
        needs: Need[];properties: PropertyRow[];upcoming: UpcomingRow[];money: Money | null;
        supplies: Supply[];
      }>(propertyId ? `/api/dashboard/today?property_id=${propertyId}` : '/api/dashboard/today');
      setNeeds(data.needs || []);
      setSupplies(data.supplies || []);
      setProperties(data.properties || []);
      setUpcoming(data.upcoming || []);
      setMoney(data.money || null);
      setFailed(false);
    } catch (e) {
      // A 401 has already sent us back to the sign-in screen. Anything
      // else means we do not know what needs doing — which is not the
      // same as nothing needing doing, and must not be drawn as a tick.
      if (!(e instanceof Unauthorized)) setFailed(true);
    }
  };

  useEffect(() => { load(); }, [propertyId]);

  // The badge counts what is on the screen, because it reads the same
  // state the list renders — but only the whole picture. The tab badge
  // is not filtered, so a list narrowed to one property must not tell it
  // that everything else has stopped needing you.
  useEffect(() => {
    if (onNeedsChange && !propertyId) onNeedsChange(failed ? null : needs.length);
  }, [needs, failed, onNeedsChange, propertyId]);

  /**
   * Take an item off the front page.
   *
   * Not resolved — an issue stays open in To do — just read. Shared by
   * everybody on the property, and a finding comes back if it gets worse.
   */
  const putAway = async (n: Need) => {
    setBusy(n.key);
    setError('');
    const res = await fetch('/api/dashboard/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key: n.key, severity: n.severity }),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not put that away');
      return;
    }
    // Off the screen straight away, rather than after a reload.
    setNeeds((list) => list.filter((x) => x.key !== n.key));
  };

  const act = async (n: Need) => {
    if (n.action.kind === 'unblock' && n.action.property_id && n.action.block_id) {
      setBusy(n.key);
      setError('');
      const res = await fetch(
        `/api/properties/${n.action.property_id}/block/${n.action.block_id}`,
        { method: 'DELETE', credentials: 'same-origin' }
      );
      setBusy(null);
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || 'Could not put those nights back');
        return;
      }
      load();
      return;
    }
    // A reported fault is not about a day, so it has no date and fell
    // through both branches below — the View button on every issue row
    // did nothing at all. It goes to the page that lists them.
    if (n.action.kind === 'issue') {
      if (onNavigate) onNavigate('todo');
      return;
    }
    if (n.action.kind === 'rates') {
      if (onNavigate) onNavigate('rates');
      return;
    }
    if (n.action.property_id && n.action.date && onGoToDay) {
      onGoToDay(n.action.property_id, n.action.date);
    }
  };

  /**
   * Ticked off, which is the only thing to do with it from here.
   *
   * Keyed under `supply:` in the same `busy` slot the needs list uses —
   * an item id and a need key share the field, and a bare number would
   * put the spinner on whichever happened to match.
   */
  const bought = async (s: Supply) => {
    setBusy(`supply:${s.id}`);
    setError('');
    const res = await fetch(`/api/supplies/${s.id}/purchased`, {
      method: 'PATCH', credentials: 'same-origin',
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not tick that off');
      return;
    }
    load();
  };

  return (
    <>
      {/* 1. What will go wrong if you do nothing. */}
      <div className="mb-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
          Needs you
        </div>

        {error && <p className="mb-2 text-[13px] text-[#991B1B]">{error}</p>}

        {failed ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
            <span className="text-[14px] text-[#222222] flex-1">Could not load what needs you.</span>
            <button
            onClick={() => load()}
            className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-[#FF385C]">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div> :

        needs.length === 0 ?
        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3 flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F6E56]" />
            <span className="text-[14px] text-[#222222]">Nothing needs you.</span>
          </div> :

        <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {needs.map((n, idx) =>
          <div
            key={n.key}
            className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                <AlertCircle className="w-4 h-4 text-[#D93900] shrink-0" />
                {/* Wraps rather than truncates. On a phone the cut-off
                    half of "Leak at kitchen sink at Hill To…" was the
                    half that said where. */}
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-[#222222] leading-snug">{n.title}</div>
                  <div className="text-[13px] text-[#717171] leading-snug">{n.subtitle}</div>
                </div>
                <button
              disabled={busy === n.key}
              onClick={() => act(n)}
              className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-[#FF385C] disabled:opacity-50">
                  {busy === n.key ? 'Working…' : n.action.label}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                {n.dismissible &&
              <button
                disabled={busy === n.key}
                onClick={() => putAway(n)}
                aria-label={`Hide "${n.title}" from Home`}
                title="Hide from Home — it stays open"
                className="shrink-0 -mr-1 p-1 text-[#B0B0B0] hover:text-[#717171] disabled:opacity-50">
                    <X className="w-4 h-4" />
                  </button>
              }
              </div>
          )}
          </div>
        }
      </div>

      {/* 2. What somebody has run out of.

             Drawn only when there is something on it. A "Supplies" block
             showing "nothing needed" most of the week is a block people
             learn to scroll past, and this page has been cut back once
             already for exactly that. Below "Needs you" rather than in
             it: bin liners can wait for the next shop, a checkout with
             nobody cleaning cannot. */}
      {!failed && supplies.length > 0 &&
      <div className="mb-6">
          <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
            Supplies needed
          </div>
          <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {supplies.map((s, idx) =>
          <div
            key={s.id}
            className={`flex items-center gap-3 px-4 py-3 ${idx > 0 ? 'border-t border-[#F0F0F0]' : ''}`}>
                <ShoppingCart className="w-4 h-4 text-[#717171] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium text-[#222222] truncate">{s.item}</div>
                  <div className="text-[13px] text-[#717171] truncate">
                    {[s.amount, s.property, s.who, s.asked, s.notes].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
              disabled={busy === `supply:${s.id}`}
              onClick={() => bought(s)}
              className="shrink-0 text-[13px] font-semibold text-[#FF385C] disabled:opacity-50">
                  {/* An instruction, not a state. "Bought" beside an
                      item reads as a label saying it already has been. */}
                  {busy === `supply:${s.id}` ? 'Saving…' : 'Mark as bought'}
                </button>
              </div>
          )}
          </div>
        </div>
      }

      {/* 3. What is still to sell. Not the old KPI row — gross revenue
             and average nightly rate say how last quarter went, which
             Analytics already answers. These are the nights nobody has
             bought yet, which is the thing you can still act on. */}
      {!failed && money &&
      <div className="mb-6">
          <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
            Still to sell
          </div>
          <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] px-4 py-3
                          grid grid-cols-3 gap-3">
            {/* Open less blocked: a night taken off sale cannot be sold
                either, and counting it as open over-promised by every
                one of them. */}
            <div>
              <div className="text-[20px] font-semibold text-[#222222] tabular-nums leading-tight">
                {Math.max(0, money.open_nights_30 - (money.blocked_nights_30 || 0))}
              </div>
              <div className="text-[12px] text-[#717171] leading-snug">
                nights to sell<br />next 30 days
              </div>
            </div>
            <div>
              <div className={`text-[20px] font-semibold tabular-nums leading-tight ${
              money.open_nights_14 - (money.blocked_nights_14 || 0) > 0 ? 'text-[#D93900]' : 'text-[#0F6E56]'}`}>
                {Math.max(0, money.open_nights_14 - (money.blocked_nights_14 || 0))}
              </div>
              <div className="text-[12px] text-[#717171] leading-snug">
                to sell in the<br />next 14 days
              </div>
            </div>
            <div>
              <div className="text-[20px] font-semibold text-[#222222] tabular-nums leading-tight">
                {money.occupancy_30}%
              </div>
              <div className="text-[12px] text-[#717171] leading-snug">
                booked<br />next 30 days
              </div>
            </div>
          </div>
          {/* What you keep, leading. The gross was mostly the channels'
              money once commission, bank charge and VAT came off it. */}
          <p className="text-[12px] text-[#717171] mt-1.5">
            R {(money.kept_30 ?? money.booked_revenue_30).toLocaleString('en-ZA')} yours from guests arriving in the next 30 days
            {money.kept_30 != null && money.kept_30 !== money.booked_revenue_30 &&
          <> · R {money.booked_revenue_30.toLocaleString('en-ZA')} before fees</>}
            {(money.blocked_nights_30 || 0) > 0 &&
          <> · {money.blocked_nights_30} night{money.blocked_nights_30 === 1 ? '' : 's'} blocked</>}
            .
          </p>

          {/* Why those nights might sell. One line, because a holiday is
              a reason to look at a price, not a thing to do. */}
          {money.holidays.length > 0 &&
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {money.holidays.slice(0, 4).map((h) =>
          <span key={`${h.name}:${h.label}:${h.start}`} className="flex items-center gap-1.5 text-[12px] text-[#6B5310]">
                  <span className={`shrink-0 bg-[#C9A227] ${
            h.kind === 'public' ? 'w-[5px] h-[5px] rounded-full' : 'w-[8px] h-[3px] rounded-full'}`} />
                  {h.label} · {h.name} {h.days_away === 0 ? 'today' : h.days_away < 0 ? 'on now' : `in ${h.days_away}d`}
                </span>
          )}
              {money.holidays.length > 4 &&
          <span className="text-[12px] text-[#B0B0B0]">+{money.holidays.length - 4} more</span>
          }
            </div>
        }
        </div>
      }

      {/* 3. The state of each property, one row each. */}
      {!failed && <PropertyRows rows={properties} onChanged={load} onOpenBooking={onOpenBooking} />}

      {/* 3. What is coming. Seven days, because two was not long enough
             to arrange a cleaner around. */}
      {!failed &&
      <div className="mb-6">
          <div className="text-[12px] font-semibold uppercase tracking-[0.5px] text-[#B0B0B0] pb-2">
            Coming up
          </div>
          <div className="bg-white rounded-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
            {upcoming.length === 0 ?
          <div className="px-4 py-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#B0B0B0]" />
                <span className="text-[14px] text-[#717171]">Nothing arriving or leaving this week.</span>
              </div> :

          groupByDay(upcoming).map((g) =>
          <div key={g.date}>
                <div className="px-4 pt-3 pb-1 text-[12px] font-medium text-[#717171]">{g.label}</div>
                {g.rows.map((b) =>
            <button
              key={b.key}
              onClick={() => b.smoobu_id && onOpenBooking && onOpenBooking(b.smoobu_id)}
              className="w-full text-left flex items-start gap-3 px-4 py-2.5 border-t border-[#F0F0F0] first:border-t-0">
                    <span className="w-[44px] shrink-0 text-[14px] font-semibold text-[#222222] tabular-nums pt-[1px]">
                      {b.time || ''}
                    </span>
                    <div className="flex-1 min-w-0">
                      {/* A sentence rather than a name and a label. The
                          name truncated to "Hunter Ta…" whenever the
                          cleaner column was beside it. */}
                      <div className="text-[15px] font-medium text-[#222222] leading-snug flex items-center gap-1.5">
                        {b.kind === 'in' ?
                  <LogIn className="w-[13px] h-[13px] text-[#00A699] shrink-0" strokeWidth={2.5} /> :
                  <LogOut className="w-[13px] h-[13px] text-[#E8913A] shrink-0" strokeWidth={2.5} />}
                        <span>{b.guest} {b.kind === 'in' ? 'arrives' : (b.when === 'already left' ? 'has left' : 'leaves')}</span>
                      </div>
                      <div className="text-[13px] text-[#717171] leading-snug">
                        {[b.property,
                  b.guests ? `${b.guests} guest${b.guests === 1 ? '' : 's'}` : '',
                  b.nights ? `${b.nights} night${b.nights === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
                      </div>
                      {b.kind === 'out' && (
                  b.cleaner ?
                  <div className={`text-[13px] leading-snug ${
                  b.cleaner.status === 'pending' ? 'text-[#B45309]' : 'text-[#0F6E56]'}`}>
                            {cleanerLabel(b.cleaner)}
                          </div> :
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); onGoToDay && onGoToDay(b.property_id, b.date); }}
                    className="text-[13px] font-semibold text-[#FF385C]">
                            Nobody cleaning yet — assign
                          </span>)
                  }
                    </div>
                  </button>
            )}
              </div>
          )}
          </div>
        </div>
      }
    </>);

}
