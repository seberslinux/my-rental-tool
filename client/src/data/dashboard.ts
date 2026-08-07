import { properties as allProperties } from './properties';
import { filterDismissed, dismiss } from './dismissed';

// Dashboard data — populated by loadDashboardData() from the real API

export let kpis: { label: string; value: string; subvalue?: string; trend: string; isPositive: boolean; period: string }[] = [];

export let needsAttention: {
  id: number; key: string; title: string; subtitle: string; dotColor: string;
  // Where acting on this item takes you. Every attention item should have
  // one — an item you can't act on is a notification, not a task.
  action?: { label: string; tab: string };
}[] = [];

// Today's operations: who is arriving or leaving in the next 48 hours and
// whether the property is ready for them. This is the reason to open the
// app on a weekday morning.
export let todayBoard: {
  id: string; kind: 'in' | 'out'; when: string; guest: string;
  property: string; detail: string; ready: boolean | null; readyLabel: string;
}[] = [];

export let currentlyStaying: {
  id: number; property: string; platform: string; guestName: string;
  meta: string; rate?: string; total?: string; isVacant: boolean;
  statusText?: string; statusType?: string;
}[] = [];

export let nextUp: { id: number; type: string; label: string; name: string; detail: string; isLast?: boolean; sortDate?: string }[] = [];

// Merged chronological agenda: check-ins, check-outs and cleanings in one list.
export let agenda: { id: string; type: 'in' | 'out' | 'clean'; date: string; title: string; subtitle: string }[] = [];

export let cleaningJobs: { id: number; title: string; subtitle: string; status: string; buttonText: string; isProblem: boolean }[] = [];

export let recentCancellations: { id: number; key: string; guestName: string; property: string; checkIn: string; checkOut: string; platform: string; cancelledAt: string; cancelledDate: string }[] = [];

// ISO timestamp of the last completed bookings sync (or null if never synced).
export let lastSyncedAt: string | null = null;

// Forward occupancy across the booking window — the signal the 30-day KPI
// can't give: a month far enough ahead that it can still be filled.
export let forwardOccupancy: {
  month: string; label: string; occupancyRate: number;
  nightsBooked: number; nightsAvailable: number; revenue: string;
  isPartial: boolean;
}[] = [];

let activePropertyFilter = 0; // 0 = all properties
let onDataChanged: (() => void) | null = null;

// Unfiltered source lists, retained so dismissals can be re-applied without refetching.
let allAttentionItems: typeof needsAttention = [];
let allCancelledItems: typeof recentCancellations = [];

export function setOnDataChanged(cb: () => void): void {
  onDataChanged = cb;
}

// Dismiss a Needs Attention item ('day' scope) or a cancellation ('forever' scope),
// then re-apply filtering and notify the UI to re-render.
export function dismissDashboardItem(key: string, scope: 'day' | 'forever'): void {
  dismiss(key, scope);
  needsAttention = filterDismissed(allAttentionItems, (a) => a.key).slice(0, 5);
  recentCancellations = filterDismissed(allCancelledItems, (c) => c.key).slice(0, 5);
  if (onDataChanged) onDataChanged();
}

export async function setPropertyFilter(propertyId: number): Promise<void> {
  activePropertyFilter = propertyId;
  await loadDashboardData();
}

// Holidays come from the server (/api/dashboard/stats), which resolves
// them via cache → Nager.Date → computed rules. Previously this was a
// hardcoded array that silently went empty once its dates passed.
export let upcomingHolidays: { id: number; title: string; subtitle: string; date: string }[] = [];

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
}

// Total people arriving. Smoobu splits the party into adults and children,
// and `num_guests` holds only the adults — so a family of two adults plus
// two children was being announced as "2 guests", which is the number that
// matters least to whoever is making up the beds. Children are called out
// separately because they change what the property needs (cot, high chair),
// not just how many towels.
function fmtParty(b: any): string {
  const adults = b.num_guests ?? null;
  const kids = b.children || 0;
  if (adults === null) return '? guests';
  const total = adults + kids;
  const base = `${total} ${total === 1 ? 'guest' : 'guests'}`;
  return kids > 0 ? `${base} · ${kids} ${kids === 1 ? 'child' : 'children'}` : base;
}

function fmtMoney(amount: number): string {
  if (!amount) return 'R 0';
  if (amount >= 1000000) return `R ${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `R ${(amount / 1000).toFixed(1)}K`;
  return `R ${amount}`;
}

function platformLabel(p: string): string {
  const pl = (p || '').toLowerCase();
  // Check 'direct'/'blocked' first: Smoobu names direct bookings "Direct booking",
  // which contains the substring "booking" and would otherwise match as Booking.com.
  if (pl.includes('direct')) return 'Direct';
  if (pl.includes('blocked')) return 'Blocked';
  if (pl.includes('airbnb')) return 'Airbnb';
  if (pl.includes('booking')) return 'Booking';
  return 'Direct';
}

function daysFromNow(dateStr: string): number {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function relativeDay(dateStr: string): string {
  const diff = daysFromNow(dateStr);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return fmtDate(dateStr);
}

// Build the KPI endpoint URL, including a property_id filter when the user
// has selected a single property (activePropertyFilter > 0). The server
// scopes to the user's accessible properties in either case.
function kpiUrl(propertyFilter: number): string {
  return propertyFilter > 0
    ? `/api/dashboard/kpis?property_id=${propertyFilter}`
    : '/api/dashboard/kpis';
}

export async function loadDashboardData(): Promise<void> {
  try {
    const [bookingsRes, statsRes, kpisRes] = await Promise.all([
      fetch('/api/bookings', { credentials: 'same-origin' }),
      fetch('/api/dashboard/stats', { credentials: 'same-origin' }),
      fetch(kpiUrl(activePropertyFilter), { credentials: 'same-origin' }),
    ]);

    const today = new Date().toISOString().split('T')[0];
    let allBookings: any[] = [];
    let scopedBookings: any[] = [];
    let displayCurrency = 'ZAR';

    if (bookingsRes.ok) {
      const bData = await bookingsRes.json();
      const rawBookings: any[] = bData.bookings || bData;
      displayCurrency = bData.display_currency || 'ZAR';

      // Apply property filter
      scopedBookings = activePropertyFilter > 0
        ? rawBookings.filter((b: any) => b.property_id === activePropertyFilter)
        : rawBookings;

      // Separate cancelled from active bookings
      const cancelledBookings = scopedBookings.filter((b: any) => b.status === 'cancelled');
      allBookings = scopedBookings.filter((b: any) => b.status !== 'cancelled');

      // Recent cancellations — surfaced by WHEN they were cancelled (modified_at),
      // not by their scheduled stay dates. Dismissed ones (permanent) are hidden.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const cancelledItems = cancelledBookings
        .filter((b: any) => {
          if ((b.platform || '').toLowerCase().includes('block')) return false;
          const cancelledAt = b.modified_at || b.created_at || '';
          return cancelledAt >= thirtyDaysAgo; // ISO timestamp vs YYYY-MM-DD compares correctly
        })
        .sort((a: any, b: any) => (b.modified_at || b.created_at || '').localeCompare(a.modified_at || a.created_at || ''))
        .map((b: any) => {
          const cancelledAt = b.modified_at || b.created_at || '';
          return {
            id: b.id,
            key: `cancel:${b.id}`,
            guestName: b.guest_name || `Guest · ${platformLabel(b.platform)}`,
            property: b.property_name || `Property ${b.property_id}`,
            checkIn: fmtDate(b.check_in),
            checkOut: fmtDate(b.check_out),
            platform: platformLabel(b.platform),
            cancelledAt,
            cancelledDate: cancelledAt ? fmtDate(cancelledAt.split('T')[0]) : '',
          };
        });
      allCancelledItems = cancelledItems;
      recentCancellations = filterDismissed(cancelledItems, (c) => c.key).slice(0, 5);
    }

    let stats: any = { occupancy: [], gaps: [], pending_cleaning_jobs: [], upcoming_checkouts: [], holidays: [] };
    if (statsRes.ok) {
      stats = await statsRes.json();
      lastSyncedAt = stats.last_synced_at || null;
      // Apply property filter to stats
      if (activePropertyFilter > 0) {
        stats.occupancy = (stats.occupancy || []).filter((o: any) => o.property_id === activePropertyFilter);
        stats.gaps = (stats.gaps || []).filter((g: any) => g.property_id === activePropertyFilter);
        stats.pending_cleaning_jobs = (stats.pending_cleaning_jobs || []).filter((j: any) => j.property_id === activePropertyFilter);
        stats.upcoming_checkouts = (stats.upcoming_checkouts || []).filter((c: any) => c.property_id === activePropertyFilter);
      }
    }

    // --- KPIs (server-side, currency-corrected) ---
    // GET /api/dashboard/kpis returns pre-computed values in the display
    // currency; see the response shape in src/routes/api.js. This replaces
    // the previous client-side reduction that (a) had an unbounded window
    // filter and (b) summed raw `total_price` across mixed currencies.
    let kpiBody: any = null;
    if (kpisRes.ok) kpiBody = await kpisRes.json();

    function fmtChange(pct: number): string {
      if (pct === 0) return '';
      return `${pct > 0 ? '+' : ''}${pct}% vs prior 30d`;
    }

    kpis = kpiBody ? [
      {
        label: 'Revenue Earned',
        // Primary value = net (after commission + bank + VAT).
        value: fmtMoney(kpiBody.revenue_earned.value),
        // Show gross underneath so the guest-paid figure is still visible.
        subvalue: `gross ${fmtMoney(kpiBody.revenue_earned.gross)}`,
        trend: fmtChange(kpiBody.revenue_earned.change_pct),
        isPositive: kpiBody.revenue_earned.change_pct >= 0,
        period: 'Last 30 days',
      },
      // "Coming" has no natural prior baseline (future bookings drift as
      // guests book), so no trend is shown.
      {
        label: 'Revenue Coming',
        value: fmtMoney(kpiBody.revenue_coming.value),
        subvalue: `gross ${fmtMoney(kpiBody.revenue_coming.gross)}`,
        trend: '',
        isPositive: true,
        period: 'All future stays',
      },
      {
        label: 'Occupancy',
        value: `${kpiBody.occupancy.value}%`,
        trend: fmtChange(kpiBody.occupancy.change_pct),
        isPositive: kpiBody.occupancy.change_pct >= 0,
        period: 'Next 30 days',
      },
      {
        label: 'Avg Rate',
        value: fmtMoney(kpiBody.avg_rate.value),
        trend: fmtChange(kpiBody.avg_rate.change_pct),
        isPositive: kpiBody.avg_rate.change_pct >= 0,
        period: 'Last 30 days',
      },
    ] : [];

    forwardOccupancy = ((kpiBody && kpiBody.forward_occupancy) || []).map((m: any) => {
      const d = new Date(m.month + '-01T00:00:00');
      const name = d.toLocaleDateString('en-ZA', { month: 'short' });
      return {
        month: m.month,
        // The current month only counts nights still to come, so say so
        // rather than implying a full-month comparison.
        label: m.is_partial ? `rest of ${name}` : name,
        occupancyRate: m.occupancy_rate,
        nightsBooked: m.nights_booked,
        nightsAvailable: m.nights_available,
        revenue: fmtMoney(m.revenue),
        isPartial: m.is_partial,
      };
    });

    // --- Today's board ---
    // Arrivals and departures over the next 48 hours, each tagged with
    // whether the property is ready. A departure is "ready" once a cleaning
    // job exists for that date; an arrival is ready once the preceding
    // turnover is covered. Missing cleaner is the failure that actually
    // hurts — a guest walking into an uncleaned property.
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const jobsByPropDate = new Map<string, any>();
    (stats.pending_cleaning_jobs || []).forEach((j: any) => {
      const d = String(j.cleaning_date).slice(0, 10);
      jobsByPropDate.set(`${j.property_id}|${d}`, j);
    });

    const boardItems: typeof todayBoard = [];
    allBookings
      .filter((b: any) => !(b.platform || '').toLowerCase().includes('block'))
      .forEach((b: any) => {
        const propName = b.property_name || `Property ${b.property_id}`;
        if (b.check_in === today || b.check_in === tomorrow) {
          boardItems.push({
            id: `in:${b.id}`,
            kind: 'in',
            when: relativeDay(b.check_in),
            guest: b.guest_name || platformLabel(b.platform),
            property: propName,
            detail: fmtParty(b),
            ready: null,
            readyLabel: '',
          });
        }
        if (b.check_out === today || b.check_out === tomorrow) {
          const job = jobsByPropDate.get(`${b.property_id}|${b.check_out}`);
          const hasCleaner = !!(job && job.cleaner_name);
          boardItems.push({
            id: `out:${b.id}`,
            kind: 'out',
            when: relativeDay(b.check_out),
            guest: b.guest_name || platformLabel(b.platform),
            property: propName,
            detail: 'Turnover',
            ready: hasCleaner,
            readyLabel: hasCleaner ? `Cleaner: ${job.cleaner_name}` : 'No cleaner assigned',
          });
        }
      });
    // Today before tomorrow, departures before arrivals within a day —
    // the turnover has to happen before the next guest walks in.
    const dayRank = (w: string) => (w === 'today' ? 0 : 1);
    todayBoard = boardItems.sort(
      (a, b) => dayRank(a.when) - dayRank(b.when) || (a.kind === 'out' ? -1 : 1)
    );

    // --- Needs Attention ---
    const attentionItems: typeof needsAttention = [];
    let attId = 1;

    // Unassigned cleaning jobs
    const unassignedJobs = (stats.pending_cleaning_jobs || []).filter((j: any) => !j.cleaner_id);
    unassignedJobs.forEach((j: any) => {
      attentionItems.push({
        id: attId++,
        key: `attn:nocleaner:${j.property_id}:${j.cleaning_date}`,
        title: 'No cleaner assigned',
        subtitle: `${j.property_name} · ${relativeDay(j.cleaning_date)}`,
        dotColor: 'bg-[#D93900]',
        action: { label: 'Assign', tab: 'cleaners' },
      });
    });

    // Gaps
    (stats.gaps || []).forEach((g: any) => {
      attentionItems.push({
        id: attId++,
        key: `attn:gap:${g.property_id}:${g.gap_start}`,
        title: `${g.nights}-night gap ${fmtDate(g.gap_start)}`,
        subtitle: `${g.property_name} · ${fmtDate(g.gap_start)}–${fmtDate(g.gap_end)}`,
        dotColor: 'bg-[#E8913A]',
        action: { label: 'View', tab: 'calendar' },
      });
    });

    // Only the NEXT month can be meaningfully behind. Median booking lead
    // time here is 25 days, so by the time a month is ~30 days out most of
    // its bookings should already have landed; still empty is a real
    // signal. Months beyond that are expected to be sparse — flagging them
    // would cry wolf every single day.
    const nextMonth = forwardOccupancy.find((m) => !m.isPartial);
    if (nextMonth && nextMonth.nightsBooked === 0 && nextMonth.nightsAvailable > 0) {
      attentionItems.push({
        id: attId++,
        key: `attn:empty:${nextMonth.month}`,
        title: `${nextMonth.label} still has no bookings`,
        subtitle: `${nextMonth.nightsAvailable} nights unsold · review pricing`,
        dotColor: 'bg-[#E8913A]',
        action: { label: 'Analytics', tab: 'analytics' },
      });
    }

    // Hide items the user dismissed today (they reappear tomorrow if still unresolved)
    allAttentionItems = attentionItems;
    needsAttention = filterDismissed(attentionItems, (a) => a.key).slice(0, 5);

    // --- Currently Staying (show all properties) ---
    // On check-in day, only show the guest after the property's check-in time (default 15:00)
    const now = new Date();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const stayingBookings = allBookings.filter((b: any) => {
      if (b.check_out <= today || b.check_in > today) return false;
      if ((b.platform || '').toLowerCase().includes('block')) return false;
      // On check-in day, only show after check-in time
      if (b.check_in === today) {
        const prop = allProperties.find((p) => p.id === b.property_id);
        const checkInTime = prop?.checkInTime || '15:00';
        if (currentHHMM < checkInTime) return false;
      }
      return true;
    });

    const stayingPropIds = new Set(stayingBookings.map((b: any) => b.property_id));

    // Determine which properties to show
    const visibleProps = activePropertyFilter > 0
      ? allProperties.filter((p) => p.id === activePropertyFilter)
      : allProperties;

    const stayItems: typeof currentlyStaying = [];

    // Add occupied properties
    stayingBookings.forEach((b: any) => {
      stayItems.push({
        id: b.id,
        property: b.property_name || `Property ${b.property_id}`,
        platform: platformLabel(b.platform),
        guestName: b.guest_name,
        meta: `${fmtParty(b)} · ${fmtDate(b.check_in)}–${fmtDate(b.check_out)}`,
        rate: b.price_per_night ? fmtMoney(b.price_per_night) : undefined,
        total: b.total_price ? `${fmtMoney(b.total_price)} total` : undefined,
        isVacant: false,
      });
    });

    // Add vacant properties (check if blocked or genuinely empty)
    // Include blocked bookings for this check
    const allBookingsIncBlocked = scopedBookings.filter((b: any) => b.status !== 'cancelled');
    visibleProps.forEach((p) => {
      if (!stayingPropIds.has(p.id)) {
        // Check if currently blocked
        const activeBlock = allBookingsIncBlocked.find((b: any) =>
          b.property_id === p.id && b.check_in <= today && b.check_out > today
          && (b.platform || '').toLowerCase().includes('block')
        );
        // Find next real check-in
        const nextCheckIn = allBookings.find((b: any) =>
          b.property_id === p.id && b.check_in > today && !((b.platform || '').toLowerCase().includes('block'))
        );
        const reason = activeBlock ? 'Blocked' : 'Empty';
        // Show the nightly rate of the booking that's actually arriving, not
        // the property's `base_price` — that field is Smoobu's minimum-price
        // floor (The loft's is R80) and has nothing to do with what the next
        // guest is paying.
        const rate = nextCheckIn?.price_per_night
          ? fmtMoney(Math.round(nextCheckIn.price_per_night)) + '/night'
          : '';
        const metaParts: string[] = [];
        if (activeBlock) metaParts.push(`Until ${fmtDate(activeBlock.check_out)}`);
        if (nextCheckIn) metaParts.push(`Next check-in ${fmtDate(nextCheckIn.check_in)}`);
        if (!activeBlock && !nextCheckIn) metaParts.push('No upcoming bookings');
        if (rate) metaParts.push(rate);

        stayItems.push({
          id: -p.id,
          property: p.name,
          platform: '',
          guestName: reason,
          meta: metaParts.join(' · '),
          isVacant: true,
          statusText: activeBlock ? 'Blocked' : (nextCheckIn ? `Check-in ${relativeDay(nextCheckIn.check_in)}` : 'Available'),
        });
      }
    });

    currentlyStaying = stayItems;

    // --- Next Up (check-ins and check-outs) ---
    const nextItems: typeof nextUp = [];
    let nextId = 1;

    // Upcoming check-outs (today + next 7 days)
    const upcomingOuts = allBookings
      .filter((b: any) => {
        const diff = daysFromNow(b.check_out);
        return diff >= 0 && diff <= 7 && !((b.platform || '').toLowerCase().includes('block'));
      })
      .sort((a: any, b: any) => a.check_out.localeCompare(b.check_out));

    upcomingOuts.slice(0, 3).forEach((b: any) => {
      nextItems.push({
        id: nextId++,
        type: 'out',
        label: `Check-out · ${relativeDay(b.check_out)}`,
        name: b.guest_name,
        detail: b.property_name || `Property ${b.property_id}`,
        sortDate: b.check_out,
      });
    });

    // Upcoming check-ins (today + next 7 days)
    const upcomingIns = allBookings
      .filter((b: any) => {
        const diff = daysFromNow(b.check_in);
        return diff >= 0 && diff <= 7 && !((b.platform || '').toLowerCase().includes('block'));
      })
      .sort((a: any, b: any) => a.check_in.localeCompare(b.check_in));

    upcomingIns.slice(0, 3).forEach((b: any) => {
      nextItems.push({
        id: nextId++,
        type: 'in',
        label: `Check-in · ${relativeDay(b.check_in)}`,
        name: b.guest_name,
        detail: `${b.property_name || ''} · ${fmtParty(b)}`,
        sortDate: b.check_in,
      });
    });

    // Sort chronologically by actual date
    nextItems.sort((a, b) => (a.sortDate || '').localeCompare(b.sortDate || ''));
    if (nextItems.length > 0) {
      nextItems[nextItems.length - 1].isLast = true;
    }
    nextUp = nextItems.slice(0, 5);

    // --- Cleaning Jobs ---
    const jobItems: typeof cleaningJobs = [];
    (stats.pending_cleaning_jobs || []).forEach((j: any) => {
      const hasAssignment = !!j.cleaner_name;
      jobItems.push({
        id: j.id,
        title: `${j.property_name} · ${j.cleaner_name || 'Unassigned'}`,
        subtitle: `${fmtDate(j.cleaning_date)} · ${j.status}`,
        status: hasAssignment ? 'ok' : 'warn',
        buttonText: hasAssignment ? 'Confirmed' : 'Assign',
        isProblem: !hasAssignment,
      });
    });
    cleaningJobs = jobItems;

    // --- Upcoming Holidays ---
    // Local (SA) holidays affect cleaner availability and local demand;
    // guest-source countries signal inbound demand. The subtitle says which.
    upcomingHolidays = (stats.holidays || []).slice(0, 8).map((h: any, i: number) => ({
      id: i + 1,
      title: h.name,
      subtitle: `${fmtDate(h.date)} · ${h.country_name} · ${h.is_local ? 'local public holiday' : 'expect inbound demand'}`,
      date: h.date,
    }));

    // --- Upcoming agenda (check-ins, check-outs and cleanings, merged by date) ---
    const agendaItems: typeof agenda = [];
    upcomingOuts.forEach((b: any) => {
      agendaItems.push({
        id: `out-${b.id}`,
        type: 'out',
        date: b.check_out,
        title: b.guest_name || 'Guest',
        subtitle: `Check-out · ${relativeDay(b.check_out)} · ${b.property_name || ''}`,
      });
    });
    upcomingIns.forEach((b: any) => {
      agendaItems.push({
        id: `in-${b.id}`,
        type: 'in',
        date: b.check_in,
        title: b.guest_name || 'Guest',
        subtitle: `Check-in · ${relativeDay(b.check_in)} · ${b.property_name || ''}`,
      });
    });
    (stats.pending_cleaning_jobs || []).forEach((j: any) => {
      agendaItems.push({
        id: `clean-${j.id}`,
        type: 'clean',
        date: j.cleaning_date,
        title: `${j.property_name} · cleaning`,
        subtitle: `${relativeDay(j.cleaning_date)} · ${j.cleaner_name || 'Unassigned'}`,
      });
    });
    // The next 48 hours already have their own block at the top of the page,
    // with cleaner-readiness detail this list doesn't carry. Repeating them
    // here just costs scrolling — most of it on a phone — so Upcoming picks
    // up where that block leaves off.
    const agendaFrom = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    agenda = agendaItems
      .filter((a) => a.date >= agendaFrom)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .slice(0, 6);

    if (onDataChanged) onDataChanged();

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}
