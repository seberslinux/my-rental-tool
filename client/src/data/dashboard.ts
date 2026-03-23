import { properties as allProperties } from './properties';

// Dashboard data — populated by loadDashboardData() from the real API

export let kpis: { label: string; value: string; trend: string; isPositive: boolean; period: string }[] = [];

export let needsAttention: { id: number; title: string; subtitle: string; dotColor: string }[] = [];

export let currentlyStaying: {
  id: number; property: string; platform: string; guestName: string;
  meta: string; rate?: string; total?: string; isVacant: boolean;
  statusText?: string; statusType?: string;
}[] = [];

export let nextUp: { id: number; type: string; label: string; name: string; detail: string; isLast?: boolean; sortDate?: string }[] = [];

export let cleaningJobs: { id: number; title: string; subtitle: string; status: string; buttonText: string; isProblem: boolean }[] = [];

export let recentCancellations: { id: number; guestName: string; property: string; checkIn: string; checkOut: string; platform: string; cancelledAt: string }[] = [];

let activePropertyFilter = 0; // 0 = all properties
let onDataChanged: (() => void) | null = null;

export function setOnDataChanged(cb: () => void): void {
  onDataChanged = cb;
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

function fmtMoney(amount: number): string {
  if (!amount) return 'R 0';
  if (amount >= 1000000) return `R ${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `R ${(amount / 1000).toFixed(1)}K`;
  return `R ${amount}`;
}

function platformLabel(p: string): string {
  const pl = (p || '').toLowerCase();
  if (pl.includes('airbnb')) return 'Airbnb';
  if (pl.includes('booking')) return 'Booking';
  if (pl.includes('blocked')) return 'Blocked';
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

export async function loadDashboardData(): Promise<void> {
  try {
    const [bookingsRes, statsRes] = await Promise.all([
      fetch('/api/bookings', { credentials: 'same-origin' }),
      fetch('/api/dashboard/stats', { credentials: 'same-origin' }),
    ]);

    const today = new Date().toISOString().split('T')[0];
    let allBookings: any[] = [];
    let displayCurrency = 'ZAR';

    if (bookingsRes.ok) {
      const bData = await bookingsRes.json();
      const rawBookings: any[] = bData.bookings || bData;
      displayCurrency = bData.display_currency || 'ZAR';

      // Apply property filter
      const scopedBookings = activePropertyFilter > 0
        ? rawBookings.filter((b: any) => b.property_id === activePropertyFilter)
        : rawBookings;

      // Separate cancelled from active bookings
      const cancelledBookings = scopedBookings.filter((b: any) => b.status === 'cancelled');
      allBookings = scopedBookings.filter((b: any) => b.status !== 'cancelled');

      // Recent cancellations (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      recentCancellations = cancelledBookings
        .filter((b: any) => b.check_in >= thirtyDaysAgo && !(b.platform || '').toLowerCase().includes('block'))
        .sort((a: any, b: any) => (b.modified_at || b.created_at || '').localeCompare(a.modified_at || a.created_at || ''))
        .slice(0, 5)
        .map((b: any) => ({
          id: b.id,
          guestName: b.guest_name || `Guest · ${platformLabel(b.platform)}`,
          property: b.property_name || `Property ${b.property_id}`,
          checkIn: fmtDate(b.check_in),
          checkOut: fmtDate(b.check_out),
          platform: platformLabel(b.platform),
          cancelledAt: b.modified_at || b.created_at || '',
        }));
    }

    let stats: any = { occupancy: [], gaps: [], pending_cleaning_jobs: [], upcoming_checkouts: [] };
    if (statsRes.ok) {
      stats = await statsRes.json();
      // Apply property filter to stats
      if (activePropertyFilter > 0) {
        stats.occupancy = (stats.occupancy || []).filter((o: any) => o.property_id === activePropertyFilter);
        stats.gaps = (stats.gaps || []).filter((g: any) => g.property_id === activePropertyFilter);
        stats.pending_cleaning_jobs = (stats.pending_cleaning_jobs || []).filter((j: any) => j.property_id === activePropertyFilter);
        stats.upcoming_checkouts = (stats.upcoming_checkouts || []).filter((c: any) => c.property_id === activePropertyFilter);
      }
    }

    // --- KPIs (current 30 days vs prior 30 days) ---
    const realBookings = allBookings.filter((b: any) => !(b.platform || '').toLowerCase().includes('block'));
    const thirtyDaysAgoStr = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const sixtyDaysAgoStr = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];

    const currentPeriod = realBookings.filter((b: any) => b.check_in >= thirtyDaysAgoStr);
    const priorPeriod = realBookings.filter((b: any) => b.check_in >= sixtyDaysAgoStr && b.check_in < thirtyDaysAgoStr);

    const totalRevenue = currentPeriod.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
    const priorRevenue = priorPeriod.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
    const revChange = priorRevenue > 0 ? Math.round(((totalRevenue - priorRevenue) / priorRevenue) * 100) : 0;

    const avgOccupancy = stats.occupancy.length > 0
      ? Math.round(stats.occupancy.reduce((s: number, o: any) => s + o.occupancy_rate, 0) / stats.occupancy.length)
      : 0;

    const avgRate = currentPeriod.length > 0
      ? Math.round(currentPeriod.reduce((s: number, b: any) => s + (b.price_per_night || 0), 0) / currentPeriod.length)
      : 0;
    const priorAvgRate = priorPeriod.length > 0
      ? Math.round(priorPeriod.reduce((s: number, b: any) => s + (b.price_per_night || 0), 0) / priorPeriod.length)
      : 0;
    const rateChange = priorAvgRate > 0 ? Math.round(((avgRate - priorAvgRate) / priorAvgRate) * 100) : 0;

    function fmtChange(pct: number): string {
      if (pct === 0) return '';
      return `${pct > 0 ? '+' : ''}${pct}% vs prior 30d`;
    }

    kpis = [
      { label: 'Revenue', value: fmtMoney(totalRevenue), trend: fmtChange(revChange), isPositive: revChange >= 0, period: 'Last 30 days' },
      { label: 'Occupancy', value: `${avgOccupancy}%`, trend: '', isPositive: avgOccupancy >= 50, period: 'Next 30 days' },
      { label: 'Avg Rate', value: fmtMoney(avgRate), trend: fmtChange(rateChange), isPositive: rateChange >= 0, period: 'Last 30 days' },
    ];

    // --- Needs Attention ---
    const attentionItems: typeof needsAttention = [];
    let attId = 1;

    // Unassigned cleaning jobs
    const unassignedJobs = (stats.pending_cleaning_jobs || []).filter((j: any) => !j.cleaner_id);
    unassignedJobs.forEach((j: any) => {
      attentionItems.push({
        id: attId++,
        title: 'No cleaner assigned',
        subtitle: `${j.property_name} · ${relativeDay(j.cleaning_date)}`,
        dotColor: 'bg-[#D93900]',
      });
    });

    // Gaps
    (stats.gaps || []).forEach((g: any) => {
      attentionItems.push({
        id: attId++,
        title: `${g.nights}-night gap ${fmtDate(g.gap_start)}`,
        subtitle: `${g.property_name} · offer discount?`,
        dotColor: 'bg-[#E8913A]',
      });
    });

    needsAttention = attentionItems.slice(0, 5);

    // --- Currently Staying (show all properties) ---
    const stayingBookings = allBookings.filter((b: any) =>
      b.check_in <= today && b.check_out > today && !((b.platform || '').toLowerCase().includes('block'))
    );

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
        meta: `${b.num_guests || '?'} guests · ${fmtDate(b.check_in)}–${fmtDate(b.check_out)}`,
        rate: b.price_per_night ? fmtMoney(b.price_per_night) : undefined,
        total: b.total_price ? `${fmtMoney(b.total_price)} total` : undefined,
        isVacant: false,
      });
    });

    // Add vacant properties
    visibleProps.forEach((p) => {
      if (!stayingPropIds.has(p.id)) {
        // Find next check-in for this property
        const nextCheckIn = allBookings.find((b: any) =>
          b.property_id === p.id && b.check_in > today && !((b.platform || '').toLowerCase().includes('block'))
        );
        stayItems.push({
          id: -p.id,
          property: p.name,
          platform: '',
          guestName: 'Empty',
          meta: nextCheckIn ? `Next check-in ${fmtDate(nextCheckIn.check_in)}` : 'No upcoming bookings',
          isVacant: true,
          statusText: nextCheckIn ? `Check-in ${relativeDay(nextCheckIn.check_in)}` : 'Available',
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
        detail: `${b.property_name || ''} · ${b.num_guests || '?'} guests`,
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

    if (onDataChanged) onDataChanged();

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}
