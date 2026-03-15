/* analytics.js — uses globals from shared.js:
   getSelectedPropertyId, platformBadge, normalizePlatform, fmtNum, fmtMonth, escHtml */

let data = null;

const COLORS = ['#6366f1', '#ec4899', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#f97316'];
const CHANNEL_COLORS = { Airbnb: '#ff585d', 'Booking.com': '#003b95', VRBO: '#00875a', Direct: '#64748b' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ───── API helper ───── */

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
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
    case '30d': d.setDate(d.getDate() - 30); break;
    case '90d': d.setDate(d.getDate() - 90); break;
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

  // Update active button state
  const bar = document.getElementById('dateRangeBar');
  if (bar) {
    bar.querySelectorAll('.period-tab[data-range]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-range') === preset);
    });
  }
  const customInputs = document.getElementById('customDateInputs');
  if (customInputs) customInputs.style.display = preset === 'custom' ? 'flex' : 'none';

  if (preset === 'custom') {
    const fromInput = document.getElementById('customFrom');
    const toInput = document.getElementById('customTo');
    if (fromInput) localStorage.setItem('analyticsCustomFrom', fromInput.value);
    if (toInput) localStorage.setItem('analyticsCustomTo', toInput.value);
  }
  loadAnalytics();
}

function showCustomRange() {
  const bar = document.getElementById('dateRangeBar');
  if (bar) {
    bar.querySelectorAll('.period-tab[data-range]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-range') === 'custom');
    });
  }
  const customInputs = document.getElementById('customDateInputs');
  if (customInputs) customInputs.style.display = 'flex';
}

function initDateRangeBar() {
  const bar = document.getElementById('dateRangeBar');
  if (!bar) return;

  const current = localStorage.getItem('analyticsDateRange') || '12m';
  bar.querySelectorAll('.period-tab[data-range]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-range') === current);
  });

  const customInputs = document.getElementById('customDateInputs');
  if (current === 'custom' && customInputs) {
    customInputs.style.display = 'flex';
    const fromInput = document.getElementById('customFrom');
    const toInput = document.getElementById('customTo');
    if (fromInput) fromInput.value = localStorage.getItem('analyticsCustomFrom') || '';
    if (toInput) toInput.value = localStorage.getItem('analyticsCustomTo') || '';
  }

  updateDateRangeDisplay();
}

function updateDateRangeDisplay() {
  const el = document.getElementById('dateRangeDisplay');
  if (!el) return;
  const { from, to } = getDateRange();
  const fmtDate = (d) => {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  el.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${fmtDate(from)} – ${fmtDate(to)}`;
}

/* ───── Export ───── */

function exportAnalytics() {
  if (!data) return;
  const rows = [['Property', 'Revenue', 'Bookings', 'Nights', 'ADR', 'Top Platform']];
  const propRev = [...data.revenue_by_property].sort((a, b) => b.total - a.total);
  for (const p of propRev) {
    const adr = p.nights > 0 ? Math.round(p.total / p.nights) : 0;
    rows.push([p.property, p.total, p.bookings, p.nights, adr, p.top_platform || '']);
  }
  rows.push([]);
  rows.push(['Month', 'Revenue', 'Bookings', 'Nights']);
  for (const r of data.revenue_timeline) {
    rows.push([r.month, r.total, r.bookings, r.nights]);
  }
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analytics-export-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
    updateDateRangeDisplay();
    renderAll();
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

/* ───── Tab Switching ───── */

function switchTab(tabId, btn) {
  document.querySelectorAll('.section-panel').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section-tabs .section-tab').forEach(b => b.classList.remove('active'));
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
  renderGuestsTab();
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
    status.textContent = res.synced > 0
      ? `Synced ${res.synced} rate entries`
      : 'Synced 0 rate entries. No rate data found — ensure nightly rates are configured in your Smoobu calendar.';
    loadAnalytics();
  } catch (err) {
    status.textContent = 'Sync failed: ' + err.message;
  }
}

/* ───── KPIs ───── */

function trendBadge(current, prior) {
  if (prior === 0 || prior == null) return '<span class="neutral">vs last year</span>';
  const pctChange = ((current - prior) / prior) * 100;
  const rounded = Math.round(Math.abs(pctChange) * 10) / 10;
  if (pctChange > 0) return `<span class="up">↑ ${rounded}%</span> <span class="neutral">vs last year</span>`;
  if (pctChange < 0) return `<span class="down">↓ ${rounded}%</span> <span class="neutral">vs last year</span>`;
  return '<span class="neutral">— vs last year</span>';
}

function trendBadgeAbs(current, prior, suffix = '') {
  if (prior == null) return '<span class="neutral">vs last year</span>';
  const diff = Math.round((current - prior) * 10) / 10;
  if (diff > 0) return `<span class="up">↑ ${diff}${suffix}</span> <span class="neutral">vs last year</span>`;
  if (diff < 0) return `<span class="down">↓ ${Math.abs(diff)}${suffix}</span> <span class="neutral">vs last year</span>`;
  return '<span class="neutral">— vs last year</span>';
}

function renderKPIs() {
  const s = data.summary;
  const p = data.prior_summary;

  // Compute avg occupancy from occupancy_timeline
  let avgOcc = 0;
  const occEntries = data.occupancy_timeline || [];
  if (occEntries.length) {
    const totalNights = occEntries.reduce((sum, o) => sum + o.nights, 0);
    const totalDays = occEntries.reduce((sum, o) => sum + o.days_in_month, 0);
    avgOcc = totalDays > 0 ? Math.round((totalNights / totalDays) * 100) : 0;
  }

  // Compute avg rating from reviews_by_property
  let avgRating = 0;
  const reviewProps = data.reviews_by_property || [];
  if (reviewProps.length) {
    const rated = reviewProps.filter(r => r.avg_rating > 0);
    if (rated.length) avgRating = Math.round(rated.reduce((s, r) => s + r.avg_rating, 0) / rated.length * 10) / 10;
  }

  const kpis = [
    { label: 'Total Revenue', value: `${fmtMoney(s.total_revenue)}`, trend: trendBadge(s.total_revenue, p?.total_revenue) },
    { label: 'Avg Occupancy', value: `${avgOcc}%`, trend: p ? trendBadgeAbs(avgOcc, p.avg_occupancy, '%') : '<span class="neutral">vs last year</span>' },
    { label: 'Avg Nightly Rate', value: `${fmtMoney(s.avg_adr)}`, trend: trendBadge(s.avg_adr, p?.avg_adr) },
    { label: 'Avg Stay', value: `${s.avg_los} nights`, trend: p ? trendBadgeAbs(s.avg_los, p.avg_los, '') : '<span class="neutral">vs last year</span>' },
    { label: 'Guest Rating', value: avgRating > 0 ? `${avgRating}` : '—', trend: '<span class="neutral">avg across properties</span>' },
  ];

  let kpiHtml = kpis
    .map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.trend}</div></div>`)
    .join('');
  if (s.has_imputed_revenue) {
    kpiHtml += '<div style="grid-column:1/-1;font-size:0.75rem;color:#f59e0b;margin-top:-0.3rem;">* Revenue includes VRBO estimates based on base nightly rates.</div>';
  }
  document.getElementById('kpiGrid').innerHTML = kpiHtml;
}

/* ───── Overview Charts ───── */

function renderOverviewCharts() {
  // Revenue Over Time — SVG line chart
  renderRevenueLineChart();

  // Revenue by Property — occ-item bars
  renderPropertyRevenueOcc();

  // Top Performing Listings table
  renderTopListings();
}

function renderRevenueLineChart() {
  const el = document.getElementById('revenueLineChart');
  if (!el) return;

  const rev = data.revenue_timeline.slice(-12);
  if (!rev.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">No revenue data yet. Sync bookings to populate.</p>'; return; }

  // Prior period = last year same months — map by exact YYYY-MM string
  const priorRev = data.prior_summary?.revenue_timeline || [];
  const priorByMonth = {};
  for (const pr of priorRev) {
    priorByMonth[pr.month] = pr;
  }
  // For each current month, find the prior month exactly one year earlier
  const priorAligned = rev.map(r => {
    const [yr, mo] = r.month.split('-').map(Number);
    const priorKey = `${yr - 1}-${String(mo).padStart(2, '0')}`;
    return priorByMonth[priorKey] || { month: priorKey, total: 0, bookings: 0, nights: 0 };
  });

  const values = rev.map(r => r.total);
  const priorValues = priorAligned.map(r => r.total);
  const allValues = [...values, ...priorValues];
  const max = Math.max(...allValues, 1);

  const padL = 55, padR = 10, padB = 28, padT = 15;
  const w = 620, h = 200;
  const chartW = w - padL - padR;
  const chartH = h - padB - padT;

  const toX = (i) => padL + (i / Math.max(rev.length - 1, 1)) * chartW;
  const toY = (v) => padT + chartH - (v / max) * chartH;

  // --- Y-axis gridlines + labels ---
  const yTicks = 4;
  let yAxisHtml = '';
  for (let t = 0; t <= yTicks; t++) {
    const val = (max / yTicks) * t;
    const y = toY(val);
    yAxisHtml += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>`;
    const sym = CURRENCY_SYMBOLS[window.displayCurrency] || window.displayCurrency;
    const label = val >= 1000 ? `${sym} ${Math.round(val / 1000)}k` : `${sym} ${Math.round(val)}`;
    yAxisHtml += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="end">${label}</text>`;
  }

  // --- Current period line + fill ---
  const pts = rev.map((r, i) => `${toX(i)},${toY(r.total)}`).join(' ');
  const fillPath = `M${toX(0)},${toY(rev[0].total)} ${rev.map((r, i) => `L${toX(i)},${toY(r.total)}`).join(' ')} L${toX(rev.length - 1)},${h - padB} L${toX(0)},${h - padB}Z`;

  // --- Prior period dashed line ---
  let priorLine = '';
  if (priorRev.length > 0) {
    const priorPts = priorAligned.map((r, i) => `${toX(i)},${toY(r.total)}`).join(' ');
    priorLine = `<polyline points="${priorPts}" fill="none" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="6,4"/>`;
  }

  // --- Month labels (short month, only show year on first month of a new year) ---
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let prevYear = null;
  const labels = rev.map((r, i) => {
    const [yr, mo] = r.month.split('-').map(Number);
    const shortYr = String(yr).slice(-2);
    let label = MONTH_SHORT[mo - 1];
    if (prevYear !== null && yr !== prevYear) {
      label += ` '${shortYr}`;
    } else if (i === 0) {
      label += ` '${shortYr}`;
    }
    prevYear = yr;
    return `<text x="${toX(i)}" y="${h - 5}" font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="middle">${label}</text>`;
  }).join('');

  // --- Hover hit areas + tooltip elements ---
  let hoverAreas = '';
  const sliceW = chartW / Math.max(rev.length - 1, 1);
  for (let i = 0; i < rev.length; i++) {
    const x = toX(i);
    const curVal = rev[i].total;
    const priorVal = priorAligned[i].total;
    const [yr, mo] = rev[i].month.split('-').map(Number);
    const monthLabel = MONTH_SHORT[mo - 1] + ' ' + yr;
    const priorYear = yr - 1;
    const priorLabel = MONTH_SHORT[mo - 1] + ' ' + priorYear;
    hoverAreas += `
      <rect x="${x - sliceW / 2}" y="${padT}" width="${sliceW}" height="${chartH}" fill="transparent" class="rev-hover-zone"
        data-idx="${i}" data-x="${x}" data-cur="${curVal}" data-prior="${priorVal}"
        data-cur-label="${monthLabel}" data-prior-label="${priorLabel}"/>
      <circle cx="${x}" cy="${toY(curVal)}" r="4" fill="#2563EB" opacity="0" class="rev-dot-cur" data-idx="${i}"/>
      ${priorRev.length > 0 ? `<circle cx="${x}" cy="${toY(priorVal)}" r="4" fill="#CBD5E1" opacity="0" class="rev-dot-prior" data-idx="${i}"/>` : ''}`;
  }

  // End dot (always visible)
  const lastX = toX(rev.length - 1), lastY = toY(rev[rev.length - 1].total);

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;">
      <defs><linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2563EB"/><stop offset="100%" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs>
      ${yAxisHtml}
      ${priorLine}
      <path d="${fillPath}" fill="url(#blueGrad)" opacity="0.1"/>
      <polyline points="${pts}" fill="none" stroke="#2563EB" stroke-width="2.5"/>
      <circle cx="${lastX}" cy="${lastY}" r="4" fill="#2563EB"/>
      ${labels}
      <!-- Vertical hover line -->
      <line id="revHoverLine" x1="0" y1="${padT}" x2="0" y2="${h - padB}" stroke="var(--gray-300)" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>
      ${hoverAreas}
    </svg>
    <div id="revTooltip" style="display:none;position:absolute;background:white;border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);font-size:12px;pointer-events:none;z-index:10;min-width:140px;"></div>`;

  // Make container position:relative for tooltip positioning
  el.style.position = 'relative';

  // Hover event listeners
  const svg = el.querySelector('svg');
  const tooltip = el.querySelector('#revTooltip');
  const hoverLine = el.querySelector('#revHoverLine');
  const zones = el.querySelectorAll('.rev-hover-zone');
  const dotsCur = el.querySelectorAll('.rev-dot-cur');
  const dotsPrior = el.querySelectorAll('.rev-dot-prior');

  zones.forEach(zone => {
    zone.addEventListener('mouseenter', () => {
      const idx = zone.dataset.idx;
      const x = parseFloat(zone.dataset.x);
      const curVal = parseFloat(zone.dataset.cur);
      const priorVal = parseFloat(zone.dataset.prior);
      const curLabel = zone.dataset.curLabel;
      const priorLabel = zone.dataset.priorLabel;

      // Show hover line
      hoverLine.setAttribute('x1', x);
      hoverLine.setAttribute('x2', x);
      hoverLine.setAttribute('opacity', '1');

      // Show dots
      dotsCur.forEach(d => d.setAttribute('opacity', d.dataset.idx === idx ? '1' : '0'));
      dotsPrior.forEach(d => d.setAttribute('opacity', d.dataset.idx === idx ? '1' : '0'));

      // Build tooltip
      let html = `<div style="font-weight:600;margin-bottom:4px;">${curLabel}</div>`;
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="width:8px;height:8px;border-radius:50%;background:#2563EB;display:inline-block;"></span> ${fmtMoney(curVal)}</div>`;
      if (priorRev.length > 0) {
        html += `<div style="display:flex;align-items:center;gap:6px;color:var(--gray-500);"><span style="width:8px;height:8px;border-radius:50%;background:#CBD5E1;display:inline-block;"></span> ${fmtMoney(priorVal)} <span style="font-size:10px;">(${priorLabel})</span></div>`;
      }
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      // Position tooltip relative to container
      const rect = el.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const xRatio = (x / w) * svgRect.width;
      let left = xRatio + (svgRect.left - rect.left);
      // Keep tooltip within bounds
      if (left + 160 > rect.width) left = left - 160;
      if (left < 0) left = 8;
      tooltip.style.left = left + 'px';
      tooltip.style.top = '0px';
    });

    zone.addEventListener('mouseleave', () => {
      hoverLine.setAttribute('opacity', '0');
      dotsCur.forEach(d => d.setAttribute('opacity', '0'));
      dotsPrior.forEach(d => d.setAttribute('opacity', '0'));
      tooltip.style.display = 'none';
    });
  });
}

function renderPropertyRevenueOcc() {
  const el = document.getElementById('propertyRevenueOcc');
  if (!el) return;

  const propRev = [...data.revenue_by_property].sort((a, b) => b.total - a.total);
  if (!propRev.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No property data yet.</p>'; return; }

  const maxRev = propRev[0].total || 1;
  el.innerHTML = propRev.map((p, i) => {
    const pct = Math.round((p.total / maxRev) * 100);
    const color = pct > 50 ? 'var(--primary)' : pct > 25 ? 'var(--warning)' : 'var(--danger)';
    return `<div class="occ-item">
      <div class="occ-top"><span class="name">${escHtml(p.property)}</span><span class="pct">${fmtMoney(p.total)}</span></div>
      <div class="occ-bar"><div class="fill" style="width:${pct}%; background:${color}"></div></div>
    </div>`;
  }).join('');
}

function renderTopListings() {
  const tbody = document.getElementById('topListingsBody');
  if (!tbody) return;

  const propRev = [...data.revenue_by_property].sort((a, b) => b.total - a.total);
  if (!propRev.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray-400);">No data yet</td></tr>'; return; }

  // Build occupancy map from occupancy_timeline
  const occMap = {};
  for (const o of (data.occupancy_timeline || [])) {
    if (!occMap[o.property]) occMap[o.property] = { nights: 0, days: 0 };
    occMap[o.property].nights += o.nights;
    occMap[o.property].days += o.days_in_month;
  }

  // Build review map
  const reviewMap = {};
  for (const r of (data.reviews_by_property || [])) {
    reviewMap[r.property] = r.avg_rating || 0;
  }

  tbody.innerHTML = propRev.map(p => {
    const occ = occMap[p.property];
    const occPct = occ && occ.days > 0 ? Math.round((occ.nights / occ.days) * 100) : 0;
    const occColor = occPct >= 70 ? 'var(--success)' : occPct >= 50 ? 'var(--warning)' : 'var(--danger)';
    const adr = p.nights > 0 ? Math.round(p.total / p.nights) : 0;
    const avgStay = p.bookings > 0 ? Math.round((p.nights / p.bookings) * 10) / 10 : 0;
    const rating = reviewMap[p.property] || 0;
    const ratingHtml = rating > 0 ? `<div class="rating"><span class="star">★</span> ${rating}</div>` : '<span style="color:var(--gray-400)">—</span>';

    // Top platform badge
    const topPlat = p.top_platform || '';
    let platHtml = '—';
    if (topPlat) {
      const platLower = topPlat.toLowerCase().replace(/[^a-z]/g, '');
      let badgeClass = 'direct';
      if (platLower.includes('airbnb')) badgeClass = 'airbnb';
      else if (platLower.includes('booking')) badgeClass = 'booking';
      else if (platLower.includes('vrbo')) badgeClass = 'vrbo';
      platHtml = `<span class="platform-badge ${badgeClass}">${escHtml(topPlat)}</span>`;
    }

    return `<tr>
      <td style="font-weight:500">${escHtml(p.property)}</td>
      <td>${fmtMoney(p.total)}</td>
      <td style="color:${occColor};font-weight:600">${occPct}%</td>
      <td>${fmtMoney(adr)}</td>
      <td>${avgStay} nights</td>
      <td>${p.bookings}</td>
      <td>${ratingHtml}</td>
      <td>${platHtml}</td>
    </tr>`;
  }).join('');
}

function renderDemoChart(containerId, items, labelKey, color) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem;">No data yet. Sync bookings to populate.</p>'; return; }
  const max = Math.max(...items.map(i => i.count));
  el.innerHTML = items.slice(0, 8).map(item => {
    const pct = max > 0 ? Math.round((item.count / max) * 100) : 0;
    const label = item[labelKey] || 'Unknown';
    return `<div class="hbar-item"><span class="hbar-label">${escHtml(label)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${color};"><span>${pct}%</span></div></div><div class="hbar-value">${item.count}</div></div>`;
  }).join('');
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
  const s = data.summary;
  const p = data.prior_summary;

  // ── 1. KPI Row ──
  const totalRev = s.total_revenue || 0;
  const netRev = s.net_revenue || 0;
  const avgBookingVal = s.total_bookings > 0 ? Math.round(totalRev / s.total_bookings) : 0;
  // RevPAN = revenue per available night
  const occEntries = data.occupancy_timeline || [];
  const totalAvailNights = occEntries.reduce((sum, o) => sum + (o.days_in_month || 0), 0);
  const revpan = totalAvailNights > 0 ? Math.round(totalRev / totalAvailNights) : 0;
  const profitMargin = totalRev > 0 ? Math.round((netRev / totalRev) * 100) : 0;

  const priorAvgBooking = p && p.total_bookings > 0 ? Math.round((p.total_revenue || 0) / p.total_bookings) : null;
  const priorMargin = p && p.total_revenue > 0 ? Math.round(((p.net_revenue || 0) / p.total_revenue) * 100) : null;

  const kpiEl = document.getElementById('revKpiGrid');
  if (kpiEl) {
    kpiEl.innerHTML = [
      { label: 'Total Revenue', value: fmtMoney(totalRev), trend: trendBadge(totalRev, p?.total_revenue) },
      { label: 'Net Revenue', value: fmtMoney(netRev), trend: trendBadge(netRev, p?.net_revenue) },
      { label: 'Avg Booking Value', value: fmtMoney(avgBookingVal), trend: trendBadge(avgBookingVal, priorAvgBooking) },
      { label: 'RevPAN', value: fmtMoney(revpan), trend: '<span class="neutral">rev per available night</span>' },
      { label: 'Profit Margin', value: profitMargin + '%', trend: priorMargin != null ? trendBadgeAbs(profitMargin, priorMargin, '%') : '<span class="neutral">net / gross</span>' },
    ].map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.trend}</div></div>`).join('');
  }

  // ── 2. Monthly Revenue Trend (grouped bar SVG) ──
  renderRevMonthlyBarChart();

  // ── 2b. Revenue Breakdown Donut ──
  renderRevBreakdownDonut();

  // ── 3. Revenue by Property + Revenue by Channel ──
  renderRevByProperty();
  renderRevByChannelDonut();

  // ── 4. Revenue Forecast + Top Periods ──
  renderRevForecastChart();
  renderRevTopPeriods();
}

/* ── Revenue: Grouped Bar Chart (SVG) ── */
function renderRevMonthlyBarChart() {
  const el = document.getElementById('revMonthlyBarChart');
  if (!el) return;

  const timeline = data.revenue_timeline.slice(-12);
  if (!timeline.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">No revenue data yet.</p>'; return; }

  // Build prior-year lookup: for each current month, find the same month one year earlier
  const priorTimeline = data.prior_summary?.revenue_timeline || [];
  const priorMap = {};
  for (const r of priorTimeline) {
    // Prior data is keyed by its actual month (e.g. "2024-04")
    // Map it to the current year month it corresponds to
    const [y, m] = r.month.split('-');
    const currentKey = (parseInt(y) + 1) + '-' + m;
    priorMap[currentKey] = r.total;
  }
  // Also check if earlier months in full timeline can serve as prior
  const fullTimeline = data.revenue_timeline || [];
  for (const r of fullTimeline) {
    const [y, m] = r.month.split('-');
    const nextYearKey = (parseInt(y) + 1) + '-' + m;
    // Only set if not already from prior_summary and if the next-year month is in our current timeline
    if (!priorMap[nextYearKey] && timeline.some(t => t.month === nextYearKey)) {
      priorMap[nextYearKey] = r.total;
    }
  }

  const w = 680, h = 260, padL = 60, padR = 10, padT = 30, padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const n = timeline.length;
  const groupW = chartW / n;
  const barW = Math.min(groupW * 0.32, 28);
  const gap = 3;

  const maxVal = Math.max(...timeline.map(r => Math.max(r.total, priorMap[r.month] || 0)), 1);
  const yScale = chartH / maxVal;

  // Y-axis grid
  const yTicks = 5;
  let svg = '';
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round((maxVal / yTicks) * i);
    const y = padT + chartH - (val * yScale);
    svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#94A3B8" text-anchor="end" font-family="Inter">${fmtMoney(val)}</text>`;
  }

  // Bars
  timeline.forEach((r, i) => {
    const x = padL + i * groupW + (groupW - barW * 2 - gap) / 2;
    const priorVal = priorMap[r.month] || 0;

    // Prior bar (gray)
    const priorH = Math.max(1, priorVal * yScale);
    const priorY = padT + chartH - priorH;
    svg += `<rect x="${x}" y="${priorY}" width="${barW}" height="${priorH}" rx="3" fill="#E2E8F0"/>`;

    // Current bar (blue)
    const curH = Math.max(1, r.total * yScale);
    const curY = padT + chartH - curH;
    svg += `<rect x="${x + barW + gap}" y="${curY}" width="${barW}" height="${curH}" rx="3" fill="#2563EB"/>`;

    // YoY growth label above current bar
    if (priorVal > 0) {
      const yoyPct = Math.round(((r.total - priorVal) / priorVal) * 100);
      const yoyColor = yoyPct >= 0 ? '#10B981' : '#EF4444';
      const yoyLabel = (yoyPct >= 0 ? '+' : '') + yoyPct + '%';
      svg += `<text x="${x + barW + gap + barW / 2}" y="${curY - 6}" font-size="9" fill="${yoyColor}" text-anchor="middle" font-family="Inter" font-weight="600">${yoyLabel}</text>`;
    }

    // X-axis month label
    const monthLabel = fmtMonth(r.month).split(' ')[0]; // Just month name
    svg += `<text x="${x + barW + gap / 2}" y="${padT + chartH + 16}" font-size="10" fill="#94A3B8" text-anchor="middle" font-family="Inter">${monthLabel}</text>`;
  });

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

/* ── Revenue: Breakdown Donut ── */
function renderRevBreakdownDonut() {
  const el = document.getElementById('revBreakdownDonut');
  if (!el) return;

  const totalRev = data.summary.total_revenue || 0;
  const commission = data.summary.total_commission || 0;
  const netRev = data.summary.net_revenue || 0;
  const netMargin = totalRev > 0 ? Math.round((netRev / totalRev) * 100) : 0;

  const segments = [
    { label: 'Net Revenue', value: netRev, color: '#2563EB' },
    { label: 'Platform Fees', value: commission, color: '#F59E0B' },
  ];
  // Only show segments with value
  const filtered = segments.filter(s => s.value > 0);
  if (!filtered.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">No data.</p>'; return; }

  const donutSvg = buildDonutSVG(filtered, 70, 18, `${netMargin}%`, 'Net Margin');
  const legend = filtered.map(s =>
    `<div class="donut-legend-item"><div class="dot" style="background:${s.color}"></div><span class="lbl">${s.label}</span><span class="val">${fmtMoney(s.value)}</span></div>`
  ).join('');

  el.innerHTML = `<div class="donut-wrap" style="flex-direction:column;align-items:center;gap:16px;">
    <div class="donut-chart" style="width:160px;height:160px;">${donutSvg}</div>
    <div class="donut-legend" style="width:100%;">${legend}</div>
  </div>`;
}

/* ── Revenue: By Property ── */
function renderRevByProperty() {
  const el = document.getElementById('revByProperty');
  if (!el) return;

  const CHAN_COLORS = { Airbnb: '#FF585D', 'Booking.com': '#003580', Direct: '#10B981', VRBO: '#3B5CE8' };
  const propRev = [...data.revenue_by_property].sort((a, b) => b.total - a.total);
  const totalAll = propRev.reduce((s, p) => s + p.total, 0) || 1;

  if (!propRev.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No property data.</p>'; return; }

  // Build per-property channel breakdown from channel_stats if possible
  // Since we don't have per-property-per-channel data, we use the property's top_platform
  // and distribute the rest proportionally from channel_stats
  const channelTotals = {};
  for (const ch of (data.channel_stats || [])) {
    const norm = normalizePlatform(ch.channel);
    channelTotals[norm] = (channelTotals[norm] || 0) + ch.revenue;
  }
  const totalChannelRev = Object.values(channelTotals).reduce((s, v) => s + v, 0) || 1;

  let html = '';
  propRev.forEach(prop => {
    const pctOfTotal = Math.round((prop.total / totalAll) * 100);
    // Approximate channel breakdown: use global channel split proportionally
    const channelShares = {};
    for (const [ch, rev] of Object.entries(channelTotals)) {
      channelShares[ch] = (rev / totalChannelRev) * 100;
    }

    // Build stacked bar
    let stackedBar = '';
    let cumPct = 0;
    for (const [ch, pct] of Object.entries(channelShares)) {
      const color = CHAN_COLORS[ch] || '#94A3B8';
      stackedBar += `<div style="width:${pct}%;height:100%;background:${color};display:inline-block;" title="${ch}: ${Math.round(pct)}%"></div>`;
      cumPct += pct;
    }
    if (cumPct === 0) {
      stackedBar = `<div style="width:100%;height:100%;background:#2563EB;"></div>`;
    }

    html += `<div style="padding:10px 0;border-bottom:1px solid var(--gray-100);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:500;">${escHtml(prop.property)}</span>
        <span style="font-size:13px;font-weight:600;">${fmtMoney(prop.total)}</span>
      </div>
      <div style="height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden;display:flex;">${stackedBar}</div>
      <div style="display:flex;gap:12px;margin-top:4px;font-size:11px;color:var(--gray-500);">
        <span>${pctOfTotal}% of total</span>
        ${prop.top_platform ? `<span>Top: ${escHtml(prop.top_platform)}</span>` : ''}
      </div>
    </div>`;
  });

  // Legend
  const legendItems = Object.entries(CHAN_COLORS).map(([ch, color]) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div> ${ch}</div>`
  ).join('');

  el.innerHTML = html + `<div class="legend" style="display:flex;gap:14px;margin-top:12px;flex-wrap:wrap;">${legendItems}</div>`;
}

/* ── Revenue: By Channel Donut ── */
function renderRevByChannelDonut() {
  const el = document.getElementById('revByChannel');
  if (!el) return;

  const CHAN_COLORS = { Airbnb: '#FF585D', 'Booking.com': '#003580', Direct: '#10B981', VRBO: '#3B5CE8' };
  const channels = (data.channel_stats || []).map(ch => ({
    label: normalizePlatform(ch.channel),
    value: ch.revenue || 0,
    bookings: ch.bookings || 0,
    nights: ch.nights || 0,
    avg_ppn: ch.avg_ppn || 0,
    avg_los: ch.avg_los || 0,
  }));

  // Merge duplicates after normalization
  const merged = {};
  for (const ch of channels) {
    if (!merged[ch.label]) merged[ch.label] = { ...ch, color: CHAN_COLORS[ch.label] || '#94A3B8' };
    else {
      merged[ch.label].value += ch.value;
      merged[ch.label].bookings += ch.bookings;
      merged[ch.label].nights += ch.nights;
    }
  }
  const segments = Object.values(merged).filter(s => s.value > 0).sort((a, b) => b.value - a.value);

  if (!segments.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No channel data.</p>'; return; }

  const totalRev = segments.reduce((s, c) => s + c.value, 0);
  const abbrevTotal = totalRev >= 1000000 ? fmtNum(Math.round(totalRev / 1000)) + 'K' : fmtMoney(totalRev);

  const donutSvg = buildDonutSVG(segments, 70, 18, abbrevTotal, 'Total');
  const legend = segments.map(s => {
    const pct = Math.round((s.value / totalRev) * 100);
    return `<div class="donut-legend-item"><div class="dot" style="background:${s.color}"></div><span class="lbl">${s.label}</span><span class="val">${fmtMoney(s.value)} (${pct}%)</span></div>`;
  }).join('');

  // Channel metrics grid
  const cancelMap = {};
  for (const c of (data.cancellations_by_channel || [])) {
    cancelMap[normalizePlatform(c.channel)] = c.rate || 0;
  }

  let metricsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--gray-100);">';
  for (const ch of segments) {
    const avgFeeRate = ch.value > 0 && totalRev > 0 ? Math.round((ch.value / totalRev) * 100) : 0;
    const avgBooking = ch.bookings > 0 ? Math.round(ch.value / ch.bookings) : 0;
    const cancelRate = cancelMap[ch.label] || 0;
    metricsHtml += `<div style="text-align:center;padding:8px;background:var(--gray-50);border-radius:6px;">
      <div style="font-size:11px;font-weight:600;color:${ch.color};margin-bottom:4px;">${ch.label}</div>
      <div style="font-size:11px;color:var(--gray-500);">Avg Booking: ${fmtMoney(avgBooking)}</div>
      <div style="font-size:11px;color:var(--gray-500);">Cancel: ${Math.round(cancelRate)}%</div>
    </div>`;
  }
  metricsHtml += '</div>';

  el.innerHTML = `<div class="donut-wrap" style="flex-direction:column;align-items:center;gap:16px;">
    <div class="donut-chart" style="width:160px;height:160px;">${donutSvg}</div>
    <div class="donut-legend" style="width:100%;">${legend}</div>
  </div>${metricsHtml}`;
}

/* ── Revenue: Forecast Line Chart ── */
function renderRevForecastChart() {
  const el = document.getElementById('revForecastChart');
  if (!el) return;

  const actual = data.revenue_timeline.slice(-9);
  const predictions = buildSeasonalPredictions();

  if (!actual.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">No data.</p>'; return; }

  const allPoints = [
    ...actual.map(r => ({ month: r.month, value: r.total, type: 'actual' })),
    // Bridge point: last actual repeated as first forecast
    { month: actual[actual.length - 1].month, value: actual[actual.length - 1].total, type: 'bridge' },
    ...predictions.map(p => ({ month: p.month, value: p.predicted_revenue, type: 'forecast' })),
  ];

  const w = 500, h = 240, padL = 55, padR = 15, padT = 20, padB = 30;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const maxVal = Math.max(...allPoints.map(p => p.value), 1);
  const n = allPoints.length;

  const toX = (i) => padL + (i / Math.max(n - 1, 1)) * chartW;
  const toY = (v) => padT + chartH - (v / maxVal) * chartH;

  // Grid lines
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxVal / 4) * i);
    const y = toY(val);
    svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#94A3B8" text-anchor="end" font-family="Inter">${fmtMoney(val)}</text>`;
  }

  // Actual area fill
  const actualPts = actual.map((_, i) => ({ x: toX(i), y: toY(actual[i].total) }));
  if (actualPts.length > 1) {
    const areaPath = `M${actualPts[0].x},${padT + chartH} ${actualPts.map(p => `L${p.x},${p.y}`).join(' ')} L${actualPts[actualPts.length - 1].x},${padT + chartH} Z`;
    svg += `<path d="${areaPath}" fill="#2563EB" opacity="0.1"/>`;
    const linePath = actualPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    svg += `<path d="${linePath}" fill="none" stroke="#2563EB" stroke-width="2.5"/>`;
    actualPts.forEach(p => { svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#2563EB"/>`; });
  }

  // Vertical divider at last actual point
  const divX = actualPts.length > 0 ? actualPts[actualPts.length - 1].x : padL;
  svg += `<line x1="${divX}" y1="${padT}" x2="${divX}" y2="${padT + chartH}" stroke="#94A3B8" stroke-width="1" stroke-dasharray="4,3"/>`;

  // Forecast line (dashed green)
  const forecastStartIdx = actual.length - 1; // bridge from last actual
  const forecastPts = [];
  forecastPts.push({ x: toX(forecastStartIdx), y: toY(actual[actual.length - 1].total) });
  predictions.forEach((p, i) => {
    forecastPts.push({ x: toX(actual.length + i), y: toY(p.predicted_revenue) });
  });
  if (forecastPts.length > 1) {
    const fLine = forecastPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    svg += `<path d="${fLine}" fill="none" stroke="#10B981" stroke-width="2.5" stroke-dasharray="6,4"/>`;
    forecastPts.forEach((p, i) => {
      if (i === 0) return; // skip bridge point
      svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="white" stroke="#10B981" stroke-width="2"/>`;
    });
  }

  // X-axis labels
  const allMonths = [...actual.map(r => r.month), ...predictions.map(p => p.month)];
  allMonths.forEach((m, i) => {
    const x = toX(i);
    const label = fmtMonth(m).split(' ')[0];
    svg += `<text x="${x}" y="${padT + chartH + 18}" font-size="10" fill="#94A3B8" text-anchor="middle" font-family="Inter">${label}</text>`;
  });

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

/* ── Revenue: Top Revenue Periods ── */
function renderRevTopPeriods() {
  const el = document.getElementById('revTopPeriods');
  if (!el) return;

  const timeline = [...(data.revenue_timeline || [])];
  if (!timeline.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No data.</p>'; return; }

  // Rank months by revenue, take top 6
  const ranked = timeline
    .filter(m => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const top = ranked.map(m => {
    const adr = m.nights > 0 ? Math.round(m.total / m.nights) : 0;
    return { period: fmtMonth(m.month), revenue: m.total, bookings: m.bookings, nights: m.nights, adr };
  });

  let tableHtml = `<table class="data-table">
    <thead><tr><th>Month</th><th>Revenue</th><th>Bookings</th><th>Nights</th><th>ADR</th></tr></thead>
    <tbody>${top.map(w => `<tr>
      <td style="font-weight:500;">${w.period}</td>
      <td>${fmtMoney(w.revenue)}</td>
      <td>${w.bookings}</td>
      <td>${w.nights}</td>
      <td>${fmtMoney(w.adr)}</td>
    </tr>`).join('')}</tbody>
  </table>`;

  // Insight callout
  if (top.length > 0) {
    tableHtml += `<div class="callout" style="margin-top:12px;">
      <div class="callout-icon" style="background:var(--primary-50);color:var(--primary);">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
      </div>
      <div class="callout-text">Peak revenue month: <strong>${top[0].period}</strong> generating ${fmtMoney(top[0].revenue)} at ${fmtMoney(top[0].adr)} ADR across ${top[0].nights} nights.</div>
    </div>`;
  }

  el.innerHTML = tableHtml;
}

/* ── Shared: SVG Donut Chart Builder ── */
function buildDonutSVG(segments, radius, strokeWidth, centerText, centerLabel) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return '';

  const cx = radius + 5, cy = radius + 5;
  const r = radius - strokeWidth / 2;
  const circumference = 2 * Math.PI * r;
  let cumulativeOffset = 0;
  let arcs = '';

  segments.forEach(seg => {
    const pct = seg.value / total;
    const dashLen = pct * circumference;
    const dashGap = circumference - dashLen;
    const rotation = (cumulativeOffset / total) * 360 - 90;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${dashLen} ${dashGap}"
      transform="rotate(${rotation} ${cx} ${cy})" />`;
    cumulativeOffset += seg.value;
  });

  const svgSize = (radius + 5) * 2;
  return `<svg viewBox="0 0 ${svgSize} ${svgSize}" width="100%" height="100%">
    ${arcs}
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--gray-900)" font-family="Inter">${centerText}</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="10" fill="#94A3B8" font-family="Inter">${centerLabel || ''}</text>
  </svg>`;
}

/* ───── Occupancy Tab ───── */

function renderOccupancyTab() {
  const p = data.prior_summary;
  const s = data.summary;

  // --- KPIs ---
  let avgOcc = 0;
  const occEntries = data.occupancy_timeline || [];
  if (occEntries.length) {
    const totalN = occEntries.reduce((sum, o) => sum + o.nights, 0);
    const totalD = occEntries.reduce((sum, o) => sum + o.days_in_month, 0);
    avgOcc = totalD > 0 ? Math.round((totalN / totalD) * 100) : 0;
  }
  const revpar = s.properties_count > 0 && s.total_nights > 0
    ? Math.round(s.total_revenue / (occEntries.reduce((sum, o) => sum + o.days_in_month, 0) || 1))
    : 0;

  const kpiEl = document.getElementById('occKpiGrid');
  if (kpiEl) {
    kpiEl.innerHTML = [
      { label: 'Monthly Occupancy', value: `${avgOcc}%`, trend: p ? trendBadgeAbs(avgOcc, p.avg_occupancy, '%') : '<span class="neutral">vs last year</span>' },
      { label: 'Avg Daily Rate (ADR)', value: `${fmtMoney(s.avg_adr)}`, trend: trendBadge(s.avg_adr, p?.avg_adr) },
      { label: 'RevPAR', value: `${fmtMoney(revpar)}`, trend: '<span class="neutral">rev per available night</span>' },
      { label: 'Avg Stay Duration', value: `${s.avg_los} nights`, trend: p ? trendBadgeAbs(s.avg_los, p.avg_los, '') : '<span class="neutral">vs last year</span>' },
    ].map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.trend}</div></div>`).join('');
  }

  // --- Monthly Occupancy Bar Chart (SVG) ---
  renderOccBarChart();

  // --- Rate Trends (ADR + RevPAR line chart) ---
  renderRateTrendsChart();

  // --- Occupancy by Property ---
  renderOccByProperty();

  // --- Lead Time Analysis ---
  renderLeadTimeAnalysis();

  // --- Length of Stay Distribution ---
  renderLosDistribution();

  // --- Lead Time vs Nightly Rate scatter ---
  renderScatterPlot();
}

function renderOccBarChart() {
  const el = document.getElementById('occBarChart');
  if (!el) return;

  // Aggregate occupancy per month across all properties
  const occByMonth = {};
  for (const o of data.occupancy_timeline) {
    if (!occByMonth[o.month]) occByMonth[o.month] = { month: o.month, nights: 0, days: 0 };
    occByMonth[o.month].nights += o.nights;
    occByMonth[o.month].days += o.days_in_month;
  }
  const months = Object.values(occByMonth).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  if (!months.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">No occupancy data yet.</p>'; return; }

  const w = 600, h = 180, padB = 20, padT = 16;
  const chartH = h - padB - padT;
  const barW = Math.min(40, (w - 20) / months.length - 10);

  let svg = '';
  months.forEach((m, i) => {
    const pct = m.days > 0 ? Math.round((m.nights / m.days) * 100) : 0;
    const barH = Math.max(2, (pct / 100) * chartH);
    const x = 20 + i * ((w - 20) / months.length);
    const y = padT + chartH - barH;
    const color = pct >= 70 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.8"/>`;
    svg += `<text x="${x + barW / 2}" y="${y - 4}" font-size="10" fill="var(--gray-600)" text-anchor="middle" font-family="Inter" font-weight="600">${pct}%</text>`;
    svg += `<text x="${x + barW / 2}" y="${h - 3}" font-size="10" fill="#94A3B8" text-anchor="middle" font-family="Inter">${fmtMonth(m.month)}</text>`;
  });

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${svg}</svg>`;
}

function renderRateTrendsChart() {
  const el = document.getElementById('rateTrendsChart');
  if (!el) return;

  const adr = (data.adr_timeline || []).slice(-12);
  const revpar = (data.revpar_timeline || []).slice(-12);
  if (!adr.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">No rate data yet.</p>'; return; }

  const allVals = [...adr.map(a => a.adr), ...revpar.map(r => r.revpar)];
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals.filter(v => v > 0), 0);
  const w = 600, h = 180, padB = 20, padT = 10;
  const chartH = h - padB - padT;

  const toX = (i, len) => (i / Math.max(len - 1, 1)) * w;
  const toY = (v) => padT + chartH - ((v - minVal * 0.8) / (maxVal - minVal * 0.8)) * chartH;

  const gridLines = [0.25, 0.5, 0.75].map(frac => {
    const y = padT + chartH * (1 - frac);
    const val = Math.round(minVal * 0.8 + (maxVal - minVal * 0.8) * frac);
    return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>
            <text x="${w - 5}" y="${y - 3}" font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="end">${fmtMoney(val)}</text>`;
  }).join('');

  const adrPts = adr.map((a, i) => `${toX(i, adr.length)},${toY(a.adr)}`).join(' ');
  const revparPts = revpar.map((r, i) => `${toX(i, revpar.length)},${toY(r.revpar)}`).join(' ');

  const step = adr.length > 8 ? 3 : 1;
  const labels = adr.map((a, i) => {
    if (i % step !== 0 && i !== adr.length - 1) return '';
    return `<text x="${toX(i, adr.length)}" y="${h - 3}" font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="middle">${fmtMonth(a.month)}</text>`;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    ${gridLines}
    <polyline points="${adrPts}" fill="none" stroke="var(--primary)" stroke-width="2.5"/>
    <polyline points="${revparPts}" fill="none" stroke="#14B8A6" stroke-width="2" stroke-dasharray="6,3"/>
    ${labels}
  </svg>`;
}

function renderOccByProperty() {
  const el = document.getElementById('occByProperty');
  if (!el) return;

  // Aggregate occupancy per property
  const occByProp = {};
  for (const o of data.occupancy_timeline) {
    if (!occByProp[o.property]) occByProp[o.property] = { nights: 0, days: 0 };
    occByProp[o.property].nights += o.nights;
    occByProp[o.property].days += o.days_in_month;
  }

  const items = Object.entries(occByProp)
    .map(([name, d]) => ({ name, pct: d.days > 0 ? Math.round((d.nights / d.days) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);

  if (!items.length) { el.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No data yet.</p>'; return; }

  el.innerHTML = items.map(item => {
    const color = item.pct >= 70 ? 'var(--success)' : item.pct >= 50 ? 'var(--warning)' : 'var(--danger)';
    return `<div class="occ-item">
      <div class="occ-top"><span class="name">${escHtml(item.name)}</span><span class="pct" style="color:${color}">${item.pct}%</span></div>
      <div class="occ-bar"><div class="fill" style="width:${item.pct}%; background:${color}"></div></div>
    </div>`;
  }).join('');
}

function renderLeadTimeAnalysis() {
  const statsEl = document.getElementById('leadTimeStats');
  const barsEl = document.getElementById('leadTimeBars');
  if (!statsEl || !barsEl) return;

  const lt = data.lead_time_distribution || [];
  const totalBookings = lt.reduce((s, l) => s + l.count, 0);

  // Stat minis
  const avgLead = data.summary.avg_lead_time || 0;
  statsEl.innerHTML = `
    <div class="stat-mini"><div class="val">${avgLead}</div><div class="lbl">Avg Lead Time</div></div>
    <div class="stat-mini"><div class="val">${totalBookings}</div><div class="lbl">Total Bookings</div></div>
  `;

  if (!lt.length) { barsEl.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No lead time data.</p>'; return; }

  const barColors = ['var(--danger)', 'var(--warning)', 'var(--primary)', '#14B8A6', '#8B5CF6'];
  barsEl.innerHTML = lt.map((l, i) => {
    const pct = totalBookings > 0 ? Math.round((l.count / totalBookings) * 100) : 0;
    const color = barColors[i % barColors.length];
    return `<div class="hbar-item">
      <div class="hbar-label">${escHtml(l.bucket)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%; background:${color}"><span>${pct > 4 ? pct + '%' : ''}</span></div></div>
      <div class="hbar-value">${l.count}</div>
    </div>`;
  }).join('');
}

function renderLosDistribution() {
  const statsEl = document.getElementById('losStats');
  const barsEl = document.getElementById('losBars');
  if (!statsEl || !barsEl) return;

  const los = (data.los_distribution || []).sort((a, b) => {
    const aVal = a.nights === '7+' ? 7 : parseInt(a.nights);
    const bVal = b.nights === '7+' ? 7 : parseInt(b.nights);
    return aVal - bVal;
  });
  const totalBookings = los.reduce((s, l) => s + l.count, 0);

  statsEl.innerHTML = `
    <div class="stat-mini"><div class="val">${data.summary.avg_los}</div><div class="lbl">Avg Nights</div></div>
    <div class="stat-mini"><div class="val">${totalBookings}</div><div class="lbl">Total Bookings</div></div>
  `;

  if (!los.length) { barsEl.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No stay data.</p>'; return; }

  const losColors = ['var(--gray-400)', 'var(--primary)', 'var(--success)', 'var(--primary)', '#14B8A6', '#8B5CF6', '#8B5CF6'];
  barsEl.innerHTML = los.map((l, i) => {
    const pct = totalBookings > 0 ? Math.round((l.count / totalBookings) * 100) : 0;
    const label = l.nights === '7+' ? '7+ nights' : l.nights + (l.nights === '1' ? ' night' : ' nights');
    const color = losColors[i % losColors.length];
    return `<div class="hbar-item">
      <div class="hbar-label">${label}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%; background:${color}"><span>${pct > 4 ? pct + '%' : ''}</span></div></div>
      <div class="hbar-value">${l.count}</div>
    </div>`;
  }).join('');
}

function renderScatterPlot() {
  const plotEl = document.getElementById('scatterPlot');
  const legendEl = document.getElementById('scatterLegend');
  const insightEl = document.getElementById('scatterInsight');
  if (!plotEl) return;

  // We need per-booking lead_time + price_per_night + property — check if available via lead_time_distribution
  // Since we don't have raw booking data on the client, build a simplified scatter from lead_time_distribution avg_ppn
  const lt = data.lead_time_distribution || [];
  const propRev = data.revenue_by_property || [];

  if (!lt.length || !propRev.length) {
    plotEl.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;padding:2rem;text-align:center;">Not enough data for scatter plot.</p>';
    return;
  }

  // Build scatter from lead time buckets — show as bubble chart per bucket
  const w = 520, h = 300, plotL = 60, plotR = 500, plotT = 16, plotB = 236;
  const plotW = plotR - plotL, plotH = plotB - plotT;

  // Get rate range from ADR timeline
  const adrVals = (data.adr_timeline || []).map(a => a.adr).filter(v => v > 0);
  const maxRate = Math.max(...adrVals, 3000);
  const minRate = Math.min(...adrVals, 500);

  const toX = (days) => plotL + Math.min(days / 80, 1) * plotW;
  const toY = (rate) => plotB - ((rate - minRate * 0.8) / (maxRate - minRate * 0.8)) * plotH;

  // Grid + axes
  let svg = `<rect x="${plotL}" y="${plotT}" width="${plotW}" height="${plotH}" rx="4" fill="url(#plotBg)" stroke="#E2E8F0" stroke-width="0.5"/>`;
  svg += `<defs><linearGradient id="plotBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F8FAFC"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient></defs>`;

  // Grid lines
  for (let i = 1; i <= 4; i++) {
    const y = plotT + plotH * (i / 5);
    svg += `<line x1="${plotL}" y1="${y}" x2="${plotR}" y2="${y}" stroke="#F1F5F9" stroke-width="1"/>`;
  }
  for (let i = 1; i <= 3; i++) {
    const x = plotL + plotW * (i / 4);
    svg += `<line x1="${x}" y1="${plotT}" x2="${x}" y2="${plotB}" stroke="#F1F5F9" stroke-width="1"/>`;
  }

  // Axes
  svg += `<line x1="${plotL}" y1="${plotB}" x2="${plotR}" y2="${plotB}" stroke="#CBD5E1" stroke-width="1.5"/>`;
  svg += `<line x1="${plotL}" y1="${plotT}" x2="${plotL}" y2="${plotB}" stroke="#CBD5E1" stroke-width="1.5"/>`;

  // Y-axis labels
  for (let i = 0; i <= 4; i++) {
    const frac = i / 4;
    const rate = Math.round(minRate * 0.8 + (maxRate - minRate * 0.8) * frac);
    const y = plotB - frac * plotH;
    svg += `<text x="${plotL - 6}" y="${y + 4}" font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="end">${fmtMoney(rate)}</text>`;
  }
  // X-axis labels
  [0, 20, 40, 60, 80].forEach(d => {
    const x = toX(d);
    svg += `<text x="${x}" y="${plotB + 18}" font-size="10" fill="#94A3B8" font-family="Inter" text-anchor="middle">${d === 80 ? '80+' : d}</text>`;
  });
  svg += `<text x="${(plotL + plotR) / 2}" y="${plotB + 38}" font-size="11" fill="#64748B" font-family="Inter" font-weight="500" text-anchor="middle">Lead Time (days before check-in)</text>`;
  svg += `<text x="16" y="${(plotT + plotB) / 2}" font-size="11" fill="#64748B" font-family="Inter" font-weight="500" text-anchor="middle" transform="rotate(-90, 16, ${(plotT + plotB) / 2})">Nightly Rate (ZAR)</text>`;

  // Plot dots from lead_time buckets — one dot per bucket with avg_ppn
  const bucketDays = { '0-7': 4, '8-14': 11, '15-30': 22, '31-60': 45, '61+': 75 };
  lt.forEach((l, i) => {
    const days = bucketDays[l.bucket] || (i * 15 + 7);
    const rate = l.avg_ppn || 0;
    if (rate <= 0) return;
    const r = Math.min(12, 5 + l.count / 2);
    const color = COLORS[i % COLORS.length];
    svg += `<circle cx="${toX(days)}" cy="${toY(rate)}" r="${r}" fill="${color}" opacity="0.7"/>`;
    svg += `<text x="${toX(days)}" y="${toY(rate) - r - 3}" font-size="9" fill="${color}" font-family="Inter" font-weight="600" text-anchor="middle">${fmtMoney(rate)}</text>`;
  });

  plotEl.innerHTML = `<div style="padding:8px 0;"><svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;">${svg}</svg></div>`;

  // Legend
  if (legendEl) {
    legendEl.innerHTML = lt.map((l, i) => `<div class="legend-item"><div class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></div> ${escHtml(l.bucket)} days</div>`).join('');
  }

  // Insight
  if (insightEl && lt.length >= 2) {
    const shortTerm = lt.find(l => l.bucket === '0-7') || lt[0];
    const longTerm = lt[lt.length - 1];
    if (shortTerm.avg_ppn > 0 && longTerm.avg_ppn > 0) {
      const diff = shortTerm.avg_ppn - longTerm.avg_ppn;
      const pctDiff = Math.round(Math.abs(diff) / longTerm.avg_ppn * 100);
      const direction = diff > 0 ? 'higher' : 'lower';
      insightEl.innerHTML = `<div style="background:var(--primary-50);border-radius:var(--radius-sm);padding:12px 16px;font-size:12px;color:var(--gray-600);line-height:1.5;">
        💡 Short-notice bookings average <strong>${fmtMoney(shortTerm.avg_ppn)}/night</strong> — ${pctDiff}% ${direction} than longer lead-time bookings at <strong>${fmtMoney(longTerm.avg_ppn)}/night</strong>.
      </div>`;
    }
  }
}

/* ───── Guests Tab ───── */

function renderDonutSVG(items, totalLabel, totalValue, colorMap) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  const circumference = 2 * Math.PI * 50; // r=50
  let offset = 0;
  let circles = `<circle cx="60" cy="60" r="50" fill="none" stroke="var(--gray-100)" stroke-width="16"/>`;
  items.forEach(item => {
    const pct = item.count / total;
    const dash = pct * circumference;
    circles += `<circle cx="60" cy="60" r="50" fill="none" stroke="${item.color}" stroke-width="16" stroke-dasharray="${dash.toFixed(1)} ${(circumference - dash).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 60 60)"/>`;
    offset += dash;
  });
  circles += `<text x="60" y="56" font-size="14" font-weight="700" fill="var(--gray-800)" text-anchor="middle" font-family="Inter">${totalValue}</text>`;
  circles += `<text x="60" y="70" font-size="10" fill="var(--gray-400)" text-anchor="middle" font-family="Inter">${totalLabel}</text>`;
  const legendHtml = items.map(i => {
    const pct = Math.round((i.count / total) * 100);
    return `<div class="donut-legend-item"><div class="dot" style="background:${i.color}"></div><span class="lbl">${escHtml(i.label)}</span><span class="val">${pct}%</span></div>`;
  }).join('');
  return `<div class="donut-chart"><svg viewBox="0 0 120 120">${circles}</svg></div><div class="donut-legend">${legendHtml}</div>`;
}

function renderGuestsTab() {
  const s = data.summary;
  const demo = data.guest_demographics || {};
  const countries = demo.top_countries || [];
  const languages = demo.top_languages || [];
  const totalGuests = s.total_bookings;
  const numCountries = countries.length;

  // KPIs
  const kpiEl = document.getElementById('guestsKpiGrid');
  if (kpiEl) {
    kpiEl.innerHTML = [
      { label: 'Total Guests', value: totalGuests, trend: `<span class="neutral">${s.total_nights} nights</span>` },
      { label: 'Countries', value: numCountries, trend: '<span class="neutral">unique origins</span>' },
      { label: 'Avg Group Size', value: s.avg_guests || '—', trend: '<span class="neutral">guests per booking</span>' },
      { label: 'Languages', value: languages.length, trend: '<span class="neutral">unique languages</span>' },
    ].map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.trend}</div></div>`).join('');
  }

  // Guest Countries — hbar items
  const countriesEl = document.getElementById('guestCountries');
  if (countriesEl) {
    if (!countries.length) { countriesEl.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No country data. Sync bookings to populate.</p>'; }
    else {
      const maxCount = countries[0].count;
      const countryColors = ['var(--primary)', '#3B82F6', '#6366F1', '#8B5CF6', '#A78BFA', '#C4B5FD', 'var(--gray-300)'];
      countriesEl.innerHTML = countries.slice(0, 7).map((c, i) => {
        const pct = Math.round((c.count / totalGuests) * 100);
        const color = countryColors[Math.min(i, countryColors.length - 1)];
        return `<div class="hbar-item">
          <div class="hbar-label">${escHtml(c.country)}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%; background:${color}"><span>${pct > 4 ? pct + '%' : ''}</span></div></div>
          <div class="hbar-value">${c.count}</div>
        </div>`;
      }).join('');
    }
  }

  // Guest Languages — donut chart
  const langEl = document.getElementById('guestLanguages');
  if (langEl) {
    if (!languages.length) { langEl.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem;">No language data.</p>'; }
    else {
      const langColors = ['var(--primary)', '#8B5CF6', '#14B8A6', '#F59E0B', 'var(--gray-300)'];
      const topLangs = languages.slice(0, 4);
      const otherCount = languages.slice(4).reduce((s, l) => s + l.count, 0);
      const items = topLangs.map((l, i) => ({ label: l.language, count: l.count, color: langColors[i] }));
      if (otherCount > 0) items.push({ label: 'Other', count: otherCount, color: langColors[4] });
      const total = items.reduce((s, i) => s + i.count, 0);
      langEl.innerHTML = renderDonutSVG(items, 'guests', total, langColors);
    }
  }
}

/* ───── Channels Tab ───── */

function channelBadge(channel) {
  const lower = channel.toLowerCase().replace(/[^a-z]/g, '');
  let cls = 'direct';
  if (lower.includes('airbnb')) cls = 'airbnb';
  else if (lower.includes('booking')) cls = 'booking';
  else if (lower.includes('vrbo')) cls = 'vrbo';
  return `<span class="platform-badge ${cls}">${escHtml(channel)}</span>`;
}

function renderChannelsTab() {
  const ch = data.channel_stats || [];
  const totalBookings = ch.reduce((s, c) => s + c.bookings, 0);
  const totalRevenue = ch.reduce((s, c) => s + c.revenue, 0);
  const cancels = data.cancellations_by_channel || [];

  // Build cancel rate map
  const cancelMap = {};
  for (const c of cancels) { cancelMap[c.channel] = c.rate || 0; }

  // KPIs
  const kpiEl = document.getElementById('channelsKpiGrid');
  if (kpiEl) {
    const sorted = [...ch].sort((a, b) => b.bookings - a.bookings);
    const kpis = [
      { label: 'Total Bookings', value: totalBookings, trend: `<span class="neutral">${ch.length} channels</span>` },
    ];
    sorted.slice(0, 3).forEach(c => {
      const pct = totalBookings > 0 ? Math.round((c.bookings / totalBookings) * 100) : 0;
      kpis.push({ label: `${c.channel} Share`, value: `${pct}%`, trend: `<span class="neutral">${c.bookings} bookings</span>` });
    });
    kpiEl.innerHTML = kpis.map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.trend}</div></div>`).join('');
  }

  // Donut — Booking Channel Mix
  const donutEl = document.getElementById('channelDonut');
  if (donutEl) {
    const chColors = { Airbnb: '#FF585D', 'Booking.com': '#003580', Direct: 'var(--success)', VRBO: '#3B5CE8' };
    const items = ch.map(c => ({
      label: c.channel,
      count: c.bookings,
      color: chColors[c.channel] || 'var(--gray-400)',
    }));
    donutEl.innerHTML = items.length
      ? renderDonutSVG(items, 'bookings', totalBookings)
      : '<p style="color:var(--gray-400);font-size:0.85rem;">No channel data.</p>';
  }

  // Revenue by Channel — hbar
  const revEl = document.getElementById('channelRevenueBars');
  if (revEl) {
    const sorted = [...ch].sort((a, b) => b.revenue - a.revenue);
    revEl.innerHTML = sorted.map(c => {
      const pct = totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 100) : 0;
      const color = CHANNEL_COLORS[c.channel] || 'var(--gray-400)';
      const sym = CURRENCY_SYMBOLS[window.displayCurrency] || window.displayCurrency;
      const revK = c.revenue >= 1000 ? `${sym} ${Math.round(c.revenue / 1000)}K` : `${fmtMoney(c.revenue)}`;
      return `<div class="hbar-item">
        <div class="hbar-label">${channelBadge(c.channel)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%; background:${color}"><span>${revK}</span></div></div>
        <div class="hbar-value">${pct}%</div>
      </div>`;
    }).join('');
  }

  // Direct booking insight
  const insightEl = document.getElementById('channelInsight');
  if (insightEl) {
    const direct = ch.find(c => c.channel === 'Direct');
    if (direct && direct.bookings > 0) {
      const pct = totalBookings > 0 ? Math.round((direct.bookings / totalBookings) * 100) : 0;
      insightEl.innerHTML = `<div style="padding:12px;background:var(--success-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--gray-600);">
        <strong style="color:var(--success)">💡 Direct bookings at ${pct}%</strong> — Direct bookings save ~15% in platform fees. Your direct channel earned ${fmtMoney(direct.revenue)} with zero commission costs.
      </div>`;
    }
  }

  // Channel Performance Table
  const tbody = document.getElementById('channelTableBody');
  if (tbody) {
    tbody.innerHTML = ch.map(c => {
      const cancelRate = cancelMap[c.channel] || 0;
      const cancelColor = cancelRate > 15 ? 'var(--danger)' : cancelRate > 8 ? 'var(--warning)' : 'var(--success)';
      return `<tr>
        <td>${channelBadge(c.channel)}</td>
        <td>${c.bookings}</td>
        <td>${fmtMoney(c.revenue)}</td>
        <td>${fmtMoney(c.avg_ppn)}</td>
        <td>${c.avg_los} nights</td>
        <td>${c.avg_lead_time} days</td>
        <td style="color:${cancelColor}">${cancelRate}%</td>
      </tr>`;
    }).join('');
  }
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
      <td>${escHtml(l.bucket)}</td><td>${l.count}</td><td>${fmtMoney(l.avg_ppn)}</td>
    </tr>`).join('')}</tbody>`;

}

/* ───── Seasonality Tab (Mockup style) ───── */

function renderSeasonalityTab() {
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // --- Heatmap per property ---
  const heatmapEl = document.getElementById('seasonalityHeatmap');
  if (heatmapEl) {
    const occTimeline = data.occupancy_timeline || [];
    // Group by property → month_num → occupancy_rate
    const propMap = {};
    for (const o of occTimeline) {
      if (!propMap[o.property_id]) propMap[o.property_id] = { name: o.property, months: {} };
      const [, m] = o.month.split('-').map(Number);
      // Average across years for same month
      if (!propMap[o.property_id].months[m]) propMap[o.property_id].months[m] = { total: 0, count: 0 };
      propMap[o.property_id].months[m].total += o.occupancy_rate;
      propMap[o.property_id].months[m].count += 1;
    }

    if (Object.keys(propMap).length > 0) {
      // Header row
      let html = '<div class="heatmap-label"></div>';
      html += MONTH_NAMES.map(n => `<div class="heatmap-header">${n}</div>`).join('');

      for (const pid of Object.keys(propMap)) {
        const prop = propMap[pid];
        const shortName = prop.name.length > 12 ? prop.name.substring(0, 12) + '…' : prop.name;
        html += `<div class="heatmap-label">${escHtml(shortName)}</div>`;
        for (let m = 1; m <= 12; m++) {
          const md = prop.months[m];
          const occ = md ? Math.round(md.total / md.count) : 0;
          let bg, color;
          if (occ >= 75) { bg = '#ECFDF5'; color = 'var(--success)'; }
          else if (occ >= 50) { bg = '#FFFBEB'; color = 'var(--warning)'; }
          else { bg = '#FEF2F2'; color = 'var(--danger)'; }
          html += `<div class="heatmap-cell" style="background:${bg};color:${color};">${occ}%</div>`;
        }
      }
      heatmapEl.innerHTML = html;
    } else {
      heatmapEl.innerHTML = '<div style="color:var(--gray-400);padding:1rem;">No occupancy data available.</div>';
    }
  }

  // --- DOW distribution bars helper ---
  function renderDowHbar(containerId, dowData, color) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!dowData || dowData.length === 0) {
      el.innerHTML = '<div style="color:var(--gray-400);">No data</div>';
      return;
    }
    const total = dowData.reduce((s, d) => s + d.count, 0) || 1;
    const maxPct = Math.max(...dowData.map(d => (d.count / total) * 100));
    // Reorder: Mon..Sun
    const reordered = [1, 2, 3, 4, 5, 6, 0].map(dayIdx => {
      const found = dowData.find(d => d.day === dayIdx);
      return { day: dayIdx, count: found ? found.count : 0 };
    });
    el.innerHTML = reordered.map((d, i) => {
      const pct = Math.round((d.count / total) * 100);
      const isMax = pct === Math.round(maxPct);
      const fillColor = isMax ? 'var(--success)' : color;
      return `<div class="hbar-item">
        <div class="hbar-label">${DOW_FULL[i]}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct, 1)}%;background:${fillColor}">${pct >= 18 ? `<span>${pct}%</span>` : ''}</div></div>
        <div class="hbar-value"${isMax ? ' style="color:var(--success)"' : ''}>${pct}%</div>
      </div>`;
    }).join('');
  }

  // --- Booking patterns DOW (when bookings were created) ---
  const dow = data.dow_stats || [];
  // Compute booking creation DOW from check-in DOW data as best approximation
  renderDowHbar('bookingDowBars', dow.map(d => ({ day: d.day, count: d.bookings_starting })), 'var(--primary)');

  // --- Check-in DOW ---
  renderDowHbar('checkinDowBars', dow.map(d => ({ day: d.day, count: d.bookings_starting })), 'var(--teal)');

  // --- Check-out DOW ---
  // We need checkout DOW from bookings data; approximate from dow_stats if available
  const checkoutDow = data.checkout_dow_stats || dow.map(d => ({ day: d.day, count: d.bookings_ending || d.bookings_starting }));
  renderDowHbar('checkoutDowBars', checkoutDow.map(d => ({ day: d.day, count: d.count || d.bookings_ending || 0 })), 'var(--purple)');

  // --- Avg Stay by Property ---
  const avgStayEl = document.getElementById('avgStayByProperty');
  if (avgStayEl) {
    const rbp = data.revenue_by_property || [];
    if (rbp.length > 0) {
      const maxStay = Math.max(...rbp.map(p => {
        const avgLos = p.nights > 0 && p.bookings > 0 ? p.nights / p.bookings : 0;
        return avgLos;
      }), 1);
      avgStayEl.innerHTML = rbp.map(p => {
        const avgLos = p.nights > 0 && p.bookings > 0 ? (p.nights / p.bookings).toFixed(1) : '0';
        const pct = Math.round((parseFloat(avgLos) / maxStay) * 100);
        return `<div class="hbar-item">
          <div class="hbar-label">${escHtml(p.property)}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct, 2)}%;background:var(--primary)">${pct >= 30 ? `<span>${avgLos}</span>` : ''}</div></div>
          <div class="hbar-value">${avgLos} nights</div>
        </div>`;
      }).join('');

      // Insight callout
      const insightEl = document.getElementById('avgStayInsight');
      if (insightEl && rbp.length > 1) {
        const sorted = rbp.map(p => ({
          name: p.property,
          los: p.nights > 0 && p.bookings > 0 ? p.nights / p.bookings : 0
        })).sort((a, b) => b.los - a.los);
        const longest = sorted[0];
        const shortest = sorted[sorted.length - 1];
        if (shortest.los > 0) {
          const pctMore = Math.round(((longest.los - shortest.los) / shortest.los) * 100);
          insightEl.innerHTML = `<div class="callout"><div class="callout-icon" style="background:var(--teal-bg,#f0fdfa);color:var(--teal)">📊</div>
            <div class="callout-text">${escHtml(longest.name)} guests stay <strong>${pctMore}% longer</strong> on average than ${escHtml(shortest.name)}. Consider promoting multi-night discounts at shorter-stay properties.</div></div>`;
        }
      }
    } else {
      avgStayEl.innerHTML = '<div style="color:var(--gray-400);">No data</div>';
    }
  }

  // --- Booking Time of Day (3h bins, hbar style matching DOW charts) ---
  const hourEl = document.getElementById('bookingHourBars');
  if (hourEl) {
    const hours = data.hour_distribution || [];
    const BIN_LABELS = ['12am–3am', '3am–6am', '6am–9am', '9am–12pm', '12pm–3pm', '3pm–6pm', '6pm–9pm', '9pm–12am'];
    const bins = BIN_LABELS.map((label, i) => {
      const startH = i * 3;
      const count = hours.filter(h => h.hour >= startH && h.hour < startH + 3).reduce((s, h) => s + h.count, 0);
      return { label, count };
    });
    const total = bins.reduce((s, b) => s + b.count, 0) || 1;
    const maxPct = Math.max(...bins.map(b => (b.count / total) * 100));
    const color = '#e67e22';
    hourEl.innerHTML = bins.map(b => {
      const pct = Math.round((b.count / total) * 100);
      const isMax = pct === Math.round(maxPct) && b.count > 0;
      const fillColor = isMax ? '#d35400' : color;
      return `<div class="hbar-item">
        <div class="hbar-label">${b.label}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct, 1)}%;background:${fillColor}">${pct >= 18 ? `<span>${pct}%</span>` : ''}</div></div>
        <div class="hbar-value"${isMax ? ' style="color:#d35400"' : ''}>${pct}%</div>
      </div>`;
    }).join('');
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
            <div><span style="color:#666;font-size:0.85rem;">Your ADR</span><br><strong>${fmtMoney(pos.your_adr || 0)}</strong></div>
            <div><span style="color:#666;font-size:0.85rem;">Market Avg</span><br><strong>${fmtMoney(pos.market_avg || 0)}</strong></div>
            <div><span style="color:${color};font-weight:600;font-size:0.85rem;">${position}</span><br><strong style="color:${color};">${diff >= 0 ? '+' : ''}${fmtMoney(Math.abs(diff))}</strong></div>
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
            <td>${fmtMoney(c.adr || 0)}</td>
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

/* ───── Reviews Tab (Mockup style) ───── */

async function syncReviews() {
  const btn = document.getElementById('syncReviewsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  try {
    const res = await api('/api/analytics/reviews/sync', { method: 'POST', body: JSON.stringify({}) });
    if (res && res.results) {
      const msgs = Object.entries(res.results).map(([name, r]) => {
        if (r.skipped) return `${name}: skipped (${r.reason})`;
        if (r.error) return `${name}: error - ${r.error}`;
        return `${name}: ${r.total} reviews (Airbnb: ${r.airbnb}, Booking: ${r.booking})`;
      });
      showToast(msgs.join(' | '));
      loadAnalytics(); // Reload data
    } else {
      showToast('Sync completed', 'success');
    }
  } catch (err) {
    showToast('Review sync failed: ' + (err.message || 'unknown error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/></svg> Sync Reviews from Platforms'; }
  }
}

function renderReviewsTab() {
  const reviews = data.recent_reviews || [];
  const rbp = data.reviews_by_property || [];
  const AVATAR_COLORS = ['var(--primary)', 'var(--purple)', 'var(--warning)', 'var(--teal)', 'var(--danger)'];

  // Property select for add form
  const select = document.getElementById('reviewPropertySelect');
  if (select) {
    const existingOpts = select.querySelectorAll('option');
    if (existingOpts.length <= 1) {
      select.innerHTML = (data._properties || [])
        .map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`)
        .join('');
    }
  }

  // --- KPIs ---
  const totalReviews = reviews.length;
  const avgRating = totalReviews > 0
    ? Math.round(reviews.reduce((s, r) => s + (r.rating || 0), 0) / totalReviews * 10) / 10
    : 0;
  const fiveStarCount = reviews.filter(r => Math.round(r.rating) === 5).length;
  const fiveStarRate = totalReviews > 0 ? Math.round((fiveStarCount / totalReviews) * 100) : 0;

  document.getElementById('reviewsKpiGrid').innerHTML = [
    { label: 'Overall Rating', value: avgRating > 0 ? `${avgRating} ★` : '—', sub: `<span class="neutral">${totalReviews} reviews total</span>` },
    { label: 'Total Reviews', value: totalReviews, sub: `<span class="neutral">across all properties</span>` },
    { label: '5-Star Rate', value: `${fiveStarRate}%`, sub: `<span class="neutral">${fiveStarCount} five-star reviews</span>` },
    { label: 'Properties Rated', value: rbp.filter(r => r.count > 0).length, sub: `<span class="neutral">of ${rbp.length} total</span>` },
  ].map(k => `<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');

  // --- Rating Distribution (hbar by star level) ---
  const ratingDist = document.getElementById('ratingDistribution');
  if (ratingDist) {
    const starCounts = [0, 0, 0, 0, 0]; // 1-star to 5-star
    reviews.forEach(r => {
      const star = Math.min(5, Math.max(1, Math.round(r.rating || 0)));
      starCounts[star - 1]++;
    });
    const starLabels = ['★', '★★', '★★★', '★★★★', '★★★★★'];
    const starColors = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--primary)', 'var(--success)'];
    ratingDist.innerHTML = totalReviews === 0
      ? '<div style="color:var(--gray-400);padding:1rem;">No reviews yet.</div>'
      : [4, 3, 2, 1, 0].map(i => {
          const pct = Math.round((starCounts[i] / totalReviews) * 100);
          return `<div class="hbar-item">
            <div class="hbar-label">${starLabels[i]}</div>
            <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct, 1)}%;background:${starColors[i]}">${pct >= 15 ? `<span>${pct}%</span>` : ''}</div></div>
            <div class="hbar-value">${starCounts[i]}</div>
          </div>`;
        }).join('');
  }

  // --- Ratings by Property (compare rows) ---
  const ratingsByProp = document.getElementById('ratingsByProperty');
  if (ratingsByProp) {
    if (rbp.length === 0 || rbp.every(r => r.count === 0)) {
      ratingsByProp.innerHTML = '<div style="color:var(--gray-400);padding:1rem;">No reviews yet.</div>';
    } else {
      ratingsByProp.innerHTML = rbp.filter(r => r.count > 0).map(r => {
        const rating = r.avg_rating || 0;
        const pct = Math.round((rating / 5) * 100);
        let color = 'var(--success)';
        if (rating < 4) color = 'var(--warning)';
        if (rating < 3) color = 'var(--danger)';
        return `<div class="compare-row">
          <div class="compare-label">${escHtml(r.property)}</div>
          <div class="compare-bar"><div class="compare-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="compare-val" style="color:${color}">${rating.toFixed(1)}</div>
        </div>`;
      }).join('');
    }
  }

  // --- Recent Reviews (review-items) ---
  const recentEl = document.getElementById('recentReviewsList');
  if (recentEl) {
    recentEl.innerHTML = reviews.length === 0
      ? '<div style="color:var(--gray-400);padding:1rem;">No reviews yet. Add reviews below to track them.</div>'
      : reviews.slice(0, 10).map((r, i) => {
          const guestName = r.guest_name || 'Anonymous';
          const initials = guestName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
          const stars = '★'.repeat(Math.round(r.rating || 0));
          const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
          const dateStr = r.review_date ? new Date(r.review_date + 'T00:00:00').toLocaleDateString('en-ZA', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
          return `<div class="review-item">
            <div class="review-header">
              <div class="review-guest">
                <div class="review-avatar" style="background:${avatarColor}">${initials}</div>
                <div>
                  <div class="review-name">${escHtml(guestName)}</div>
                  <div class="review-date">${dateStr}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="review-stars"><span class="star">${stars}</span></div>
                <button class="btn btn-danger btn-sm" onclick="deleteReview(${r.id})" style="font-size:11px;padding:2px 8px;">×</button>
              </div>
            </div>
            ${r.comment ? `<div class="review-text">${escHtml(r.comment)}</div>` : ''}
            <div class="review-property">${escHtml(r.property_name || '')} · via ${escHtml(r.platform || 'Unknown')}</div>
          </div>`;
        }).join('');
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

/* ───── Insights Tab (Mockup style — 4 categorized insight panels) ───── */

function renderInsightsTab() {
  const s = data.summary;
  const p = data.prior_summary;
  const properties = data._properties || [];
  const propNameMap = {};
  for (const prop of properties) propNameMap[prop.id] = prop.name;

  const ICONS = {
    trendUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2C14.5 4.7 16 8.2 16 12S14.5 19.3 12 22C9.5 19.3 8 15.8 8 12S9.5 4.7 12 2"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    rand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><text x="12" y="16" font-size="12" font-weight="700" fill="currentColor" text-anchor="middle" font-family="Inter">R</text></svg>',
  };

  function insightHtml(icon, color, title, desc) {
    return `<div class="insight-item"><div class="insight-icon ${color}">${icon}</div><div class="insight-text"><div class="title">${title}</div><div class="desc">${desc}</div></div></div>`;
  }

  // ─── Revenue & Pricing ───
  const revInsights = [];
  const revTimeline = data.revenue_timeline || [];
  if (revTimeline.length >= 2) {
    const last = revTimeline[revTimeline.length - 1];
    const prev = revTimeline[revTimeline.length - 2];
    const change = prev.total > 0 ? Math.round(((last.total - prev.total) / prev.total) * 100) : 0;
    const color = change >= 0 ? 'green' : 'red';
    revInsights.push(insightHtml(ICONS.trendUp, color,
      `Revenue ${change >= 0 ? 'trending up' : 'trending down'} ${Math.abs(change)}%`,
      `${fmtMonth(last.month)} revenue is ${fmtMoney(last.total)} vs ${fmtMoney(prev.total)} in ${fmtMonth(prev.month)}.`));
  }
  // Pricing opportunity — find property with lowest ADR
  const rbp = [...(data.revenue_by_property || [])].filter(r => r.total > 0);
  if (rbp.length > 1) {
    const sorted = rbp.sort((a, b) => {
      const aAdr = a.nights > 0 ? a.total / a.nights : 0;
      const bAdr = b.nights > 0 ? b.total / b.nights : 0;
      return aAdr - bAdr;
    });
    const best = sorted[sorted.length - 1];
    const bestAdr = best.nights > 0 ? Math.round(best.total / best.nights) : 0;
    revInsights.push(insightHtml(ICONS.rand, 'blue',
      `Top earner: ${escHtml(best.property)}`,
      `Generating ${fmtMoney(best.total)} at ${fmtMoney(bestAdr)}/night ADR with ${best.bookings} bookings.`));
  }
  // Direct bookings insight
  const directChannel = (data.channel_stats || []).find(c => c.channel === 'Direct');
  if (directChannel && directChannel.bookings > 0) {
    const totalBookings = data.channel_stats.reduce((t, c) => t + c.bookings, 0);
    const directPct = Math.round((directChannel.bookings / totalBookings) * 100);
    revInsights.push(insightHtml(ICONS.check, 'green',
      `Direct bookings at ${directPct}%`,
      `${directChannel.bookings} direct bookings saving on platform commissions. Keep promoting your direct booking link.`));
  }
  document.getElementById('revenuePricingInsights').innerHTML = revInsights.length === 0
    ? insightHtml(ICONS.clock, 'blue', 'Not enough data', 'Sync your booking history to see revenue insights.')
    : revInsights.join('');

  // ─── Occupancy & Demand ───
  const occInsights = [];
  const occByProperty = {};
  for (const o of (data.occupancy_timeline || [])) {
    if (!occByProperty[o.property_id]) occByProperty[o.property_id] = [];
    occByProperty[o.property_id].push(o);
  }
  for (const pid of Object.keys(occByProperty)) {
    const propOcc = occByProperty[pid];
    const propName = propNameMap[pid] || 'Unknown';
    const recent = propOcc.slice(-3);
    if (recent.length > 0) {
      const avgOcc = Math.round(recent.reduce((sum, o) => sum + o.occupancy_rate, 0) / recent.length);
      if (avgOcc < 50) {
        occInsights.push(insightHtml(ICONS.warning, 'yellow',
          `Occupancy gap — ${escHtml(propName)}`,
          `Running at ${avgOcc}% occupancy recently. Consider a 15-20% discount or minimum-stay reduction to fill the gap.`));
      }
    }
  }
  // Seasonality warning
  const seasonality = data._seasonality || {};
  const seasonalMonthly = seasonality.monthly_avg_occupancy || [];
  const now = new Date();
  const winterMonths = [6, 7, 8]; // Jun, Jul, Aug
  const currentMonth = now.getMonth() + 1;
  if (currentMonth <= 5) { // If before winter, warn
    const winterData = seasonalMonthly.filter(m => winterMonths.includes(m.month_num));
    if (winterData.length > 0) {
      const avgWinterOcc = Math.round(winterData.reduce((s, m) => s + m.avg_occupancy, 0) / winterData.length);
      if (avgWinterOcc < 60) {
        occInsights.push(insightHtml(ICONS.calendar, 'purple',
          'Winter dip approaching (Jun–Aug)',
          `Based on historical data, expect ~${avgWinterOcc}% occupancy. Plan promotions for long-stay guests and consider winter pricing strategy now.`));
      }
    }
  }
  // Lead time insight
  const avgLeadTime = s.avg_lead_time || 0;
  if (avgLeadTime > 0) {
    const shortLead = (data.lead_time_distribution || []).find(l => l.bucket === '0-1 days');
    const shortPct = shortLead ? Math.round((shortLead.count / Math.max(s.total_bookings, 1)) * 100) : 0;
    if (shortPct >= 10) {
      occInsights.push(insightHtml(ICONS.clock, 'blue',
        'Lead time shortening',
        `${shortPct}% of bookings are same/next-day. Consider a last-minute pricing strategy.`));
    }
  }
  document.getElementById('occupancyDemandInsights').innerHTML = occInsights.length === 0
    ? insightHtml(ICONS.check, 'green', 'Occupancy looks healthy', 'No major gaps detected across your properties.')
    : occInsights.join('');

  // ─── Guest & Channel ───
  const guestInsights = [];
  const guestDemo = data.guest_demographics || {};
  const topCountries = guestDemo.top_countries || [];
  if (topCountries.length > 0) {
    const top = topCountries[0];
    guestInsights.push(insightHtml(ICONS.globe, 'blue',
      `Top guest market: ${escHtml(top.country || 'Unknown')}`,
      `${top.count} guests from ${escHtml(top.country || 'this market')}. Consider tailoring welcome guides and listing descriptions for this audience.`));
  }
  // Cancellation insight
  for (const c of (data.cancellations_by_channel || [])) {
    if (c.rate > 15) {
      guestInsights.push(insightHtml(ICONS.warning, 'yellow',
        `${escHtml(c.channel)} cancellation rate ${c.rate}%`,
        `${c.cancelled} of ${c.total} bookings cancelled. Consider stricter cancellation policy for ${escHtml(c.channel)} listings.`));
    }
  }
  document.getElementById('guestChannelInsights').innerHTML = guestInsights.length === 0
    ? insightHtml(ICONS.globe, 'blue', 'Guest data building up', 'More insights will appear as you accumulate bookings from different markets.')
    : guestInsights.join('');

  // ─── Reviews & Quality ───
  const reviewInsights = [];
  const reviewsByProp = data.reviews_by_property || [];
  const allReviews = data.recent_reviews || [];
  if (allReviews.length > 0) {
    const avgRating = allReviews.reduce((s, r) => s + (r.rating || 0), 0) / allReviews.length;
    if (avgRating >= 4.5) {
      reviewInsights.push(insightHtml(ICONS.check, 'green',
        'Overall ratings excellent',
        `${avgRating.toFixed(1)}/5 across ${allReviews.length} reviews. Keep up the great work!`));
    } else if (avgRating < 4) {
      reviewInsights.push(insightHtml(ICONS.x, 'red',
        'Ratings need attention',
        `Overall ${avgRating.toFixed(1)}/5 across ${allReviews.length} reviews. Focus on addressing guest feedback.`));
    }
  }
  // Find lowest-rated property
  const ratedProps = reviewsByProp.filter(r => r.count >= 2 && r.avg_rating > 0);
  if (ratedProps.length > 1) {
    const lowest = ratedProps.sort((a, b) => a.avg_rating - b.avg_rating)[0];
    if (lowest.avg_rating < 4.5) {
      reviewInsights.push(insightHtml(ICONS.star, 'yellow',
        `"${escHtml(lowest.property)}" could improve`,
        `Rated ${lowest.avg_rating}/5 from ${lowest.count} reviews. Small touches (welcome amenities, late checkout) can help.`));
    }
  }
  document.getElementById('reviewsQualityInsights').innerHTML = reviewInsights.length === 0
    ? insightHtml(ICONS.star, 'blue', 'Add reviews to see insights', 'Track your guest reviews to get quality insights and improvement suggestions.')
    : reviewInsights.join('');

  // --- Predictions table ---
  const preds = buildSeasonalPredictions();
  document.getElementById('predictionsTable').innerHTML = preds.length === 0
    ? '<tbody><tr><td>Need at least 3 months of data for predictions.</td></tr></tbody>'
    : `<thead><tr><th>Month</th><th>Predicted Revenue</th><th>Est. Bookings</th><th>Est. Nights</th></tr></thead>
       <tbody>${preds.map(pr => `<tr>
         <td>${fmtMonth(pr.month)} <span class="prediction-badge">forecast</span></td>
         <td>${fmtMoney(pr.predicted_revenue)}</td><td>~${pr.predicted_bookings}</td><td>~${pr.predicted_nights}</td>
       </tr>`).join('')}</tbody>`;

  // Pipeline
  document.getElementById('pipelineSummary').innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);">
      <div class="kpi-card"><div class="kpi-label">Confirmed Future Revenue</div><div class="kpi-value">${fmtMoney(s.future_revenue)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Upcoming Bookings</div><div class="kpi-value">${s.future_bookings}</div></div>
      <div class="kpi-card"><div class="kpi-label">Future Nights Booked</div><div class="kpi-value">${s.future_nights}</div></div>
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
        <div class="bar-value">${item.predicted ? '~' : ''}${fmtMoney(v)}</div>
        <div class="bar" style="height:${h}%;background:${bg};border:${border};" title="${label}: ${fmtMoney(v)}${item.predicted ? ' (predicted)' : ''}"></div>
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

/* ───── Inject topbar controls ───── */

function injectTopbarControls() {
  const toolbar = document.getElementById('pageToolbar');
  if (!toolbar) return;

  const btnStyle = 'padding:5px 10px;font-size:12px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
  toolbar.innerHTML = `
    <div class="period-tabs" id="dateRangeBar" style="margin:0;">
      <button class="period-tab" data-range="30d" onclick="setDateRange('30d')">30D</button>
      <button class="period-tab" data-range="90d" onclick="setDateRange('90d')">90D</button>
      <button class="period-tab" data-range="6m" onclick="setDateRange('6m')">6M</button>
      <button class="period-tab active" data-range="12m" onclick="setDateRange('12m')">1Y</button>
      <button class="period-tab" data-range="ytd" onclick="setDateRange('ytd')">YTD</button>
      <button class="period-tab" data-range="custom" onclick="showCustomRange()">Custom</button>
    </div>
    <span id="customDateInputs" style="display:none;align-items:center;gap:4px;">
      <input type="date" id="customFrom" style="padding:4px 6px;border:1px solid var(--gray-300);border-radius:4px;font-size:11px;font-family:inherit;">
      <span style="font-size:11px;color:var(--gray-500);">to</span>
      <input type="date" id="customTo" style="padding:4px 6px;border:1px solid var(--gray-300);border-radius:4px;font-size:11px;font-family:inherit;">
      <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" type="button" onclick="setDateRange('custom')">Apply</button>
    </span>
    <span id="dateRangeDisplay" style="font-size:12px;color:var(--gray-500);display:inline-flex;align-items:center;gap:4px;white-space:nowrap;"></span>
    <span style="width:1px;height:20px;background:var(--gray-200);flex-shrink:0;"></span>
    <button class="btn btn-secondary" style="${btnStyle}" onclick="syncHistory()">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      Sync
    </button>
    <button class="btn btn-secondary" style="${btnStyle}" onclick="syncRates()">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
      Rates
    </button>
    <button class="btn btn-secondary" style="${btnStyle}" onclick="exportAnalytics()">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15V19A2 2 0 0119 21H5A2 2 0 013 19V15"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Export
    </button>
    <span id="syncStatus" style="font-size:11px;color:var(--gray-500);"></span>
  `;
}

/* ───── Init ───── */

document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth();
  if (!user) return;
  injectTopbarControls();
  initDateRangeBar();
  loadAnalytics();
});
