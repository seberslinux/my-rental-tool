/* dashboard.js – Enhanced dashboard */

let bookings = [];
let stats = {};
let properties = [];
let cleaners = [];
let pnlData = null;
let currentMonth = new Date();
let bookingsMonthFilter = '';

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

/* ───── Sync buttons ───── */

async function syncAll() {
  document.getElementById('syncStatus').textContent = 'Syncing...';
  try {
    const [propData, bookData] = await Promise.all([
      api('/api/sync/properties', { method: 'POST' }),
      api('/api/sync/bookings', { method: 'POST' }),
    ]);
    document.getElementById('syncStatus').textContent = `Synced ${propData.synced} properties, ${bookData.synced} bookings`;
    loadAll();
  } catch (err) {
    document.getElementById('syncStatus').textContent = 'Sync failed: ' + err.message;
  }
}

async function syncProperties() {
  document.getElementById('syncStatus').textContent = 'Syncing properties...';
  try {
    const data = await api('/api/sync/properties', { method: 'POST' });
    document.getElementById('syncStatus').textContent = `Synced ${data.synced} properties`;
    loadAll();
  } catch (err) {
    document.getElementById('syncStatus').textContent = 'Sync failed: ' + err.message;
  }
}

async function syncBookings() {
  document.getElementById('syncStatus').textContent = 'Syncing bookings...';
  try {
    const data = await api('/api/sync/bookings', { method: 'POST' });
    document.getElementById('syncStatus').textContent = `Synced ${data.synced} bookings`;
    loadAll();
  } catch (err) {
    document.getElementById('syncStatus').textContent = 'Sync failed: ' + err.message;
  }
}

async function runPricing() {
  document.getElementById('syncStatus').textContent = 'Running pricing engine...';
  try {
    await api('/api/pricing/run', { method: 'POST' });
    document.getElementById('syncStatus').textContent = 'Pricing engine completed';
  } catch (err) {
    document.getElementById('syncStatus').textContent = 'Pricing failed: ' + err.message;
  }
}

/* ───── Property filter helper ───── */

function filterByProperty(list, propKey) {
  const ids = getSelectedPropertyIds();
  if (ids.includes('all')) return list;
  const idSet = new Set(ids);
  return list.filter((item) => idSet.has(String(item[propKey || 'property_id'])));
}

/* ───── Load all data ───── */

async function loadAll() {
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Set default bookings month filter to current month
    if (!bookingsMonthFilter) {
      bookingsMonthFilter = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthInput = document.getElementById('bookingsMonth');
      if (monthInput) monthInput.value = bookingsMonthFilter;
    }

    const fetches = [
      api('/api/bookings'),
      api('/api/dashboard/stats'),
      api('/api/properties'),
      api('/api/cleaners').catch(() => []),
    ];

    // Finances PnL — may not be available yet
    const propParam = getPropertyIdsParam();
    let pnlPromise;
    try {
      pnlPromise = api(`/api/finances/pnl?property_id=${encodeURIComponent(propParam)}&from=${monthStart}&to=${monthEnd}`);
    } catch (_) {
      pnlPromise = Promise.resolve(null);
    }
    fetches.push(pnlPromise.catch(() => null));

    const [bookingsData, statsData, propertiesData, cleanersData, pnlResult] = await Promise.all(fetches);

    bookings = bookingsData?.bookings || bookingsData || [];
    stats = statsData;
    properties = propertiesData;
    cleaners = cleanersData || [];
    pnlData = pnlResult;

    renderKpis(pnlData);
    renderStats(propertiesData);
    renderCheckouts();
    renderCheckins();
    renderAlerts();
    renderGaps();
    renderBookings();
    renderJobs();
    populatePropertyFilter(propertiesData);
    renderCalendar();
    populateJumpMonth();
    renderPipeline();
  } catch (err) {
    console.error('Load failed:', err);
  }
}

/* ───── KPI row ───── */

function renderKpis(pnl) {
  const grid = document.getElementById('kpiRow');
  if (!grid) return;

  const summary = (pnl && pnl.summary) ? pnl.summary : {};
  const revenueThisMonth = summary.total_revenue || 0;
  const profitThisMonth = summary.net_profit || 0;
  const totalCosts = summary.total_costs || 0;

  // Pipeline: future confirmed bookings revenue
  const today = new Date().toISOString().split('T')[0];
  const futureBookings = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_in > today);
  const pipelineRevenue = futureBookings.reduce((sum, b) => sum + (b.converted_total_price || b.total_price || 0), 0);

  const profitNote = totalCosts === 0 ? ' *' : '';

  grid.innerHTML = `
    <div class="metric-card">
      <div class="metric-header">
        <div class="metric-label">Revenue This Month</div>
        <div class="metric-icon blue">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </div>
      </div>
      <div class="metric-value">${fmtMoney(revenueThisMonth)}</div>
      <span class="metric-change neutral">This month</span>
    </div>
    <div class="metric-card">
      <div class="metric-header">
        <div class="metric-label">Profit This Month</div>
        <div class="metric-icon green">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-4a2 2 0 100 4h2a2 2 0 110 4H8"/></svg>
        </div>
      </div>
      <div class="metric-value">${fmtMoney(profitThisMonth)}${profitNote}</div>
      <span class="metric-change ${totalCosts === 0 ? 'neutral' : (profitThisMonth >= 0 ? 'up' : 'down')}">${totalCosts === 0 ? 'Estimate only' : (profitThisMonth >= 0 ? 'Positive' : 'Negative')}</span>
    </div>
    <div class="metric-card">
      <div class="metric-header">
        <div class="metric-label">Revenue Pipeline</div>
        <div class="metric-icon amber">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
      </div>
      <div class="metric-value">${fmtMoney(pipelineRevenue)}</div>
      <span class="metric-change up">${futureBookings.length} upcoming bookings</span>
    </div>`;

  // No costs banner
  let banner = document.getElementById('noCostsBanner');
  if (banner) {
    if (totalCosts === 0 && revenueThisMonth > 0) {
      banner.innerHTML = '<div class="alert-banner warning"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>No costs configured — profit figures are estimates only. <a href="/finances.html#cost-settings">Add fixed costs in Cost Settings &rarr;</a></div>';
    } else {
      banner.innerHTML = '';
    }
  }
}

/* ───── Stats grid (occupancy per property) ───── */

function renderStats(propertiesList) {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;

  if (!stats.occupancy) {
    grid.innerHTML = '<div class="loading">No data yet. Sync properties and bookings first.</div>';
    return;
  }

  const filtered = filterByProperty(stats.occupancy, 'property_id');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="loading">No occupancy data for selected property.</div>';
    return;
  }

  // Calculate ADR and RevPAR
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const recent30 = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_in >= thirtyDaysAgo && b.check_in <= today);
  const totalPrice30 = recent30.reduce((sum, b) => sum + (b.converted_total_price || b.total_price || 0), 0);
  const totalNights30 = recent30.reduce((sum, b) => {
    const ci = new Date(b.check_in);
    const co = new Date(b.check_out);
    return sum + Math.max(1, Math.round((co - ci) / (24 * 60 * 60 * 1000)));
  }, 0);
  const adr = totalNights30 > 0 ? totalPrice30 / totalNights30 : 0;
  const avgOcc = filtered.length > 0 ? Math.round(filtered.reduce((s, o) => s + o.occupancy_rate, 0) / filtered.length) : 0;
  const revpar = adr * (avgOcc / 100);

  let html = filtered.map((o) => {
    const fillClass = o.occupancy_rate > 70 ? 'green' : o.occupancy_rate > 40 ? 'amber' : 'red';
    return `
    <div class="occupancy-card">
      <div class="label">${escHtml(o.name)} — Occupancy (30d)</div>
      <div class="value-row">
        <span class="value">${o.occupancy_rate}%</span>
        <span class="sub">${o.booked_nights} / 30 nights</span>
      </div>
      <div class="progress-bar"><div class="fill ${fillClass}" style="width:${o.occupancy_rate}%"></div></div>
    </div>`;
  }).join('');

  // Portfolio average card
  html += `
    <div class="occupancy-card">
      <div class="label">Portfolio Avg (30d)</div>
      <div class="value-row">
        <span class="value">${avgOcc}%</span>
        <span class="sub">ADR ${fmtMoney(adr)} · RevPAR ${fmtMoney(revpar)}</span>
      </div>
      <div class="progress-bar"><div class="fill ${avgOcc > 70 ? 'green' : avgOcc > 40 ? 'amber' : 'red'}" style="width:${avgOcc}%"></div></div>
    </div>`;

  grid.innerHTML = html;
}

/* ───── Upcoming check-outs ───── */

function renderCheckouts() {
  const tbody = document.getElementById('checkoutTable');
  if (!tbody) return;
  const countEl = document.getElementById('checkoutCount');
  const checkouts = filterByProperty(stats.upcoming_checkouts || [], 'property_id');
  const jobs = stats.pending_cleaning_jobs || [];

  if (countEl) countEl.textContent = checkouts.length;

  if (checkouts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No upcoming check-outs in the next 48 hours.</td></tr>';
    return;
  }

  tbody.innerHTML = checkouts.map((b) => {
    const job = jobs.find((j) => j.property_id === b.property_id && j.cleaning_date === b.check_out);
    const cleanerCell = job ? escHtml(job.cleaner_name) : '\u2014';
    const statusCell = job
      ? '<span class="status-dot assigned">Assigned</span>'
      : '<span class="status-dot unassigned">Unassigned</span>';
    const actionCell = job
      ? '<a class="action-link" href="#">Details</a>'
      : `<a class="action-link" href="#" onclick="openAssignModal(${b.id || 0}, ${b.property_id}, '${b.check_out}'); return false;">Assign &rarr;</a>`;
    return `
    <tr>
      <td><strong>${escHtml(b.property_name)}</strong></td>
      <td>${escHtml(b.guest_name) || '-'}</td>
      <td>${b.check_out}</td>
      <td>${platformBadge(b.platform)}</td>
      <td>${cleanerCell}</td>
      <td>${statusCell}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');
}

/* ───── Upcoming check-ins ───── */

function renderCheckins() {
  const tbody = document.getElementById('checkinTable');
  if (!tbody) return;

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const checkins = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_in >= today && b.check_in <= tomorrow);

  if (checkins.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No upcoming check-ins in the next 48 hours.</td></tr>';
    return;
  }

  tbody.innerHTML = checkins
    .map((b) => {
      const ci = new Date(b.check_in);
      const co = new Date(b.check_out);
      const nights = Math.max(1, Math.round((co - ci) / (24 * 60 * 60 * 1000)));
      return `
      <tr style="background:#00aa0008">
        <td>${escHtml(b.property_name)}</td>
        <td>${escHtml(b.guest_name) || '-'}</td>
        <td>${b.check_in}</td>
        <td>${platformBadge(b.platform)}</td>
        <td>${nights}</td>
      </tr>`;
    })
    .join('');
}

/* ───── Needs Attention alerts ───── */

function renderAlerts() {
  const container = document.getElementById('alertsList');
  if (!container) return;
  const countEl = document.getElementById('alertsCount');
  const alerts = [];
  const today = new Date().toISOString().split('T')[0];
  const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const jobs = stats.pending_cleaning_jobs || [];

  // 1. Unassigned cleaners: bookings with check_out in next 7 days, no matching cleaning job
  const upcomingCheckouts = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_out >= today && b.check_out <= in7days);
  for (const b of upcomingCheckouts) {
    const hasJob = jobs.some((j) => {
      const jDate = j.cleaning_date;
      const coDate = b.check_out;
      return String(j.property_id) === String(b.property_id) && jDate === coDate;
    });
    if (!hasJob) {
      alerts.push({
        level: 'red',
        text: 'Unassigned cleaner for ' + escHtml(b.property_name) + ' checkout on ' + escHtml(b.check_out),
        link: '/cleaners.html',
        linkText: 'Assign cleaner'
      });
    }
  }

  // 2. Short gaps: count gaps of 1-3 nights this month
  const gaps = filterByProperty(stats.gaps || [], 'property_id');
  const shortGapCount = gaps.length;
  if (shortGapCount > 0) {
    alerts.push({
      level: 'amber',
      text: shortGapCount + ' short gap' + (shortGapCount > 1 ? 's' : '') + ' (1-3 nights) this month — consider last-minute pricing',
      link: '/properties.html#pricing',
      linkText: 'Update pricing'
    });
  }

  // 3. Base price not set
  const filteredProps = filterByProperty(properties, 'id');
  for (const p of filteredProps) {
    if (!p.base_price || p.base_price === 0) {
      alerts.push({
        level: 'amber',
        text: 'Base price not set for ' + escHtml(p.name),
        link: '/properties.html',
        linkText: 'Update pricing'
      });
    }
  }

  // 4. No costs configured
  if (pnlData && pnlData.summary && pnlData.summary.total_costs === 0) {
    alerts.push({
      level: 'amber',
      text: 'No fixed costs entered — profit data unreliable',
      link: '/finances.html#cost-settings',
      linkText: 'Add costs'
    });
  }

  if (alerts.length === 0) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:14px;">No alerts at this time.</p>';
    if (countEl) countEl.textContent = '0';
    return;
  }

  if (countEl) countEl.textContent = alerts.length;

  container.innerHTML = alerts.map((a) => {
    const levelClass = a.level === 'red' ? 'urgent' : (a.level === 'amber' ? 'warning' : 'info');
    return `<div class="attention-item ${levelClass}">
      <span class="text">${a.text}</span>
      <a class="action-link" href="${a.link}">${escHtml(a.linkText)} &rarr;</a>
    </div>`;
  }).join('');
}

/* ───── Assign cleaner modal ───── */

function isCleanerAvailable(cleaner, dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const override = (cleaner.overrides || []).find(o => o.date === dateStr);
  if (override) return { available: !!override.available, reason: override.available ? 'Override: Available' : 'Override: Unavailable' };
  const weeklySlot = (cleaner.availability || []).find(a => a.day_of_week === dow);
  if (weeklySlot) return { available: true, reason: `${weeklySlot.start_time}\u2013${weeklySlot.end_time}` };
  return { available: false, reason: 'No schedule for this day' };
}

function openAssignModal(bookingId, propertyId, date) {
  const modal = document.getElementById('assignCleanerModal');
  const info = document.getElementById('assignModalInfo');
  const list = document.getElementById('availableCleanersList');

  const propName = (properties || []).find(p => p.id === propertyId)?.name || `Property ${propertyId}`;
  info.innerHTML = `Assign cleaner for <strong>${escHtml(propName)}</strong> on <strong>${date}</strong>`;

  // Filter cleaners assigned to this property (or all if no assignment data)
  const candidates = cleaners.filter((c) => {
    if (c.properties && Array.isArray(c.properties)) {
      return c.properties.some(p => p.id === propertyId);
    }
    return true;
  });

  if (candidates.length === 0) {
    list.innerHTML = '<p>No cleaners assigned to this property. Assign a cleaner on the <a href="/cleaners.html">Cleaners page</a> first.</p>';
  } else {
    const availableList = [];
    const unavailableList = [];

    for (const c of candidates) {
      const status = isCleanerAvailable(c, date);
      if (status.available) {
        availableList.push({ cleaner: c, status });
      } else {
        unavailableList.push({ cleaner: c, status });
      }
    }

    let html = '';

    if (availableList.length > 0) {
      html += '<div style="margin-bottom:0.5rem;font-weight:600;color:#166534;">Available</div>';
      html += availableList.map(({ cleaner: c, status }) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #eee;">
          <div>
            <span style="font-weight:500;">${escHtml(c.name)}</span>
            <span class="avail-badge available">${escHtml(status.reason)}</span>
          </div>
          <button class="btn btn-primary btn-sm" onclick="assignCleaner(${bookingId}, ${propertyId}, '${date}', ${c.id})">Assign</button>
        </div>`).join('');
    }

    if (unavailableList.length > 0) {
      html += `<div style="margin-top:${availableList.length > 0 ? '1rem' : '0'};margin-bottom:0.5rem;font-weight:600;color:#991b1b;">Unavailable</div>`;
      html += unavailableList.map(({ cleaner: c, status }) => `
        <div class="avail-warning" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <div>
            <span style="font-weight:500;">${escHtml(c.name)}</span>
            <span class="avail-badge unavailable">${escHtml(status.reason)}</span>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-secondary btn-sm" onclick="overrideAndAssign(${bookingId}, ${propertyId}, '${date}', ${c.id})" title="Mark available and assign">Override &amp; Assign</button>
          </div>
        </div>`).join('');
    }

    if (availableList.length === 0) {
      html = '<div class="avail-warning" style="margin-bottom:0.75rem;">No cleaners are available on this date. You can override availability and assign anyway.</div>' + html;
    }

    list.innerHTML = html;
  }

  modal.style.display = 'flex';
}

function closeAssignModal() {
  document.getElementById('assignCleanerModal').style.display = 'none';
}

async function overrideAndAssign(bookingId, propertyId, date, cleanerId) {
  if (!confirm('This cleaner is not available on this date. Mark them as available and assign anyway?')) return;
  try {
    await api(`/api/cleaners/${cleanerId}/overrides`, {
      method: 'POST',
      body: JSON.stringify({ date, available: true }),
    });
    await assignCleaner(bookingId, propertyId, date, cleanerId);
  } catch (err) {
    alert('Failed to override availability: ' + err.message);
  }
}

async function assignCleaner(bookingId, propertyId, date, cleanerId) {
  try {
    const result = await api('/api/cleaners/jobs/assign', {
      method: 'POST',
      body: JSON.stringify({
        booking_id: bookingId,
        property_id: propertyId,
        cleaner_id: cleanerId,
        cleaning_date: date,
      }),
    });
    if (result && result.error) {
      alert('Failed to assign cleaner: ' + result.error);
      return;
    }
    closeAssignModal();
    loadAll();
  } catch (err) {
    console.error('Assign cleaner failed:', err);
    alert('Failed to assign cleaner: ' + err.message);
  }
}

/* ───── Calendar gaps ───── */

function renderGaps() {
  const tbody = document.getElementById('gapsTable');
  if (!tbody) return;
  const countEl = document.getElementById('gapsCount');
  const gaps = filterByProperty(stats.gaps || [], 'property_id');

  if (countEl) countEl.textContent = gaps.length;

  if (gaps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No short gaps detected.</td></tr>';
    return;
  }

  tbody.innerHTML = gaps.map((g, i) => `
    <tr>
      <td><strong>${escHtml(g.property_name)}</strong></td>
      <td>${g.gap_start}</td>
      <td>${g.gap_end}</td>
      <td><span class="gap-nights ${g.nights <= 1 ? 'short' : 'long'}">${g.nights} night${g.nights > 1 ? 's' : ''}</span></td>
      <td><button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="openGapDiscountModal(${i})">Apply Discount</button></td>
    </tr>`).join('');
}

/* ───── Gap discount modal ───── */

let _currentGapPromoText = '';

function openGapDiscountModal(gapIndex) {
  const gaps = filterByProperty(stats.gaps || [], 'property_id');
  const g = gaps[gapIndex];
  if (!g) return;

  const prop = properties.find((p) => String(p.id) === String(g.property_id));
  const basePrice = prop && prop.base_price ? Number(prop.base_price) : 0;
  const discountPct = g.nights === 1 ? 15 : 10;
  const discountedPrice = Math.round(basePrice * (1 - discountPct / 100));

  document.getElementById('gapDiscountInfo').innerHTML =
    '<strong>' + escHtml(g.property_name) + '</strong> — ' + escHtml(g.gap_start) + ' to ' + escHtml(g.gap_end) + ' (' + g.nights + ' night' + (g.nights > 1 ? 's' : '') + ')';
  document.getElementById('gapBasePrice').textContent = fmtMoney(basePrice) + '/night';
  document.getElementById('gapDiscountPct').textContent = discountPct + '%';
  document.getElementById('gapDiscountedPrice').textContent = fmtMoney(discountedPrice) + '/night';

  _currentGapPromoText = g.nights + ' night' + (g.nights > 1 ? 's' : '') + ' available ' + g.gap_start + ' to ' + g.gap_end + ' \u2014 book now for R' + discountedPrice + '/night!';

  document.getElementById('gapCopyPromoBtn').textContent = 'Copy Promo Text';
  document.getElementById('gapDiscountModal').style.display = 'flex';
}

function closeGapDiscountModal() {
  document.getElementById('gapDiscountModal').style.display = 'none';
}

function copyGapPromoText() {
  navigator.clipboard.writeText(_currentGapPromoText).then(function() {
    document.getElementById('gapCopyPromoBtn').textContent = 'Copied! \u2713';
    setTimeout(function() {
      document.getElementById('gapCopyPromoBtn').textContent = 'Copy Promo Text';
    }, 2000);
  }).catch(function() {
    var ta = document.createElement('textarea');
    ta.value = _currentGapPromoText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    document.getElementById('gapCopyPromoBtn').textContent = 'Copied! \u2713';
    setTimeout(function() {
      document.getElementById('gapCopyPromoBtn').textContent = 'Copy Promo Text';
    }, 2000);
  });
}

/* ───── Apply all gap discounts ───── */

function applyAllGapDiscounts() {
  const gaps = filterByProperty(stats.gaps || [], 'property_id');
  if (gaps.length === 0) return;
  openGapDiscountModal(0);
}

/* ───── All Bookings ───── */

function renderBookings() {
  const tbody = document.getElementById('bookingsTable');
  if (!tbody) return;
  const monthInput = document.getElementById('bookingsMonth');
  bookingsMonthFilter = monthInput ? monthInput.value : bookingsMonthFilter;

  let filtered = filterByProperty(bookings, 'property_id');

  // Filter by month if set
  if (bookingsMonthFilter) {
    filtered = filtered.filter((b) => {
      const checkinMonth = b.check_in ? b.check_in.substring(0, 7) : '';
      const checkoutMonth = b.check_out ? b.check_out.substring(0, 7) : '';
      return checkinMonth === bookingsMonthFilter || checkoutMonth === bookingsMonthFilter;
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No bookings found for selected period.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (b) => {
        const ci = new Date(b.check_in);
        const co = new Date(b.check_out);
        const nights = Math.max(1, Math.round((co - ci) / (24 * 60 * 60 * 1000)));
        const bookingJson = encodeURIComponent(JSON.stringify({
          property: b.property_name, guest: b.guest_name || '-',
          ci: b.check_in, co: b.check_out, platform: b.platform || 'Direct',
          price: b.converted_total_price || b.total_price || 0, status: b.status, nights: nights
        }));
        return `
      <tr onclick="showBookingDetail('${bookingJson}')" style="cursor:pointer;">
        <td>${escHtml(b.property_name)}</td>
        <td>${escHtml(b.guest_name) || '-'}</td>
        <td>${b.check_in}</td>
        <td>${b.check_out}</td>
        <td>${platformBadge(b.platform)}</td>
        <td>${fmtMoney(b.converted_total_price || b.total_price || 0)}</td>
        <td><span class="badge badge-${b.status}">${escHtml(b.status)}</span></td>
      </tr>`;
      }
    )
    .join('');
}

/* ───── Cleaning jobs ───── */

function renderJobs() {
  const tbody = document.getElementById('jobsTable');
  if (!tbody) return;
  const jobs = filterByProperty(stats.pending_cleaning_jobs || [], 'property_id');
  const today = new Date().toISOString().split('T')[0];
  const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Find upcoming checkouts (next 7 days) with no matching cleaning job
  const upcomingCheckouts = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_out >= today && b.check_out <= in7days);

  const unassignedRows = [];
  for (const b of upcomingCheckouts) {
    const hasJob = jobs.some((j) => String(j.property_id) === String(b.property_id) && j.cleaning_date === b.check_out);
    if (!hasJob) {
      unassignedRows.push(b);
    }
  }

  if (jobs.length === 0 && unassignedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No pending cleaning jobs.</td></tr>';
    return;
  }

  let html = jobs
    .map(
      (j) => `
      <tr>
        <td>${escHtml(j.property_name)}</td>
        <td>${escHtml(j.cleaner_name) || 'Unassigned'}</td>
        <td>${j.cleaning_date}</td>
        <td>${j.start_time} - ${j.end_time}</td>
        <td><span class="badge badge-${j.status}">${escHtml(j.status)}</span></td>
      </tr>`
    )
    .join('');

  html += unassignedRows
    .map(
      (b) => `
      <tr style="background:#fef2f2">
        <td>${escHtml(b.property_name)}</td>
        <td><span style="color:#dc2626;font-weight:600;">Unassigned</span></td>
        <td>${b.check_out}</td>
        <td>-</td>
        <td><a class="btn btn-primary btn-sm" href="/cleaners.html">Assign</a></td>
      </tr>`
    )
    .join('');

  tbody.innerHTML = html;
}

/* ───── Property filter for calendar ───── */

function populatePropertyFilter(propertiesList) {
  const select = document.getElementById('calendarProperty');
  if (!select) return;
  const existing = select.querySelectorAll('option:not(:first-child)');
  existing.forEach((o) => o.remove());

  for (const p of propertiesList) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
}

/* ───── Calendar ───── */

function changeMonth(delta) {
  currentMonth.setMonth(currentMonth.getMonth() + delta);
  renderCalendar();
  updateJumpMonthSelection();
}

function jumpToMonth() {
  const val = document.getElementById('jumpMonth').value;
  if (!val) return;
  const parts = val.split('-');
  currentMonth = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  renderCalendar();
}

function populateJumpMonth() {
  const select = document.getElementById('jumpMonth');
  if (!select) return;

  // Determine range: earliest booking to 6 months from now
  let earliest = new Date();
  let latest = new Date();
  latest.setMonth(latest.getMonth() + 6);

  for (const b of bookings) {
    if (b.check_in) {
      const d = new Date(b.check_in);
      if (d < earliest) earliest = d;
    }
  }

  const options = [];
  const cursor = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  while (cursor <= latest) {
    const val = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const label = cursor.toLocaleString('default', { month: 'short', year: 'numeric' });
    options.push(`<option value="${val}">${label}</option>`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  select.innerHTML = options.join('');
  updateJumpMonthSelection();
}

function updateJumpMonthSelection() {
  const select = document.getElementById('jumpMonth');
  if (!select) return;
  const val = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  select.value = val;
}

function getPlatformClass(platform) {
  if (!platform) return 'booked-direct';
  const p = platform.toLowerCase();
  if (p.includes('airbnb')) return 'booked-airbnb';
  if (p.includes('booking')) return 'booked-booking';
  if (p.includes('vrbo') || p.includes('homeaway')) return 'booked-vrbo';
  return 'booked-direct';
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  const monthLabel = document.getElementById('calendarMonth');
  const calPropSelect = document.getElementById('calendarProperty');
  const calPropFilter = calPropSelect ? calPropSelect.value : 'all';

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  if (monthLabel) {
    monthLabel.textContent = new Date(year, month).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Also apply global property filter
  let filteredBookings = filterByProperty(bookings, 'property_id');
  if (calPropFilter !== 'all') {
    filteredBookings = filteredBookings.filter((b) => String(b.property_id) === String(calPropFilter));
  }

  // Build booked dates map
  const bookedMap = {};
  const gapSet = new Set();

  for (const b of filteredBookings) {
    if (b.status !== 'confirmed') continue;
    let d = new Date(b.check_in);
    const end = new Date(b.check_out);
    while (d < end) {
      const ds = d.toISOString().split('T')[0];
      if (!bookedMap[ds]) bookedMap[ds] = [];
      bookedMap[ds].push(b);
      d.setDate(d.getDate() + 1);
    }
  }

  // Mark gaps
  const filteredGaps = filterByProperty(stats.gaps || [], 'property_id');
  for (const g of filteredGaps) {
    if (calPropFilter !== 'all' && String(g.property_id) !== String(calPropFilter)) continue;
    let d = new Date(g.gap_start);
    const end = new Date(g.gap_end);
    while (d < end) {
      gapSet.add(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = days.map((d) => `<div class="day-header">${d}</div>`).join('');

  // Blank cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="day"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === today;
    const isBooked = bookedMap[dateStr];
    const isCheckoutSoon = dateStr >= today && dateStr <= in48h && isBooked;
    const isGap = gapSet.has(dateStr);

    let classes = 'day';
    if (isToday) classes += ' today';
    if (isBooked) {
      classes += ' booked';
      // Add platform-specific class from the first booking on that day
      classes += ' ' + getPlatformClass(isBooked[0].platform);
    }
    if (isCheckoutSoon) classes += ' checkout-soon';
    if (isGap) classes += ' gap';

    let label = '';
    if (isBooked) {
      const names = [...new Set(isBooked.map((b) => b.guest_name || b.property_name))];
      label = `<div class="booking-label">${escHtml(names.join(', '))}</div>`;
    }
    if (isGap) {
      label += '<div class="booking-label" style="color:#cc8400">GAP</div>';
    }

    if (isBooked) {
      const bookingData = encodeURIComponent(JSON.stringify(isBooked.map(b => ({
        g: b.guest_name || '-', ci: b.check_in, co: b.check_out,
        p: b.platform || 'Direct', pr: b.converted_total_price || b.total_price || 0, s: b.status || '-'
      }))));
      html += `<div class="${classes}" onclick="showBookingPopover(event, '${bookingData}')" style="cursor:pointer;"><div class="date-num">${day}</div>${label}</div>`;
    } else {
      html += `<div class="${classes}"><div class="date-num">${day}</div>${label}</div>`;
    }
  }

  grid.innerHTML = html;
}

/* ───── Booking Detail Modal (All Bookings table) ───── */

function showBookingDetail(encodedData) {
  const b = JSON.parse(decodeURIComponent(encodedData));
  // Remove existing
  const existing = document.getElementById('bookingDetailModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'bookingDetailModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;justify-content:center;align-items:center;';
  modal.innerHTML = `<div style="background:#fff;border-radius:8px;padding:1.5rem;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
    <h2 style="margin-bottom:1rem;font-size:1.1rem;">Booking Details</h2>
    <div style="font-size:0.9rem;line-height:1.8;">
      <div><strong>Property:</strong> ${escHtml(b.property)}</div>
      <div><strong>Guest:</strong> ${escHtml(b.guest)}</div>
      <div><strong>Check-in:</strong> ${escHtml(b.ci)}</div>
      <div><strong>Check-out:</strong> ${escHtml(b.co)}</div>
      <div><strong>Nights:</strong> ${b.nights}</div>
      <div><strong>Platform:</strong> ${escHtml(b.platform)}</div>
      <div><strong>Price:</strong> ${fmtMoney(b.price)}</div>
      <div><strong>Status:</strong> ${escHtml(b.status)}</div>
    </div>
    <div style="text-align:right;margin-top:1rem;"><button class="btn btn-secondary" onclick="document.getElementById('bookingDetailModal').remove()">Close</button></div>
  </div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

/* ───── Booking Popover ───── */

function showBookingPopover(event, encodedData) {
  event.stopPropagation();
  // Remove existing popover
  const existing = document.getElementById('bookingPopover');
  if (existing) existing.remove();

  const bookings = JSON.parse(decodeURIComponent(encodedData));
  const html = bookings.map(b =>
    `<div style="margin-bottom:0.5rem;padding-bottom:0.5rem;border-bottom:1px solid #eee;">
      <div><strong>${escHtml(b.g)}</strong></div>
      <div style="font-size:0.8rem;color:#666;">Check-in: ${escHtml(b.ci)}</div>
      <div style="font-size:0.8rem;color:#666;">Check-out: ${escHtml(b.co)}</div>
      <div style="font-size:0.8rem;color:#666;">Platform: ${escHtml(b.p)}</div>
      <div style="font-size:0.8rem;color:#666;">Price: ${fmtMoney(b.pr)}</div>
      <div style="font-size:0.8rem;color:#666;">Status: ${escHtml(b.s)}</div>
    </div>`
  ).join('');

  const popover = document.createElement('div');
  popover.id = 'bookingPopover';
  popover.style.cssText = 'position:fixed;background:#fff;border:1px solid #ddd;border-radius:8px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:1000;max-width:280px;font-size:0.85rem;';
  popover.innerHTML = html + '<div style="text-align:right;margin-top:0.3rem;"><button class="btn btn-secondary btn-sm" onclick="this.parentElement.parentElement.remove()">Close</button></div>';

  document.body.appendChild(popover);

  // Position near click
  const rect = event.target.closest('.day').getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;
  if (top + 250 > window.innerHeight) top = rect.top - 250;
  if (left + 280 > window.innerWidth) left = window.innerWidth - 290;
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closePopover(e) {
      if (!popover.contains(e.target)) {
        popover.remove();
        document.removeEventListener('click', closePopover);
      }
    });
  }, 10);
}

/* ───── Revenue Pipeline ───── */

function renderPipeline() {
  const container = document.getElementById('pipelineStats');
  if (!container) return;
  const today = new Date().toISOString().split('T')[0];
  const futureBookings = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_in > today);

  const totalRevenue = futureBookings.reduce((sum, b) => sum + (b.converted_total_price || b.total_price || 0), 0);
  const count = futureBookings.length;
  const avgPerBooking = count > 0 ? totalRevenue / count : 0;

  container.innerHTML = `
    <div class="grid">
      <div class="stat-card">
        <div class="value">${fmtMoney(totalRevenue)}</div>
        <div class="label">Total Pipeline Revenue</div>
      </div>
      <div class="stat-card">
        <div class="value">${count}</div>
        <div class="label">Future Bookings</div>
      </div>
      <div class="stat-card">
        <div class="value">${fmtMoney(avgPerBooking)}</div>
        <div class="label">Avg per Booking</div>
      </div>
    </div>`;
}

/* ───── Event listeners & init ───── */

window.addEventListener('propertyChanged', async () => {
  // Re-fetch PnL for new property selection so Revenue/Profit This Month updates
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const propParam = getPropertyIdsParam();
  try {
    pnlData = await api(`/api/finances/pnl?property_id=${encodeURIComponent(propParam)}&from=${monthStart}&to=${monthEnd}`);
  } catch (_) {
    pnlData = null;
  }

  renderKpis(pnlData);
  renderStats(properties);
  renderCheckouts();
  renderCheckins();
  renderAlerts();
  renderGaps();
  renderBookings();
  renderJobs();
  renderCalendar();
  renderPipeline();
});

function injectDashboardToolbar() {
  const toolbar = document.getElementById('pageToolbar');
  if (!toolbar) return;
  const btnStyle = 'padding:5px 10px;font-size:12px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;';
  const isAdmin = currentUser && currentUser.role === 'admin';
  toolbar.innerHTML = `
    ${isAdmin ? `<button class="btn btn-secondary" style="${btnStyle}" onclick="syncAll()">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      Sync
    </button>` : ''}
    <span id="syncStatus" style="font-size:11px;color:var(--gray-500);"></span>
  `;
}

// Initial load (with auth check)
(async () => {
  const user = await checkAuth();
  if (!user) return;
  injectDashboardToolbar();
  loadAll();
})();
