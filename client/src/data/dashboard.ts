import { properties as allProperties } from './properties';
import { filterDismissed, dismiss } from './dismissed';

// Dashboard data — populated by loadDashboardData() from the real API

export let kpis: { label: string; value: string; subvalue?: string; trend: string; isPositive: boolean; period: string }[] = [];

export let needsAttention: { id: number; key: string; title: string; subtitle: string; dotColor: string }[] = [];

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

// Holidays are static — no API needed
const allHolidays = [
  { id: 1, title: 'Human Rights Day', subtitle: 'Mar 21 · South Africa · expect higher demand', date: '2026-03-21' },
  { id: 2, title: 'Good Friday', subtitle: 'Apr 18 · International · long weekend', date: '2026-04-18' },
  { id: 3, title: 'Easter Weekend', subtitle: 'Apr 18–21 · Europe + SA · peak bookings', date: '2026-04-21' },
  { id: 4, title: 'Freedom Day', subtitle: 'Apr 27 · South Africa · public holiday', date: '2026-04-27' },
  { id: 5, title: 'Workers\' Day', subtitle: 'May 1 · South Africa · public holiday', date: '2026-05-01' },
  { id: 6, title: 'Youth Day', subtitle: 'Jun 16 · South Africa · public holiday', date: '2026-06-16' },
];
export const upcomingHolidays = allHolidays.filter((h) => h.date >= new Date().toISOString().split('T')[0]);

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
}

// "1 guest", "2 guests", "? guests" (unknown count)
function fmtGuests(n: any): string {
  if (!n && n !== 0) return '? guests';
  return `${n} ${n === 1 ? 'guest' : 'guests'}`;
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

    let stats: any = { occupancy: [], gaps: [], pending_cleaning_jobs: [], upcoming_checkouts: [] };
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
      });
    });

    // Gaps
    (stats.gaps || []).forEach((g: any) => {
      attentionItems.push({
        id: attId++,
        key: `attn:gap:${g.property_id}:${g.gap_start}`,
        title: `${g.nights}-night gap ${fmtDate(g.gap_start)}`,
        subtitle: `${g.property_name} · offer discount?`,
        dotColor: 'bg-[#E8913A]',
      });
    });

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
        meta: `${fmtGuests(b.num_guests)} · ${fmtDate(b.check_in)}–${fmtDate(b.check_out)}`,
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
        const rate = p.base ? fmtMoney(p.base) + '/night' : '';
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
        detail: `${b.property_name || ''} · ${fmtGuests(b.num_guests)}`,
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
    agenda = agendaItems
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .slice(0, 6);

    if (onDataChanged) onDataChanged();

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}
