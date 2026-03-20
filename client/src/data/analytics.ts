// Analytics data — populated by loadAnalyticsData() from /api/analytics/data

function fmtMoney(n: number): string {
  if (n >= 1000000) return `R ${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `R ${Math.round(n).toLocaleString()}`;
  return `R ${n}`;
}

function fmtMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(m, 10) - 1;
  const shortYear = y.slice(2);
  // Show year on Jan or first item
  return mi === 0 ? `${months[mi]} '${shortYear}` : months[mi];
}

export let overviewKPIs: { label: string; value: string; trend: string; trendDetail: string; isPositive: boolean }[] = [];
export let revenueData: { month: string; current: number; previous: number }[] = [];
export let revenueByProperty: { name: string; revenue: number; percentage: number }[] = [];
export let propertyPerformance: { name: string; revenue: string; occupancy: number; adr: string; avgStay: string; bookings: number; rating: string; topPlatform: string }[] = [];
export let channelMixData: { name: string; value: number; color: string }[] = [];
export let occupancyTrendData: { month: string; rate: number }[] = [];
export let rateTrendData: { month: string; adr: number; revpar: number }[] = [];
export let guestCountries: { country: string; percentage: number }[] = [];
export let recentReviews: { id: number; guest: string; property: string; rating: number; date: string; text: string }[] = [];

const CHANNEL_COLORS: Record<string, string> = {
  'Airbnb': '#FF385C',
  'Booking.com': '#003580',
  'Direct': '#717171',
  'VRBO': '#3B5998',
};

export async function loadAnalyticsData(): Promise<void> {
  try {
    // Fetch last 12 months of data
    const now = new Date();
    const fromDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [dataRes, reviewsRes] = await Promise.all([
      fetch(`/api/analytics/data?property_id=all&from=${from}&to=${to}`, { credentials: 'same-origin' }),
      fetch('/api/analytics/reviews', { credentials: 'same-origin' }),
    ]);

    if (!dataRes.ok) return;
    const d = await dataRes.json();

    // --- Overview KPIs ---
    const totalRevenue = (d.revenue_timeline || []).reduce((s: number, m: any) => s + (m.total || 0), 0);
    const totalBookings = (d.revenue_timeline || []).reduce((s: number, m: any) => s + (m.bookings || 0), 0);
    const totalNights = (d.revenue_timeline || []).reduce((s: number, m: any) => s + (m.nights || 0), 0);
    const avgOccupancy = (d.occupancy_timeline || []).length > 0
      ? Math.round((d.occupancy_timeline as any[]).reduce((s: number, o: any) => s + (o.occupancy_rate || 0), 0) / d.occupancy_timeline.length)
      : 0;
    const avgRate = totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0;
    const avgStay = totalBookings > 0 ? (totalNights / totalBookings).toFixed(1) : '0';

    overviewKPIs = [
      { label: 'Total Revenue', value: fmtMoney(totalRevenue), trend: '', trendDetail: 'selected period', isPositive: true },
      { label: 'Avg Occupancy', value: `${avgOccupancy}%`, trend: '', trendDetail: 'across properties', isPositive: avgOccupancy >= 50 },
      { label: 'Avg Nightly Rate', value: fmtMoney(avgRate), trend: '', trendDetail: 'ADR', isPositive: true },
      { label: 'Avg Stay', value: `${avgStay} nights`, trend: '', trendDetail: 'per booking', isPositive: true },
      { label: 'Total Bookings', value: String(totalBookings), trend: '', trendDetail: 'confirmed', isPositive: true },
    ];

    // --- Revenue timeline (current only, no previous year data from API) ---
    revenueData = (d.revenue_timeline || []).map((m: any) => ({
      month: fmtMonthLabel(m.month),
      current: Math.round(m.total || 0),
      previous: 0,
    }));

    // --- Revenue by property ---
    const propRevEntries = Object.values(d.revenue_by_property || {}) as any[];
    const totalPropRev = propRevEntries.reduce((s, p) => s + (p.total || 0), 0);
    revenueByProperty = propRevEntries
      .sort((a, b) => b.total - a.total)
      .map((p) => ({
        name: p.property,
        revenue: Math.round(p.total),
        percentage: totalPropRev > 0 ? Math.round((p.total / totalPropRev) * 100) : 0,
      }));

    // --- Property performance table ---
    propertyPerformance = propRevEntries
      .sort((a, b) => b.total - a.total)
      .map((p) => {
        const propOcc = (d.occupancy_timeline || []).filter((o: any) => o.property_id === p.property_id);
        const avgPropOcc = propOcc.length > 0
          ? Math.round(propOcc.reduce((s: number, o: any) => s + (o.occupancy_rate || 0), 0) / propOcc.length)
          : 0;
        const adr = p.nights > 0 ? Math.round(p.total / p.nights) : 0;
        const avg = p.bookings > 0 ? (p.nights / p.bookings).toFixed(1) : '0';
        return {
          name: p.property,
          revenue: fmtMoney(Math.round(p.total)),
          occupancy: avgPropOcc,
          adr: fmtMoney(adr),
          avgStay: `${avg} nights`,
          bookings: p.bookings,
          rating: '—',
          topPlatform: p.top_platform || '—',
        };
      });

    // --- Channel mix ---
    const channels = Object.values(d.channel_stats || {}) as any[];
    const totalChBookings = channels.reduce((s, c) => s + (c.bookings || 0), 0);
    channelMixData = channels
      .sort((a, b) => b.bookings - a.bookings)
      .map((c) => ({
        name: c.channel,
        value: totalChBookings > 0 ? Math.round((c.bookings / totalChBookings) * 100) : 0,
        color: CHANNEL_COLORS[c.channel] || '#999999',
      }));

    // --- Occupancy trend ---
    // Aggregate across properties per month
    const occByMonth: Record<string, { total: number; count: number }> = {};
    (d.occupancy_timeline || []).forEach((o: any) => {
      if (!occByMonth[o.month]) occByMonth[o.month] = { total: 0, count: 0 };
      occByMonth[o.month].total += o.occupancy_rate || 0;
      occByMonth[o.month].count += 1;
    });
    occupancyTrendData = Object.entries(occByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month: fmtMonthLabel(month),
        rate: Math.round(v.total / v.count),
      }));

    // --- Rate trend (ADR + RevPAR) ---
    const adrTimeline = d.adr_timeline || [];
    rateTrendData = (d.revenue_timeline || []).map((m: any) => {
      const adrEntry = adrTimeline.find((a: any) => a.month === m.month);
      const adr = adrEntry?.adr || (m.nights > 0 ? Math.round(m.total / m.nights) : 0);
      // Simple RevPAR approximation: revenue / days_in_month / num_properties
      const [y, mo] = m.month.split('-').map(Number);
      const daysInMonth = new Date(y, mo, 0).getDate();
      const numProps = revenueByProperty.length || 1;
      const revpar = Math.round(m.total / (daysInMonth * numProps));
      return {
        month: fmtMonthLabel(m.month),
        adr,
        revpar,
      };
    });

    // --- Guest countries (from API if available, else empty) ---
    if (d.guest_countries && d.guest_countries.length > 0) {
      const totalGuests = d.guest_countries.reduce((s: number, g: any) => s + (g.count || 0), 0);
      guestCountries = d.guest_countries.map((g: any) => ({
        country: g.country || 'Unknown',
        percentage: totalGuests > 0 ? Math.round((g.count / totalGuests) * 100) : 0,
      }));
    } else {
      guestCountries = [];
    }

    // --- Reviews ---
    if (reviewsRes.ok) {
      const revData = await reviewsRes.json();
      const revArray = Array.isArray(revData) ? revData : revData.reviews || [];
      recentReviews = revArray.slice(0, 10).map((r: any) => ({
        id: r.id,
        guest: r.guest_name || 'Anonymous',
        property: r.property_name || '',
        rating: r.rating || 0,
        date: r.date ? new Date(r.date).toLocaleDateString('en-ZA', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
        text: r.comment || '',
      }));
    }

  } catch (err) {
    console.error('Failed to load analytics data:', err);
  }
}
