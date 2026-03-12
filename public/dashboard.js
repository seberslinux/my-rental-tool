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
  return res.json();
}

/* ───── Sync buttons ───── */

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
    let pnlPromise;
    try {
      pnlPromise = api(`/api/finances/pnl?from=${monthStart}&to=${monthEnd}`);
    } catch (_) {
      pnlPromise = Promise.resolve(null);
    }
    fetches.push(pnlPromise.catch(() => null));

    const [bookingsData, statsData, propertiesData, cleanersData, pnlResult] = await Promise.all(fetches);

    bookings = bookingsData;
    stats = statsData;
    properties = propertiesData;
    cleaners = cleanersData || [];
    pnlData = pnlResult;

    renderKpis(pnlData);
    renderStats(propertiesData);
    renderCheckouts();
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

  const revenueThisMonth = (pnl && pnl.total_revenue != null) ? pnl.total_revenue : 0;
  const profitThisMonth = (pnl && pnl.net_profit != null) ? pnl.net_profit : 0;

  // Pipeline: future confirmed bookings revenue
  const today = new Date().toISOString().split('T')[0];
  const futureBookings = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_in > today);
  const pipelineRevenue = futureBookings.reduce((sum, b) => sum + (b.total_price || 0), 0);

  // Average occupancy next 30 days
  const occupancy = stats.occupancy || [];
  const filteredOcc = filterByProperty(occupancy, 'property_id');
  const avgOcc = filteredOcc.length > 0
    ? Math.round(filteredOcc.reduce((s, o) => s + o.occupancy_rate, 0) / filteredOcc.length)
    : 0;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="value">R ${fmtNum(revenueThisMonth)}</div>
      <div class="label">Revenue This Month</div>
    </div>
    <div class="stat-card">
      <div class="value">R ${fmtNum(profitThisMonth)}</div>
      <div class="label">Profit This Month</div>
    </div>
    <div class="stat-card">
      <div class="value">R ${fmtNum(pipelineRevenue)}</div>
      <div class="label">Revenue Pipeline</div>
    </div>
    <div class="stat-card">
      <div class="value">${avgOcc}%</div>
      <div class="label">Avg Occupancy (30d)</div>
    </div>`;
}

/* ───── Stats grid (occupancy per property) ───── */

function renderStats(propertiesList) {
  const grid = document.getElementById('statsGrid');
  if (!stats.occupancy) {
    grid.innerHTML = '<div class="loading">No data yet. Sync properties and bookings first.</div>';
    return;
  }

  const filtered = filterByProperty(stats.occupancy, 'property_id');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="loading">No occupancy data for selected property.</div>';
    return;
  }

  grid.innerHTML = filtered
    .map((o) => {
      const color = o.occupancy_rate > 70 ? '#00aa44' : o.occupancy_rate > 40 ? '#ff9900' : '#cc0000';
      return `
      <div class="stat-card">
        <div class="value">${o.occupancy_rate}%</div>
        <div class="label">${escHtml(o.name)}</div>
        <div class="occupancy-bar">
          <div class="fill" style="width:${o.occupancy_rate}%; background:${color}"></div>
        </div>
        <div style="font-size:0.8rem;color:#999;margin-top:0.3rem">${o.booked_nights}/30 nights</div>
      </div>`;
    })
    .join('');
}

/* ───── Upcoming check-outs ───── */

function renderCheckouts() {
  const tbody = document.getElementById('checkoutTable');
  const checkouts = filterByProperty(stats.upcoming_checkouts || [], 'property_id');
  const jobs = stats.pending_cleaning_jobs || [];

  if (checkouts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No upcoming check-outs in the next 48 hours.</td></tr>';
    return;
  }

  tbody.innerHTML = checkouts
    .map((b) => {
      const job = jobs.find((j) => j.property_id === b.property_id && j.cleaning_date === b.check_out);
      const cleanerCell = job
        ? escHtml(job.cleaner_name)
        : '<span style="color:#cc0000">Unassigned</span>';
      const actionCell = job
        ? ''
        : `<button class="btn btn-primary btn-sm" onclick="openAssignModal(${b.id || 0}, ${b.property_id}, '${b.check_out}')">Assign</button>`;
      return `
      <tr class="checkout-soon" style="background:#ff000008">
        <td>${escHtml(b.property_name)}</td>
        <td>${escHtml(b.guest_name) || '-'}</td>
        <td>${b.check_out}</td>
        <td>${platformBadge(b.platform)}</td>
        <td>${cleanerCell}</td>
        <td>${actionCell}</td>
      </tr>`;
    })
    .join('');
}

/* ───── Assign cleaner modal ───── */

function openAssignModal(bookingId, propertyId, date) {
  const modal = document.getElementById('assignCleanerModal');
  const info = document.getElementById('assignModalInfo');
  const list = document.getElementById('availableCleanersList');

  info.textContent = `Assign a cleaner for property ${propertyId} on ${date}`;

  // Filter cleaners: those assigned to this property (or all if no assignment data)
  const available = cleaners.filter((c) => {
    if (c.property_ids && Array.isArray(c.property_ids)) {
      return c.property_ids.includes(propertyId);
    }
    return true;
  });

  if (available.length === 0) {
    list.innerHTML = '<p>No cleaners available for this property.</p>';
  } else {
    list.innerHTML = available
      .map(
        (c) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #eee;">
          <span>${escHtml(c.name)}</span>
          <button class="btn btn-primary btn-sm" onclick="assignCleaner(${bookingId}, ${propertyId}, '${date}', ${c.id})">Assign</button>
        </div>`
      )
      .join('');
  }

  modal.style.display = 'flex';
}

function closeAssignModal() {
  document.getElementById('assignCleanerModal').style.display = 'none';
}

async function assignCleaner(bookingId, propertyId, date, cleanerId) {
  try {
    await api('/api/cleaners/jobs/assign', {
      method: 'POST',
      body: JSON.stringify({
        booking_id: bookingId,
        property_id: propertyId,
        cleaner_id: cleanerId,
        cleaning_date: date,
      }),
    });
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
  const gaps = filterByProperty(stats.gaps || [], 'property_id');

  if (gaps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No short gaps detected.</td></tr>';
    return;
  }

  tbody.innerHTML = gaps
    .map(
      (g) => `
      <tr style="background:#ffa50008">
        <td>${escHtml(g.property_name)}</td>
        <td>${g.gap_start}</td>
        <td>${g.gap_end}</td>
        <td><span class="badge badge-gap">${g.nights} night${g.nights > 1 ? 's' : ''}</span></td>
      </tr>`
    )
    .join('');
}

/* ───── All Bookings ───── */

function renderBookings() {
  const tbody = document.getElementById('bookingsTable');
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
      (b) => `
      <tr>
        <td>${escHtml(b.property_name)}</td>
        <td>${escHtml(b.guest_name) || '-'}</td>
        <td>${b.check_in}</td>
        <td>${b.check_out}</td>
        <td>${platformBadge(b.platform)}</td>
        <td>R ${fmtNum(b.total_price || 0)}</td>
        <td><span class="badge badge-${b.status}">${escHtml(b.status)}</span></td>
      </tr>`
    )
    .join('');
}

/* ───── Cleaning jobs ───── */

function renderJobs() {
  const tbody = document.getElementById('jobsTable');
  const jobs = filterByProperty(stats.pending_cleaning_jobs || [], 'property_id');

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No pending cleaning jobs.</td></tr>';
    return;
  }

  tbody.innerHTML = jobs
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
}

/* ───── Property filter for calendar ───── */

function populatePropertyFilter(propertiesList) {
  const select = document.getElementById('calendarProperty');
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
  const monthLabel = document.getElementById('calendarMonth');
  const calPropFilter = document.getElementById('calendarProperty').value;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  monthLabel.textContent = new Date(year, month).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

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

    html += `<div class="${classes}"><div class="date-num">${day}</div>${label}</div>`;
  }

  grid.innerHTML = html;
}

/* ───── Revenue Pipeline ───── */

function renderPipeline() {
  const container = document.getElementById('pipelineStats');
  const today = new Date().toISOString().split('T')[0];
  const futureBookings = filterByProperty(bookings, 'property_id')
    .filter((b) => b.status === 'confirmed' && b.check_in > today);

  const totalRevenue = futureBookings.reduce((sum, b) => sum + (b.total_price || 0), 0);
  const count = futureBookings.length;
  const avgPerBooking = count > 0 ? totalRevenue / count : 0;

  container.innerHTML = `
    <div class="grid">
      <div class="stat-card">
        <div class="value">R ${fmtNum(totalRevenue)}</div>
        <div class="label">Total Pipeline Revenue</div>
      </div>
      <div class="stat-card">
        <div class="value">${count}</div>
        <div class="label">Future Bookings</div>
      </div>
      <div class="stat-card">
        <div class="value">R ${fmtNum(avgPerBooking)}</div>
        <div class="label">Avg per Booking</div>
      </div>
    </div>`;
}

/* ───── Event listeners & init ───── */

window.addEventListener('propertyChanged', () => {
  renderKpis(pnlData);
  renderStats(properties);
  renderCheckouts();
  renderGaps();
  renderBookings();
  renderJobs();
  renderCalendar();
  renderPipeline();
});

// Initial load
loadAll();
