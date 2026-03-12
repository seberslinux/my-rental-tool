/* analytics.js — uses globals from shared.js:
   getSelectedPropertyId, platformBadge, normalizePlatform, fmtNum, fmtMonth, escHtml */

let data = null;

const COLORS = ['#1a1a2e', '#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#6a4c93', '#f4845f'];
const CHANNEL_COLORS = { Airbnb: '#ff585d', 'Booking.com': '#003b95', VRBO: '#00875a', Direct: '#888' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ───── API helper ───── */

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

/* ───── Date Range State ───── */

function getDateRange() {
  const preset = localStorage.getItem('analyticsDateRange') || '12m';
  const now = new Date();
  let from, to;

  to = now.toISOString().slice(0, 10);

  if (preset === 'custom') {
    from = localStorage.getItem('analyticsCustomFrom') || '';
    to = localStorage.getItem('analyticsCustomTo') || to;
    return { from, to };
  }

  const d = new Date(now);
  switch (preset) {
    case '3m':  d.setMonth(d.getMonth() - 3); break;
    case '6m':  d.setMonth(d.getMonth() - 6); break;
    case '12m': d.setMonth(d.getMonth() - 12); break;
    case '24m': d.setMonth(d.getMonth() - 24); break;
    case 'ytd': d.setMonth(0); d.setDate(1); break;
    default:    d.setMonth(d.getMonth() - 12); break;
  }
  from = d.toISOString().slice(0, 10);
  return { from, to };
}

function setDateRange(preset) {
  localStorage.setItem('analyticsDateRange', preset);
  if (preset === 'custom') {
    const fromInput = document.getElementById('customFrom');
    const toInput = document.getElementById('customTo');
    if (fromInput) localStorage.setItem('analyticsCustomFrom', fromInput.value);
    if (toInput) localStorage.setItem('analyticsCustomTo', toInput.value);
  }
  loadAnalytics();
}

function initDateRangeBar() {
  const bar = document.getElementById('dateRangeBar');
  if (!bar) return;

  const current = localStorage.getItem('analyticsDateRange') || '12m';
  const buttons = bar.querySelectorAll('button[data-range]');
  const customInputs = bar.querySelector('.custom-date-inputs');

  buttons.forEach(btn => {
    const range = btn.getAttribute('data-range');
    if (range === current) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (range === 'custom') {
        if (customInputs) customInputs.style.display = 'flex';
      } else {
        if (customInputs) customInputs.style.display = 'none';
        setDateRange(range);
      }
    });
  });

  // Show custom inputs if that's the current preset
  if (current === 'custom' && customInputs) {
    customInputs.style.display = 'flex';
    const fromInput = document.getElementById('customFrom');
    const toInput = document.getElementById('customTo');
    if (fromInput) fromInput.value = localStorage.getItem('analyticsCustomFrom') || '';
    if (toInput) toInput.value = localStorage.getItem('analyticsCustomTo') || '';
  }

  // Custom apply button
  const applyBtn = bar.querySelector('.custom-apply-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => setDateRange('custom'));
  }
}

/* ───── Property filter ───── */

window.addEventListener('propertyChanged', () => {
  loadAnalytics();
});

/* ───── Data Loading ───── */

async function loadAnalytics() {
  try {
    const propParam = getPropertyIdsParam();
    const { from, to } = getDateRange();
    const qs = `property_id=${encodeURIComponent(propParam)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const [analyticsData, seasonalityData, competitorsData, marketData, properties] = await Promise.all([
      api(`/api/analytics/data?${qs}`),
      api(`/api/analytics/seasonality?${qs}`),
      api(`/api/analytics/competitors?property_id=${encodeURIComponent(propParam)}`),
      api('/api/analytics/market-position'),
      api('/api/properties'),
    ]);

    data = analyticsData;
    data._properties = properties;
    data._seasonality = seasonalityData;
    data._competitors = competitorsData;
    data._market = marketData;
    renderAll();
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

/* ───── Tab Switching ───── */

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  btn.classList.add('active');
}

/* ───── Render All ───── */

function renderAll() {
  if (!data) return;
  renderKPIs();
  renderOverviewCharts();
  renderRevenueTab();
  renderOccupancyTab();
  renderPricingTab();
  renderChannelsTab();
  renderPatternsTab();
  renderSeasonalityTab();
  renderMarketTab();
  renderReviewsTab();
  renderInsightsTab();
}

/* ───── Sync Actions ───── */

async function syncHistory() {
  const status = document.getElementById('syncStatus');
  status.textContent = 'Syncing full history...';
  try {
    const res = await api('/api/analytics/sync-history', { method: 'POST' });
    status.textContent = `Synced ${res.synced} bookings`;
    loadAnalytics();
  } catch (err) {
    status.textContent = 'Sync failed: ' + err.message;
  }
}

async function syncRates() {
  const status = document.getElementById('syncStatus');
  status.textContent = 'Syncing rates...';
  try {
    const res = await api('/api/analytics/sync-rates', { method: 'POST' });
    status.textContent = `Synced ${res.synced} rate entries`;
    loadAnalytics();
  } catch (err) {
    status.textContent = 'Sync failed: ' + err.message;
  }
}

/* ───── KPIs ───── */

function renderKPIs() {
  const s = data.summary;
  const kpis = [
    { value: `R ${fmtNum(s.total_revenue)}`, label: 'Total Revenue', sub: `${s.total_bookings} bookings` },
    { value: `R ${fmtNum(s.avg_adr)}`, label: 'Avg Daily Rate', sub: 'per booked night' },
    { value: `${s.avg_los}`, label: 'Avg Stay Length', sub: 'nights' },
    { value: `${s.avg_lead_time}d`, label: 'Avg Lead Time', sub: 'days before check-in' },
    { value: `${s.cancellation_rate}%`, label: 'Cancellation Rate', sub: 'across all channels' },
    { value: `R ${fmtNum(s.future_revenue)}`, label: 'Future Pipeline', sub: `${s.future_bookings} upcoming bookings` },
    { value: `${s.total_nights}`, label: 'Total Nights Sold', sub: `across ${s.properties_count} properties` },
  ];

  document.getElementById('kpiGrid').innerHTML = kpis
    .map(k => `<div class="kpi-card"><div class="kpi-value">${k.value}</div><div class="kpi-label">${k.label}</div><div class="kpi-sub">${k.sub}</div></div>`)
    .join('');
}

/* ───── Overview Charts ───── */

function renderOverviewCharts() {
  // Revenue timeline
  const rev = data.revenue_timeline.slice(-12);
  renderBarChart('revenueChart', rev, 'month', 'total', '#1a1a2e', v => 'R ' + fmtNum(v), fmtMonth);

  // Occupancy overview — aggregate across properties per month
  const occByMonth = {};
  for (const o of data.occupancy_timeline) {
    if (!occByMonth[o.month]) occByMonth[o.month] = { month: o.month, total_nights: 0, total_days: 0 };
    occByMonth[o.month].total_nights += o.nights;
    occByMonth[o.month].total_days += o.days_in_month;
  }
  const occAgg = Object.values(occByMonth)
    .map(o => ({ month: o.month, rate: o.total_days > 0 ? Math.round((o.total_nights / o.total_days) * 100) : 0 }))
    .slice(-12);
  renderBarChart('occupancyOverviewChart', occAgg, 'month', 'rate', '#457b9d', v => v + '%', fmtMonth);

  // Property revenue
  const propRev = data.revenue_by_property.sort((a, b) => b.total - a.total);
  renderBarChart('propertyRevenueChart', propRev, 'property', 'total', null, v => 'R ' + fmtNum(v), null, true);
}

/* ───── Revenue Tab ───── */

function forecastRevenue(monthlyData, targetMonth) {
  // targetMonth: 1-12
  const sameMonthHistorical = monthlyData.filter(m => {
    const mo = parseInt(m.month.split('-')[1]);
    return mo === targetMonth;
  });
  if (sameMonthHistorical.length >= 1) {
    return sameMonthHistorical.reduce((s, m) => s + m.revenue, 0) / sameMonthHistorical.length;
  }
  const last3 = monthlyData.slice(-3);
  return last3.reduce((s, m) => s + m.revenue, 0) / Math.max(last3.length, 1);
}

function buildSeasonalPredictions() {
  const monthlyData = data.revenue_timeline.map(r => ({ month: r.month, revenue: r.total, bookings: r.bookings, nights: r.nights }));
  const predictions = [];
  if (monthlyData.length < 1) return predictions;
  const today = new Date();
  for (let i = 1; i <= 3; i++) {
    const futureDate = new Date(today);
    futureDate.setMonth(futureDate.getMonth() + i);
    const mo = futureDate.getMonth() + 1;
    const month = futureDate.toISOString().substring(0, 7);
    const predicted_revenue = Math.round(forecastRevenue(monthlyData, mo));
    // Estimate bookings/nights using same seasonal approach
    const sameMonth = monthlyData.filter(m => parseInt(m.month.split('-')[1]) === mo);
    let predicted_bookings, predicted_nights;
    if (sameMonth.length >= 1) {
      predicted_bookings = Math.round(sameMonth.reduce((s, m) => s + m.bookings, 0) / sameMonth.length);
      predicted_nights = Math.round(sameMonth.reduce((s, m) => s + m.nights, 0) / sameMonth.length);
    } else {
      const last3 = monthlyData.slice(-3);
      predicted_bookings = Math.round(last3.reduce((s, m) => s + m.bookings, 0) / Math.max(last3.length, 1));
      predicted_nights = Math.round(last3.reduce((s, m) => s + m.nights, 0) / Math.max(last3.length, 1));
    }
    predictions.push({ month, predicted_revenue, predicted_bookings, predicted_nights });
  }
  return predictions;
}

function renderRevenueTab() {
  // Revenue with seasonal predictions
  const rev = data.revenue_timeline.slice(-12).map(r => ({ ...r, predicted: false }));
  const seasonalPreds = buildSeasonalPredictions();
  for (const p of seasonalPreds) {
    rev.push({ month: p.month, total: p.predicted_revenue, predicted: true });
  }
  renderBarChartWithPredictions('revenuePredictionChart', rev, 'month', 'total', fmtMonth);

  // ADR
  const adr = data.adr_timeline.slice(-12);
  renderBarChart('adrChart', adr, 'month', 'adr', '#2a9d8f', v => 'R ' + v, fmtMonth);

  // RevPAR
  const revpar = data.revpar_timeline.slice(-12);
  renderBarChart('revparChart', revpar, 'month', 'revpar', '#6a4c93', v => 'R ' + v, fmtMonth);

  // Revenue table
  const table = document.getElementById('revenueTable');
  const rows = data.revenue_by_property.sort((a, b) => b.total - a.total);
  table.innerHTML = `
    <thead><tr><th>Property</th><th>Revenue</th><th>Bookings</th><th>Nights</th><th>ADR</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${escHtml(r.property)}</td>
      <td>R ${fmtNum(r.total)}</td>
      <td>${r.bookings}</td>
      <td>${r.nights}</td>
      <td>R ${r.nights > 0 ? fmtNum(Math.round(r.total / r.nights)) : 0}</td>
    </tr>`).join('')}</tbody>`;
}

/* ───── Occupancy Tab ───── */

function renderOccupancyTab() {
  const months = [...new Set(data.occupancy_timeline.map(o => o.month))].sort().slice(-12);
  const container = document.getElementById('occupancyDetailChart');
  const propNames = [...new Set(data.occupancy_timeline.map(o => o.property))];

  if (months.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;">No occupancy data. Sync bookings first.</div>';
    return;
  }

  const max = 100;
  container.innerHTML = months
    .map(month => {
      const entries = data.occupancy_timeline.filter(o => o.month === month);
      const bars = entries
        .map((e, i) => {
          const h = Math.max(2, (e.occupancy_rate / max) * 100);
          const color = COLORS[propNames.indexOf(e.property) % COLORS.length];
          return `<div class="bar" style="height:${h}%;background:${color};width:${100 / entries.length}%;max-width:25px;" title="${escHtml(e.property)}: ${e.occupancy_rate}%"></div>`;
        })
        .join('');
      return `<div class="bar-col"><div style="display:flex;align-items:flex-end;gap:1px;height:100%;width:100%;justify-content:center;">${bars}</div><div class="bar-label">${fmtMonth(month)}</div></div>`;
    })
    .join('');

  // Legend
  const legend = propNames.map((p, i) => `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px;font-size:0.8rem;"><span style="width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};display:inline-block;"></span>${escHtml(p)}</span>`).join('');
  container.insertAdjacentHTML('afterend', `<div style="margin-top:0.5rem;">${legend}</div>`);

  // Occupancy table
  const table = document.getElementById('occupancyTable');
  table.innerHTML = `
    <thead><tr><th>Month</th><th>Property</th><th>Nights Booked</th><th>Days in Month</th><th>Occupancy</th></tr></thead>
    <tbody>${data.occupancy_timeline.slice(-36).map(o => `<tr>
      <td>${fmtMonth(o.month)}</td><td>${escHtml(o.property)}</td><td>${o.nights}</td><td>${o.days_in_month}</td>
      <td><span style="color:${o.occupancy_rate >= 70 ? '#00aa44' : o.occupancy_rate >= 40 ? '#ff9900' : '#cc0000'}">${o.occupancy_rate}%</span></td>
    </tr>`).join('')}</tbody>`;
}

/* ───── Pricing Tab ───── */

function renderPricingTab() {
  const container = document.getElementById('priceTrendsContainer');
  const trends = data.price_trends;

  if (trends.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;">No rate data. Click "Sync Rates" to pull current rates from Smoobu.</div>';
    return;
  }

  // Group by property
  const byProperty = {};
  for (const t of trends) {
    if (!byProperty[t.property_name]) byProperty[t.property_name] = [];
    byProperty[t.property_name].push(t);
  }

  container.innerHTML = Object.entries(byProperty)
    .map(([name, rates], idx) => {
      const chartId = `priceChart-${idx}`;
      return `
      <div style="margin-bottom:1.5rem;">
        <h4>${escHtml(name)}</h4>
        <div class="bar-chart" style="height:120px;" id="${chartId}"></div>
      </div>`;
    })
    .join('');

  // Render each property's rate chart
  Object.entries(byProperty).forEach(([name, rates], idx) => {
    const chartEl = document.getElementById(`priceChart-${idx}`);
    const maxPrice = Math.max(...rates.map(r => r.price), 1);
    chartEl.innerHTML = rates
      .map(r => {
        const h = Math.max(2, (r.price / maxPrice) * 100);
        const color = r.available ? COLORS[idx % COLORS.length] : '#ddd';
        const day = r.date.substring(5);
        return `<div class="bar-col"><div class="bar-value">R${Math.round(r.price)}</div><div class="bar" style="height:${h}%;background:${color};" title="${r.date}: R${r.price}${r.available ? '' : ' (unavailable)'}"></div><div class="bar-label">${day}</div></div>`;
      })
      .join('');
  });

  // Price comparison: actual booking PPN vs base price
  const propData = data._properties.filter(p => p.base_price > 0);
  const propRevData = data.revenue_by_property;
  const comparison = propData.map(p => {
    const rev = propRevData.find(r => r.property_id === p.id);
    const avgPPN = rev && rev.nights > 0 ? Math.round(rev.total / rev.nights) : 0;
    return { property: p.name, base_price: p.base_price, avg_ppn: avgPPN };
  });

  const chart = document.getElementById('priceComparisonChart');
  if (comparison.length === 0) {
    chart.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;">Set base prices in Properties page first.</div>';
    return;
  }

  const maxP = Math.max(...comparison.flatMap(c => [c.base_price, c.avg_ppn]), 1);
  chart.innerHTML = comparison
    .map(c => {
      const hBase = Math.max(2, (c.base_price / maxP) * 100);
      const hActual = Math.max(2, (c.avg_ppn / maxP) * 100);
      return `<div class="bar-col" style="flex:2;">
        <div style="display:flex;align-items:flex-end;gap:2px;height:100%;justify-content:center;">
          <div><div class="bar-value">R${c.base_price}</div><div class="bar" style="height:${hBase}%;background:#ccc;width:20px;" title="Base: R${c.base_price}"></div></div>
          <div><div class="bar-value">R${c.avg_ppn}</div><div class="bar" style="height:${hActual}%;background:${c.avg_ppn >= c.base_price ? '#00aa44' : '#cc0000'};width:20px;" title="Actual ADR: R${c.avg_ppn}"></div></div>
        </div>
        <div class="bar-label">${escHtml(c.property)}</div>
      </div>`;
    })
    .join('');
}

/* ───── Channels Tab ───── */

function renderChannelsTab() {
  const ch = data.channel_stats;
  renderBarChart('channelRevenueChart', ch, 'channel', 'revenue', null, v => 'R ' + fmtNum(v), null, true);
  renderBarChart('channelBookingsChart', ch, 'channel', 'bookings', null, v => v + ' bookings', null, true);

  // Channel table
  document.getElementById('channelTable').innerHTML = `
    <thead><tr><th>Channel</th><th>Revenue</th><th>Bookings</th><th>Nights</th><th>Avg PPN</th><th>Avg Stay</th><th>Avg Lead Time</th></tr></thead>
    <tbody>${ch.map(c => `<tr>
      <td><span style="color:${CHANNEL_COLORS[c.channel] || '#333'};font-weight:600;">${escHtml(c.channel)}</span></td>
      <td>R ${fmtNum(c.revenue)}</td><td>${c.bookings}</td><td>${c.nights}</td>
      <td>R ${c.avg_ppn}</td><td>${c.avg_los} nights</td><td>${c.avg_lead_time} days</td>
    </tr>`).join('')}</tbody>`;

  // Cancellations
  document.getElementById('cancellationTable').innerHTML = `
    <thead><tr><th>Channel</th><th>Total</th><th>Cancelled</th><th>Rate</th></tr></thead>
    <tbody>${data.cancellations_by_channel.map(c => `<tr>
      <td>${escHtml(c.channel)}</td><td>${c.total}</td><td>${c.cancelled}</td>
      <td><span style="color:${c.rate > 15 ? '#cc0000' : '#333'}">${c.rate}%</span></td>
    </tr>`).join('')}</tbody>`;
}

/* ───── Patterns Tab ───── */

function renderPatternsTab() {
  // Day of week
  const dow = data.dow_stats;
  renderBarChart('dowChart', dow, 'day', 'bookings_starting', '#457b9d', v => v + ' check-ins', d => DAY_NAMES[d]);

  // Length of stay
  const los = data.los_distribution.sort((a, b) => {
    const aVal = a.nights === '7+' ? 7 : parseInt(a.nights);
    const bVal = b.nights === '7+' ? 7 : parseInt(b.nights);
    return aVal - bVal;
  });
  renderBarChart('losChart', los, 'nights', 'count', '#2a9d8f', v => v + ' bookings', n => n + 'n');

  // Lead time
  const lt = data.lead_time_distribution;
  renderBarChart('leadTimeChart', lt, 'bucket', 'count', '#e63946', v => v + ' bookings');

  // Lead time table
  document.getElementById('leadTimeTable').innerHTML = `
    <thead><tr><th>Lead Time</th><th>Bookings</th><th>Avg PPN</th></tr></thead>
    <tbody>${lt.map(l => `<tr>
      <td>${escHtml(l.bucket)}</td><td>${l.count}</td><td>R ${l.avg_ppn}</td>
    </tr>`).join('')}</tbody>`;
}

/* ───── Seasonality Tab (NEW) ───── */

function renderSeasonalityTab() {
  const seasonality = data._seasonality;
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Heatmap
  const heatmapEl = document.getElementById('seasonalityHeatmap');
  if (heatmapEl) {
    if (seasonality && seasonality.monthly && seasonality.monthly.length > 0) {
      const monthly = seasonality.monthly;
      const occValues = monthly.map(m => m.avg_occupancy || 0);
      const minOcc = Math.min(...occValues);
      const maxOcc = Math.max(...occValues, 1);

      heatmapEl.innerHTML = MONTH_NAMES.map((name, i) => {
        const monthData = monthly.find(m => m.month === i + 1);
        const occ = monthData ? (monthData.avg_occupancy || 0) : 0;
        const intensity = maxOcc > minOcc ? (occ - minOcc) / (maxOcc - minOcc) : 0.5;
        const lightness = Math.round(85 - intensity * 50);
        const bg = `hsl(140, 50%, ${lightness}%)`;
        const textColor = lightness < 50 ? '#fff' : '#333';
        return `<div style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:70px;height:60px;background:${bg};color:${textColor};border-radius:6px;margin:3px;font-size:0.85rem;">
          <strong>${name}</strong>
          <span>${Math.round(occ)}%</span>
        </div>`;
      }).join('');
    } else {
      heatmapEl.innerHTML = '<div style="color:#999;padding:1rem;">No seasonality data available.</div>';
    }
  }

  // Revenue by month chart
  const revChartEl = document.getElementById('seasonalityRevenueChart');
  if (revChartEl && seasonality && seasonality.monthly) {
    const items = seasonality.monthly.map(m => ({
      label: MONTH_NAMES[m.month - 1] || m.month,
      value: m.avg_revenue || 0,
    }));
    renderBarChart('seasonalityRevenueChart', items, 'label', 'value', '#2a9d8f', v => 'R ' + fmtNum(v));
  }

  // ADR by month chart
  const adrChartEl = document.getElementById('seasonalityAdrChart');
  if (adrChartEl && seasonality && seasonality.monthly) {
    const items = seasonality.monthly.map(m => ({
      label: MONTH_NAMES[m.month - 1] || m.month,
      value: m.avg_adr || 0,
    }));
    renderBarChart('seasonalityAdrChart', items, 'label', 'value', '#6a4c93', v => 'R ' + fmtNum(v));
  }

  // Peak analysis
  const peakEl = document.getElementById('peakAnalysis');
  if (peakEl && seasonality && seasonality.monthly && seasonality.monthly.length > 0) {
    const monthly = seasonality.monthly;
    const annualAvg = monthly.reduce((s, m) => s + (m.avg_occupancy || 0), 0) / monthly.length;
    const sorted = [...monthly].sort((a, b) => (b.avg_occupancy || 0) - (a.avg_occupancy || 0));
    const top3 = sorted.slice(0, 3);
    const bottom3 = sorted.slice(-3).reverse();

    peakEl.innerHTML = `
      <div style="display:flex;gap:2rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <h4 style="color:#00aa44;">Peak Months</h4>
          ${top3.map(m => {
            const delta = ((m.avg_occupancy || 0) - annualAvg).toFixed(1);
            return `<div style="padding:0.4rem 0;border-bottom:1px solid #eee;">
              <strong>${MONTH_NAMES[m.month - 1]}</strong>: ${Math.round(m.avg_occupancy || 0)}%
              <span style="color:#00aa44;margin-left:0.5rem;">+${delta}% vs avg</span>
            </div>`;
          }).join('')}
        </div>
        <div style="flex:1;min-width:200px;">
          <h4 style="color:#cc0000;">Off-Peak Months</h4>
          ${bottom3.map(m => {
            const delta = ((m.avg_occupancy || 0) - annualAvg).toFixed(1);
            return `<div style="padding:0.4rem 0;border-bottom:1px solid #eee;">
              <strong>${MONTH_NAMES[m.month - 1]}</strong>: ${Math.round(m.avg_occupancy || 0)}%
              <span style="color:#cc0000;margin-left:0.5rem;">${delta}% vs avg</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div style="margin-top:1rem;color:#666;font-size:0.9rem;">Annual average occupancy: <strong>${Math.round(annualAvg)}%</strong></div>`;
  } else if (peakEl) {
    peakEl.innerHTML = '<div style="color:#999;">Not enough data for peak analysis.</div>';
  }

  // Booking window
  const bookingWindowEl = document.getElementById('bookingWindowAnalysis');
  if (bookingWindowEl && seasonality && seasonality.booking_window) {
    const bw = seasonality.booking_window;
    bookingWindowEl.innerHTML = `
      <div style="display:flex;gap:2rem;flex-wrap:wrap;">
        <div class="kpi-card" style="flex:1;min-width:150px;">
          <div class="kpi-value">${bw.peak_lead_time || 0}d</div>
          <div class="kpi-label">Peak Months Avg Lead Time</div>
        </div>
        <div class="kpi-card" style="flex:1;min-width:150px;">
          <div class="kpi-value">${bw.offpeak_lead_time || 0}d</div>
          <div class="kpi-label">Off-Peak Months Avg Lead Time</div>
        </div>
      </div>`;
  } else if (bookingWindowEl) {
    bookingWindowEl.innerHTML = '<div style="color:#999;">No booking window data.</div>';
  }
}

/* ───── Market Tab (NEW) ───── */

function renderMarketTab() {
  const market = data._market;
  const competitors = data._competitors;

  // Market position cards
  const positionEl = document.getElementById('marketPositionCards');
  if (positionEl) {
    if (market && market.positions && market.positions.length > 0) {
      positionEl.innerHTML = market.positions.map(pos => {
        const diff = (pos.your_adr || 0) - (pos.market_avg || 0);
        let position, color;
        if (Math.abs(diff) < 5) {
          position = 'At Market';
          color = '#457b9d';
        } else if (diff > 0) {
          position = 'Above Market';
          color = '#00aa44';
        } else {
          position = 'Below Market';
          color = '#cc0000';
        }
        return `<div class="kpi-card" style="border-left:4px solid ${color};">
          <div style="font-weight:600;margin-bottom:0.5rem;">${escHtml(pos.property_name || 'Property')}</div>
          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
            <div><span style="color:#666;font-size:0.85rem;">Your ADR</span><br><strong>R ${fmtNum(pos.your_adr || 0)}</strong></div>
            <div><span style="color:#666;font-size:0.85rem;">Market Avg</span><br><strong>R ${fmtNum(pos.market_avg || 0)}</strong></div>
            <div><span style="color:${color};font-weight:600;font-size:0.85rem;">${position}</span><br><strong style="color:${color};">${diff >= 0 ? '+' : ''}R ${fmtNum(Math.abs(diff))}</strong></div>
          </div>
        </div>`;
      }).join('');
    } else {
      positionEl.innerHTML = '<div style="color:#999;padding:1rem;">No market position data available. Add competitors to see your market position.</div>';
    }
  }

  // Competitors list
  const compEl = document.getElementById('competitorsList');
  if (compEl) {
    if (competitors && competitors.length > 0) {
      compEl.innerHTML = `
        <table class="data-table" style="width:100%;">
          <thead><tr><th>Name</th><th>Platform</th><th>ADR</th><th>Property</th><th>Actions</th></tr></thead>
          <tbody>${competitors.map(c => `<tr>
            <td>${escHtml(c.name)}</td>
            <td>${platformBadge(c.platform)}</td>
            <td>R ${fmtNum(c.adr || 0)}</td>
            <td>${escHtml(c.property_name || '')}</td>
            <td>
              <button class="btn btn-sm" onclick="openCompetitorModal(${c.id})">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteCompetitor(${c.id})">Delete</button>
            </td>
          </tr>`).join('')}</tbody>
        </table>`;
    } else {
      compEl.innerHTML = '<div style="color:#999;padding:1rem;text-align:center;">No competitors added yet. Click "Add Competitor" to track your competition.</div>';
    }
  }
}

/* ───── Reviews Tab (Enhanced) ───── */

function renderReviewsTab() {
  // Property select
  const select = document.getElementById('reviewPropertySelect');
  if (select) {
    const existingOpts = select.querySelectorAll('option');
    if (existingOpts.length <= 1) {
      select.innerHTML = (data._properties || [])
        .map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`)
        .join('');
    }
  }

  // Ensure VRBO is in the platform select
  const platformSelect = document.getElementById('reviewPlatformSelect');
  if (platformSelect) {
    const hasVrbo = [...platformSelect.options].some(o => o.value === 'VRBO');
    if (!hasVrbo) {
      const opt = document.createElement('option');
      opt.value = 'VRBO';
      opt.textContent = 'VRBO';
      platformSelect.appendChild(opt);
    }
  }

  // Summary table
  const rbp = data.reviews_by_property;
  document.getElementById('reviewSummaryTable').innerHTML = rbp.length === 0
    ? '<tbody><tr><td>No reviews yet. Add reviews below.</td></tr></tbody>'
    : `<thead><tr><th>Property</th><th>Reviews</th><th>Avg Rating</th></tr></thead>
       <tbody>${rbp.map(r => `<tr>
         <td>${escHtml(r.property)}</td><td>${r.count}</td>
         <td>${renderStars(r.avg_rating)} ${r.avg_rating}/5</td>
       </tr>`).join('')}</tbody>`;

  // Sentiment summary
  const reviews = data.recent_reviews || [];
  const sentimentSummaryEl = document.getElementById('sentimentSummary');
  if (sentimentSummaryEl && reviews.length > 0) {
    let positive = 0, neutral = 0, negative = 0;
    reviews.forEach(r => {
      const s = getSentiment(r.rating);
      if (s === 'positive') positive++;
      else if (s === 'negative') negative++;
      else neutral++;
    });
    sentimentSummaryEl.innerHTML = `
      <div style="display:flex;gap:1rem;flex-wrap:wrap;">
        <div style="padding:0.5rem 1rem;background:#e6f9e6;border-radius:6px;color:#00aa44;font-weight:600;">Positive: ${positive}</div>
        <div style="padding:0.5rem 1rem;background:#fff3e0;border-radius:6px;color:#ff9900;font-weight:600;">Neutral: ${neutral}</div>
        <div style="padding:0.5rem 1rem;background:#fde8e8;border-radius:6px;color:#cc0000;font-weight:600;">Negative: ${negative}</div>
      </div>`;
  } else if (sentimentSummaryEl) {
    sentimentSummaryEl.innerHTML = '';
  }

  // Reviews list with sentiment badges
  const reviewsListEl = document.getElementById('reviewsList');
  reviewsListEl.innerHTML = reviews.length === 0
    ? ''
    : `<div class="chart-container"><h3>Recent Reviews</h3>${reviews.map(r => {
        const sentiment = getSentiment(r.rating);
        const sentimentColor = sentiment === 'positive' ? '#00aa44' : sentiment === 'negative' ? '#cc0000' : '#ff9900';
        const sentimentBg = sentiment === 'positive' ? '#e6f9e6' : sentiment === 'negative' ? '#fde8e8' : '#fff3e0';
        return `<div class="review-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>${escHtml(r.property_name)}</strong>
              ${platformBadge(r.platform)}
              <span style="background:${sentimentBg};color:${sentimentColor};padding:2px 8px;border-radius:10px;font-size:0.75rem;margin-left:0.3rem;">${sentiment}</span>
            </div>
            <div>
              <span class="stars">${renderStars(r.rating)}</span>
              <button class="btn btn-danger btn-sm" style="margin-left:0.5rem;" onclick="deleteReview(${r.id})">Delete</button>
            </div>
          </div>
          <div style="color:#666;font-size:0.85rem;margin-top:0.3rem;">${escHtml(r.guest_name || 'Anonymous')} &middot; ${r.review_date}</div>
          ${r.comment ? `<p style="margin-top:0.5rem;">${escHtml(r.comment)}</p>` : ''}
        </div>`;
      }).join('')}</div>`;

  // Paste HTML section
  const pasteSection = document.getElementById('reviewPasteSection');
  if (pasteSection && !pasteSection.dataset.initialized) {
    pasteSection.dataset.initialized = 'true';
    pasteSection.innerHTML = `
      <h3>Paste HTML Reviews</h3>
      <p style="color:#666;font-size:0.9rem;">Paste HTML from a review page to extract reviews automatically.</p>
      <textarea id="reviewHtmlInput" rows="6" style="width:100%;font-family:monospace;font-size:0.85rem;padding:0.5rem;border:1px solid #ddd;border-radius:6px;" placeholder="Paste review page HTML here..."></textarea>
      <button class="btn" style="margin-top:0.5rem;" onclick="parseReviewHtml()">Parse Reviews</button>
      <div id="parsedReviewsPreview" style="margin-top:1rem;"></div>`;
  }
}

function getSentiment(rating) {
  if (rating >= 4) return 'positive';
  if (rating >= 3) return 'neutral';
  return 'negative';
}

async function addReview(event) {
  event.preventDefault();
  const form = event.target;
  const reviewData = {
    property_id: parseInt(form.property_id.value),
    platform: form.platform.value,
    guest_name: form.guest_name.value,
    rating: parseFloat(form.rating.value),
    review_date: form.review_date.value,
    comment: form.comment.value,
  };

  await api('/api/analytics/reviews', { method: 'POST', body: JSON.stringify(reviewData) });
  form.reset();
  loadAnalytics();
}

async function deleteReview(id) {
  if (!confirm('Delete this review?')) return;
  await api(`/api/analytics/reviews/${id}`, { method: 'DELETE' });
  loadAnalytics();
}

/* ───── Review HTML Parsing ───── */

async function parseReviewHtml() {
  const textarea = document.getElementById('reviewHtmlInput');
  const preview = document.getElementById('parsedReviewsPreview');
  if (!textarea || !preview) return;

  const html = textarea.value.trim();
  if (!html) {
    preview.innerHTML = '<div style="color:#cc0000;">Please paste some HTML first.</div>';
    return;
  }

  preview.innerHTML = '<div style="color:#666;">Parsing...</div>';

  try {
    const result = await api('/api/analytics/reviews/parse-html', {
      method: 'POST',
      body: JSON.stringify({ html }),
    });

    const reviews = result.reviews || [];
    if (reviews.length === 0) {
      preview.innerHTML = '<div style="color:#999;">No reviews could be extracted from the provided HTML.</div>';
      return;
    }

    preview.innerHTML = `
      <h4>Extracted ${reviews.length} review(s):</h4>
      ${reviews.map((r, i) => `<div style="padding:0.5rem;border:1px solid #eee;border-radius:6px;margin-bottom:0.5rem;">
        <strong>${escHtml(r.guest_name || 'Guest')}</strong> — ${renderStars(r.rating)} ${r.rating}/5
        ${r.comment ? `<p style="margin:0.3rem 0;font-size:0.9rem;">${escHtml(r.comment)}</p>` : ''}
        <div style="font-size:0.8rem;color:#666;">${r.review_date || ''} &middot; ${escHtml(r.platform || '')}</div>
      </div>`).join('')}
      <button class="btn" onclick='saveExtractedReviews(${escHtml(JSON.stringify(reviews))})'>Save All</button>`;
  } catch (err) {
    preview.innerHTML = `<div style="color:#cc0000;">Parse failed: ${escHtml(err.message)}</div>`;
  }
}

async function saveExtractedReviews(reviews) {
  const preview = document.getElementById('parsedReviewsPreview');
  try {
    for (const r of reviews) {
      await api('/api/analytics/reviews', { method: 'POST', body: JSON.stringify(r) });
    }
    if (preview) preview.innerHTML = `<div style="color:#00aa44;">Saved ${reviews.length} review(s) successfully.</div>`;
    const textarea = document.getElementById('reviewHtmlInput');
    if (textarea) textarea.value = '';
    loadAnalytics();
  } catch (err) {
    if (preview) preview.innerHTML = `<div style="color:#cc0000;">Save failed: ${escHtml(err.message)}</div>`;
  }
}

/* ───── Insights Tab ───── */

function renderInsightsTab() {
  const s = data.summary;
  const insights = [];
  const properties = data._properties || [];
  const propNameMap = {};
  for (const p of properties) propNameMap[p.id] = p.name;

  // Helper to prefix property name
  function propPrefix(propId) {
    const name = propNameMap[propId];
    return name ? `<strong>${escHtml(name)}</strong> ` : '';
  }

  // Best performing channel
  const sortedChannels = [...data.channel_stats].sort((a, b) => b.revenue - a.revenue);
  const bestChannel = sortedChannels[0];
  if (bestChannel) {
    insights.push({
      type: 'positive',
      text: `<strong>${escHtml(bestChannel.channel)}</strong> is your top revenue channel with R ${fmtNum(bestChannel.revenue)} from ${bestChannel.bookings} bookings.`,
    });
  }

  // Channel with best ADR
  const bestAdrChannel = [...data.channel_stats].sort((a, b) => b.avg_ppn - a.avg_ppn)[0];
  if (bestAdrChannel && data.channel_stats.length > 1) {
    const worstAdrChannel = [...data.channel_stats].sort((a, b) => a.avg_ppn - b.avg_ppn)[0];
    if (bestAdrChannel.channel !== worstAdrChannel.channel) {
      insights.push({
        type: 'neutral',
        text: `<strong>${escHtml(bestAdrChannel.channel)}</strong> gets the highest nightly rate (R ${bestAdrChannel.avg_ppn}/night) vs <strong>${escHtml(worstAdrChannel.channel)}</strong> at R ${worstAdrChannel.avg_ppn}/night. Consider adjusting ${escHtml(worstAdrChannel.channel)} pricing.`,
      });
    }
  }

  // VRBO-specific insight
  const vrboChannel = data.channel_stats.find(c => normalizePlatform(c.channel) === 'VRBO');
  if (vrboChannel && sortedChannels.length > 1) {
    const vrboShare = vrboChannel.revenue / sortedChannels.reduce((t, c) => t + c.revenue, 0) * 100;
    if (vrboShare < 10) {
      insights.push({
        type: 'neutral',
        text: `<strong>VRBO</strong> accounts for only ${Math.round(vrboShare)}% of revenue. Consider optimizing your VRBO listing or adjusting pricing to increase bookings from this channel.`,
      });
    }
  }

  // Cancellation insight
  for (const c of data.cancellations_by_channel) {
    if (c.rate > 20) {
      insights.push({
        type: 'negative',
        text: `<strong>${escHtml(c.channel)}</strong> has a ${c.rate}% cancellation rate (${c.cancelled}/${c.total}). Consider stricter cancellation policies on this channel.`,
      });
    }
  }

  // Per-property occupancy insights
  const occByProperty = {};
  for (const o of data.occupancy_timeline) {
    const pid = o.property_id;
    if (!occByProperty[pid]) occByProperty[pid] = [];
    occByProperty[pid].push(o);
  }

  // Seasonality data for historical averages
  const seasonality = data._seasonality || {};
  const seasonalMonthly = seasonality.monthly_avg_occupancy || [];

  // Current month string e.g. "2026-03"
  const now = new Date();
  const currentMonthStr = now.toISOString().substring(0, 7);
  const currentMonthNum = now.getMonth() + 1;
  const historicalAvgForCurrentMonth = seasonalMonthly.find(m => m.month_num === currentMonthNum);

  for (const pid of Object.keys(occByProperty)) {
    const propOcc = occByProperty[pid];
    const propName = propNameMap[pid] || 'Unknown';
    const recentPropOcc = propOcc.slice(-6);

    if (recentPropOcc.length > 0) {
      const avgOcc = Math.round(recentPropOcc.reduce((sum, o) => sum + o.occupancy_rate, 0) / recentPropOcc.length);
      if (avgOcc < 50) {
        insights.push({
          type: 'negative',
          text: `<strong>${escHtml(propName)}</strong> average occupancy is <strong>${avgOcc}%</strong> over recent months. Consider lowering prices, running promotions, or listing on additional channels.`,
        });
      } else if (avgOcc > 85) {
        insights.push({
          type: 'positive',
          text: `<strong>${escHtml(propName)}</strong> excellent occupancy at <strong>${avgOcc}%</strong>! You may be able to increase prices, especially on high-demand dates.`,
        });
      }
    }

    // Current month occupancy vs historical average alert
    const currentMonthOcc = propOcc.find(o => o.month === currentMonthStr);
    if (currentMonthOcc && historicalAvgForCurrentMonth) {
      const currentRate = currentMonthOcc.occupancy_rate;
      const historicalRate = historicalAvgForCurrentMonth.avg_occupancy;
      if (historicalRate - currentRate > 20) {
        insights.push({
          type: 'negative',
          text: `<strong>${escHtml(propName)}</strong> is running at ${currentRate}% occupancy this month vs its ${historicalRate}% historical average.`,
        });
      }
    }
  }

  // Lead time insight
  const shortLead = data.lead_time_distribution.find(l => l.bucket === '0-1 days');
  if (shortLead && shortLead.count > 5) {
    insights.push({
      type: 'neutral',
      text: `You're getting <strong>${shortLead.count}</strong> same-day/next-day bookings. These last-minute guests pay R ${shortLead.avg_ppn}/night on average. ${shortLead.avg_ppn < s.avg_adr ? 'Consider a small last-minute discount to fill more gaps.' : 'Last-minute pricing is working well!'}`,
    });
  }

  // Best day of week
  const bestDow = data.dow_stats.reduce((a, b) => (b.bookings_starting > a.bookings_starting ? b : a));
  insights.push({
    type: 'positive',
    text: `<strong>${DAY_NAMES[bestDow.day]}</strong> is the most popular check-in day with ${bestDow.bookings_starting} bookings.`,
  });

  // LOS insight
  const losData = [...data.los_distribution].sort((a, b) => b.count - a.count);
  if (losData.length > 0) {
    const topLos = losData[0];
    insights.push({
      type: 'neutral',
      text: `Most common stay length is <strong>${topLos.nights} night${topLos.nights === '1' ? '' : 's'}</strong> (${topLos.count} bookings, R ${fmtNum(topLos.revenue)} revenue). ${parseInt(topLos.nights) <= 2 ? 'Consider weekly discounts to encourage longer stays.' : 'Good stay length mix.'}`,
    });
  }

  // Revenue trend
  const revTimeline = data.revenue_timeline;
  if (revTimeline.length >= 2) {
    const last = revTimeline[revTimeline.length - 1];
    const prev = revTimeline[revTimeline.length - 2];
    const change = prev.total > 0 ? Math.round(((last.total - prev.total) / prev.total) * 100) : 0;
    insights.push({
      type: change >= 0 ? 'positive' : 'negative',
      text: `Revenue ${change >= 0 ? 'up' : 'down'} <strong>${Math.abs(change)}%</strong> from ${fmtMonth(prev.month)} to ${fmtMonth(last.month)} (R ${fmtNum(prev.total)} → R ${fmtNum(last.total)}).`,
    });
  }

  // Property comparison
  if (data.revenue_by_property.length > 1) {
    const sorted = [...data.revenue_by_property].sort((a, b) => b.total - a.total);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best.total > worst.total * 2) {
      insights.push({
        type: 'neutral',
        text: `<strong>${escHtml(best.property)}</strong> earns ${Math.round(best.total / worst.total)}x more than <strong>${escHtml(worst.property)}</strong>. Review pricing and listing quality for the lower performer.`,
      });
    }
  }

  document.getElementById('insightsList').innerHTML = insights.length === 0
    ? '<div style="color:#999;">Not enough data for insights. Sync your booking history first.</div>'
    : insights.map(i => `<div class="insight ${i.type}">${i.text}</div>`).join('');

  // Predictions table (seasonal weighting)
  const preds = buildSeasonalPredictions();
  document.getElementById('predictionsTable').innerHTML = preds.length === 0
    ? '<tbody><tr><td>Need at least 3 months of data for predictions.</td></tr></tbody>'
    : `<thead><tr><th>Month</th><th>Predicted Revenue</th><th>Est. Bookings</th><th>Est. Nights</th></tr></thead>
       <tbody>${preds.map(p => `<tr>
         <td>${fmtMonth(p.month)} <span class="prediction-badge">forecast</span></td>
         <td>R ${fmtNum(p.predicted_revenue)}</td><td>~${p.predicted_bookings}</td><td>~${p.predicted_nights}</td>
       </tr>`).join('')}</tbody>`;
  // Add forecast methodology note
  const predsTable = document.getElementById('predictionsTable');
  if (predsTable && preds.length > 0) {
    predsTable.insertAdjacentHTML('afterend', '<p style="color:#999;font-size:0.8rem;margin-top:0.5rem;">Based on same-month historical data where available, otherwise 3-month average.</p>');
  }

  // Pipeline
  document.getElementById('pipelineSummary').innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="kpi-card"><div class="kpi-value">R ${fmtNum(s.future_revenue)}</div><div class="kpi-label">Confirmed Future Revenue</div></div>
      <div class="kpi-card"><div class="kpi-value">${s.future_bookings}</div><div class="kpi-label">Upcoming Bookings</div></div>
      <div class="kpi-card"><div class="kpi-value">${s.future_nights}</div><div class="kpi-label">Future Nights Booked</div></div>
    </div>`;
}

/* ───── Competitor CRUD ───── */

function openCompetitorModal(id) {
  const modal = document.getElementById('competitorModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const form = document.getElementById('competitorForm');
  const title = document.getElementById('competitorModalTitle');

  // Populate property select
  const propSelect = document.getElementById('competitorPropertySelect');
  if (propSelect && data._properties) {
    propSelect.innerHTML = data._properties
      .map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`)
      .join('');
  }

  if (id) {
    // Edit mode
    title.textContent = 'Edit Competitor';
    form.dataset.competitorId = id;
    const comp = (data._competitors || []).find(c => c.id === id);
    if (comp) {
      form.competitor_name.value = comp.name || '';
      form.competitor_platform.value = comp.platform || '';
      form.competitor_url.value = comp.url || '';
      form.competitor_adr.value = comp.adr || '';
      if (propSelect) propSelect.value = comp.property_id || '';
    }
  } else {
    // Create mode
    title.textContent = 'Add Competitor';
    delete form.dataset.competitorId;
    form.reset();
  }
}

function closeCompetitorModal() {
  const modal = document.getElementById('competitorModal');
  if (modal) modal.style.display = 'none';
}

async function saveCompetitor(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.dataset.competitorId;
  const payload = {
    property_id: parseInt(document.getElementById('competitorPropertySelect').value),
    name: form.competitor_name.value,
    platform: form.competitor_platform.value,
    url: form.competitor_url.value,
    adr: parseFloat(form.competitor_adr.value) || 0,
  };

  if (id) {
    await api(`/api/analytics/competitors/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await api('/api/analytics/competitors', { method: 'POST', body: JSON.stringify(payload) });
  }

  closeCompetitorModal();
  loadAnalytics();
}

async function deleteCompetitor(id) {
  if (!confirm('Delete this competitor?')) return;
  await api(`/api/analytics/competitors/${id}`, { method: 'DELETE' });
  loadAnalytics();
}

/* ───── Chart Helpers ───── */

function renderBarChart(containerId, items, labelKey, valueKey, color, valueFmt, labelFmt, useChannelColors) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;width:100%;">No data</div>';
    return;
  }

  const max = Math.max(...items.map(i => i[valueKey] || 0), 1);

  container.innerHTML = items
    .map((item, idx) => {
      const v = item[valueKey] || 0;
      const h = Math.max(2, (v / max) * 100);
      const label = labelFmt ? labelFmt(item[labelKey]) : item[labelKey];
      const displayVal = valueFmt ? valueFmt(v) : v;
      let bg = color;
      if (useChannelColors) bg = CHANNEL_COLORS[item[labelKey]] || COLORS[idx % COLORS.length];
      if (!bg) bg = COLORS[idx % COLORS.length];
      return `<div class="bar-col">
        <div class="bar-value">${displayVal}</div>
        <div class="bar" style="height:${h}%;background:${bg};" title="${label}: ${displayVal}"></div>
        <div class="bar-label">${label}</div>
      </div>`;
    })
    .join('');
}

function renderBarChartWithPredictions(containerId, items, labelKey, valueKey, labelFmt) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;width:100%;">No data</div>';
    return;
  }

  const max = Math.max(...items.map(i => i[valueKey] || 0), 1);

  container.innerHTML = items
    .map(item => {
      const v = item[valueKey] || 0;
      const h = Math.max(2, (v / max) * 100);
      const label = labelFmt ? labelFmt(item[labelKey]) : item[labelKey];
      const bg = item.predicted ? '#1a1a2e40' : '#1a1a2e';
      const border = item.predicted ? '2px dashed #1a1a2e' : 'none';
      return `<div class="bar-col">
        <div class="bar-value">${item.predicted ? '~' : ''}R ${fmtNum(v)}</div>
        <div class="bar" style="height:${h}%;background:${bg};border:${border};" title="${label}: R ${fmtNum(v)}${item.predicted ? ' (predicted)' : ''}"></div>
        <div class="bar-label">${label}${item.predicted ? '<br><span class="prediction-badge">forecast</span>' : ''}</div>
      </div>`;
    })
    .join('');
}

/* ───── Stars Rendering ───── */

function renderStars(rating) {
  const full = Math.floor(rating || 0);
  const half = (rating || 0) - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
}

/* ───── Init ───── */

document.addEventListener('DOMContentLoaded', () => {
  initDateRangeBar();
});

loadAnalytics();
