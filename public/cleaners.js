/* cleaners.js – redesigned cleaners management */

let allProperties = [];
let allCleaners = [];
let allJobs = [];
let cleanerCalendarMonth = {};
let combinedMonth = new Date();
let payData = null;
let payPayments = [];
let weekOffset = 0;

/* Aliases used by new rendering functions */
let cleaners = [];
let properties = [];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ───── Color palette for properties & cleaners ───── */
const PROPERTY_COLORS = [
  { bg: '#2563eb18', border: '#2563eb', text: '#1e40af' },
  { bg: '#d946ef18', border: '#d946ef', text: '#a21caf' },
  { bg: '#f59e0b18', border: '#f59e0b', text: '#b45309' },
  { bg: '#10b98118', border: '#10b981', text: '#047857' },
  { bg: '#ef444418', border: '#ef4444', text: '#b91c1c' },
  { bg: '#8b5cf618', border: '#8b5cf6', text: '#6d28d9' },
];

const CLEANER_COLORS = ['#8B5CF6', '#F59E0B', '#10B981', '#2563EB', '#EF4444', '#EC4899'];

function getPropertyColor(propertyId) {
  const idx = allProperties.findIndex(p => p.id === propertyId);
  return PROPERTY_COLORS[(idx >= 0 ? idx : 0) % PROPERTY_COLORS.length];
}

function getCleanerColor(cleanerId) {
  const idx = allCleaners.findIndex(c => c.id === cleanerId);
  return CLEANER_COLORS[(idx >= 0 ? idx : 0) % CLEANER_COLORS.length];
}

/* ───── API helper ───── */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

/* ───── Property changed listener ───── */

window.addEventListener('propertyChanged', () => {
  loadData();
  const payInput = document.getElementById('payMonthInput');
  if (payInput && payInput.value) loadPaySummary(payInput.value);
});

/* ───── Property filtering helper ───── */

function getFilteredCleaners() {
  const ids = typeof getSelectedPropertyIds === 'function' ? getSelectedPropertyIds() : ['all'];
  if (ids.includes('all')) return allCleaners;
  const idSet = new Set(ids.map(Number));
  return allCleaners.filter(c => c.properties.some(p => idSet.has(p.id)));
}

/* ───── Show / Hide Add Form ───── */

function showAddForm() {
  document.getElementById('addCleanerArea').style.display = 'none';
  document.getElementById('addCleanerForm').style.display = 'block';
}
function hideAddForm() {
  document.getElementById('addCleanerForm').style.display = 'none';
  document.getElementById('addCleanerArea').style.display = 'flex';
}

/* ───── Populate add-form property select ───── */

function populateAddPropertySelect() {
  const sel = document.getElementById('addPropertySelect');
  if (!sel) return;
  sel.innerHTML = (allProperties || []).map(p =>
    `<option value="${p.id}">${escHtml(p.name)}</option>`
  ).join('');
}

/* ───── Data loading ───── */

async function loadData() {
  try {
    const [cleanersData, propertiesData] = await Promise.all([
      api('/api/cleaners'),
      api('/api/properties'),
    ]);
    allProperties = propertiesData;
    allCleaners = cleanersData;
    properties = allProperties;
    cleaners = getFilteredCleaners();

    // Load all jobs for all cleaners
    const jobPromises = cleaners.map(c =>
      api(`/api/cleaners/${c.id}/jobs`).then(jobs => jobs || []).catch(() => [])
    );
    const jobArrays = await Promise.all(jobPromises);
    allJobs = jobArrays.flat();

    populateAddPropertySelect();
    renderCleanerCards();
    renderAvailGrid();
    renderUpcomingJobs();
  } catch (err) {
    const grid = document.getElementById('cleanerCards');
    if (grid) grid.innerHTML = `<div class="alert alert-error">Failed to load: ${err.message}</div>`;
  }
}

/* ───── Rate type toggle (edit modal) ───── */

function toggleEditRate(value) {
  document.getElementById('editHourlyGroup').style.display = value === 'hourly' ? '' : 'none';
  document.getElementById('editFlatGroup').style.display = value === 'flat' ? '' : 'none';
}

/* ───── Add cleaner ───── */

async function addCleaner(event) {
  event.preventDefault();
  const form = event.target;
  const rateType = form.rate_type.value;
  const data = {
    name: form.name.value,
    phone: form.phone.value,
    email: form.email.value || '',
    rate_type: rateType,
    hourly_rate: rateType === 'hourly' ? parseFloat(form.hourly_rate.value) || 0 : 0,
    flat_rate: rateType === 'flat' ? parseFloat(form.hourly_rate.value) || 0 : 0,
    notes: form.notes.value,
  };

  try {
    const newCleaner = await api('/api/cleaners', { method: 'POST', body: JSON.stringify(data) });

    // Assign selected properties
    const sel = form.property_ids;
    if (sel && newCleaner && newCleaner.id) {
      const selectedIds = Array.from(sel.selectedOptions).map(o => parseInt(o.value));
      for (const pid of selectedIds) {
        await api(`/api/cleaners/${newCleaner.id}/properties`, {
          method: 'POST',
          body: JSON.stringify({ property_id: pid }),
        });
      }
    }

    form.reset();
    hideAddForm();
    loadData();
  } catch (err) {
    alert('Failed to add cleaner: ' + err.message);
  }
}

/* ───── Edit cleaner modal ───── */

function openEditModal(cleanerId) {
  const cleaner = allCleaners.find(c => c.id === cleanerId);
  if (!cleaner) return;
  const form = document.getElementById('editCleanerForm');
  document.getElementById('editCleanerId').value = cleaner.id;
  form.name.value = cleaner.name;
  form.phone.value = cleaner.phone;
  form.email.value = cleaner.email || '';
  form.rate_type.value = cleaner.rate_type || 'hourly';
  form.hourly_rate.value = cleaner.hourly_rate || 0;
  form.flat_rate.value = cleaner.flat_rate || 0;
  form.notes.value = cleaner.notes || '';
  toggleEditRate(cleaner.rate_type || 'hourly');
  document.getElementById('editCleanerModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editCleanerModal').classList.remove('active');
}

async function updateCleaner(event) {
  event.preventDefault();
  const form = event.target;
  const id = document.getElementById('editCleanerId').value;
  const data = {
    name: form.name.value,
    phone: form.phone.value,
    email: form.email.value,
    rate_type: form.rate_type.value,
    hourly_rate: parseFloat(form.hourly_rate.value) || 0,
    flat_rate: parseFloat(form.flat_rate.value) || 0,
    notes: form.notes.value,
  };

  try {
    await api(`/api/cleaners/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    closeEditModal();
    loadData();
  } catch (err) {
    alert('Failed to update cleaner: ' + err.message);
  }
}

/* ───── Render Cleaner Cards ───── */

function renderCleanerCards() {
  const grid = document.getElementById('cleanerCards');
  if (!grid) return;
  if (!cleaners || cleaners.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--gray-400);">No cleaners yet. Add one below.</div>';
    return;
  }

  grid.innerHTML = cleaners.map((c, i) => {
    const color = CLEANER_COLORS[i % CLEANER_COLORS.length];
    const initials = (c.name || '').split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    const rate = c.rate_type === 'flat' ? `R ${c.flat_rate || 0}/job` : `R ${c.hourly_rate || 0}/hr`;
    const props = (c.properties || []).map(p => `<span class="chip">${escHtml(p.name)}</span>`).join('');

    // Weekly schedule
    const days = ['M','T','W','T','F','S','S'];
    const avail = c.availability || [];
    const schedule = days.map((d, di) => {
      // Map: M=1, T=2, W=3, T=4, F=5, S=6, S=0
      const dow = di === 6 ? 0 : di + 1;
      const hasSlot = avail.some(a => a.day_of_week === dow);
      return `<div class="day ${hasSlot ? 'on' : 'off'}">${d}</div>`;
    }).join('');

    return `
    <div class="cleaner-card">
      <div class="cleaner-card-header">
        <div class="cleaner-info">
          <div class="cleaner-avatar" style="background:${color};">${initials}</div>
          <div><div class="cleaner-name">${escHtml(c.name)}</div><div class="cleaner-phone">${escHtml(c.phone || '')}</div></div>
        </div>
        <div class="cleaner-rate">${rate}</div>
      </div>
      <div class="cleaner-card-body">
        <div class="detail-label">Assigned Properties</div>
        <div class="chip-group">${props || '<span style="color:var(--gray-400);font-size:11px;">None</span>'}</div>
        <div class="schedule-mini">${schedule}</div>
      </div>
      <div class="cleaner-card-footer">
        <button class="card-btn" onclick="openEditModal(${c.id})">Edit</button>
        <button class="card-btn" onclick="openAvailModal(${c.id})">Schedule</button>
        <button class="card-btn danger" onclick="deleteCleaner(${c.id})">Remove</button>
      </div>
    </div>`;
  }).join('');
}

/* ───── Combined Availability Grid (2-week view) ───── */

function changeCombinedWeek(delta) {
  weekOffset += delta;
  renderAvailGrid();
}

function goToToday() {
  weekOffset = 0;
  renderAvailGrid();
}

function renderAvailGrid() {
  const head = document.getElementById('availGridHead');
  const body = document.getElementById('availGridBody');
  const label = document.getElementById('weekLabel');
  if (!head || !body) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayStr = today.toISOString().split('T')[0];

  // Start from Monday of current week + offset
  const startDate = new Date(today);
  const dayOfWeek = startDate.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startDate.setDate(startDate.getDate() + mondayOffset + (weekOffset * 14));

  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const endDate = days[days.length - 1];
  if (label) {
    label.textContent = `${startDate.toLocaleDateString('en-ZA', {month:'short', day:'numeric'})} \u2013 ${endDate.toLocaleDateString('en-ZA', {month:'short', day:'numeric', year:'numeric'})}`;
  }

  // Header
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  head.innerHTML = '<tr><th></th>' + days.map((d, i) => {
    const ds = d.toISOString().split('T')[0];
    const isToday = ds === todayStr;
    return `<th${isToday ? ' class="today"' : ''}>${dayNames[i]} ${d.getDate()}</th>`;
  }).join('') + '</tr>';

  // Get all jobs for this period
  const jobs = allJobs || [];

  // Body rows per cleaner
  let html = '';
  (cleaners || []).forEach((c, ci) => {
    const color = CLEANER_COLORS[ci % CLEANER_COLORS.length];
    html += '<tr>';
    html += `<td><div class="cleaner-row-label"><div class="cleaner-dot" style="background:${color}"></div><span class="cleaner-row-name">${escHtml(c.name)}</span></div></td>`;

    days.forEach(d => {
      const ds = d.toISOString().split('T')[0];
      const dow = d.getDay();

      // Check for job
      const job = jobs.find(j => String(j.cleaner_id) === String(c.id) && j.cleaning_date === ds);
      if (job) {
        const propName = (properties || []).find(p => String(p.id) === String(job.property_id))?.name || 'Job';
        const shortName = propName.length > 8 ? propName.substring(0, 8) : propName;
        html += `<td><div class="avail-cell job" style="background:${color};">${escHtml(shortName)}<div class="job-tooltip">${job.start_time || ''} \u2014 ${escHtml(propName)}</div></div></td>`;
        return;
      }

      // Check availability
      const override = (c.overrides || []).find(o => o.date === ds);
      if (override) {
        html += `<td><div class="avail-cell ${override.available ? 'available' : 'unavailable'}">${override.available ? '\u2713' : '\u2014'}</div></td>`;
        return;
      }

      const hasSlot = (c.availability || []).some(a => a.day_of_week === dow);
      html += `<td><div class="avail-cell ${hasSlot ? 'available' : 'unavailable'}">${hasSlot ? '\u2713' : '\u2014'}</div></td>`;
    });

    html += '</tr>';
  });

  // Coverage summary row
  html += '<tr class="summary-row"><td><div class="cleaner-row-label"><span class="cleaner-row-name" style="color:var(--gray-500);">Coverage</span></div></td>';
  days.forEach(d => {
    const ds = d.toISOString().split('T')[0];
    const dow = d.getDay();
    let available = 0;
    (cleaners || []).forEach(c => {
      const override = (c.overrides || []).find(o => o.date === ds);
      if (override) { if (override.available) available++; return; }
      if ((c.availability || []).some(a => a.day_of_week === dow)) available++;
    });
    const cls = available === 0 ? 'none' : available === 1 ? 'partial' : 'good';
    html += `<td><div class="coverage-indicator ${cls}">${available}</div></td>`;
  });
  html += '</tr>';

  body.innerHTML = html;

  // Coverage alert
  renderCoverageAlert(days);
}

/* ───── Coverage Alert ───── */

function renderCoverageAlert(days) {
  const alertEl = document.getElementById('coverageAlert');
  if (!alertEl) return;

  const gapDays = [];
  days.forEach(d => {
    const ds = d.toISOString().split('T')[0];
    const dow = d.getDay();
    let available = 0;
    (cleaners || []).forEach(c => {
      const override = (c.overrides || []).find(o => o.date === ds);
      if (override) { if (override.available) available++; return; }
      if ((c.availability || []).some(a => a.day_of_week === dow)) available++;
    });
    if (available === 0) {
      gapDays.push(d.toLocaleDateString('en-ZA', {weekday:'short', month:'short', day:'numeric'}));
    }
  });

  if (gapDays.length > 0) {
    alertEl.innerHTML = `<div class="alert-banner danger">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <div><strong>No cleaner available on ${gapDays.join(', ')}.</strong> Consider finding backup coverage.</div>
    </div>`;
  } else {
    alertEl.innerHTML = '';
  }
}

/* ───── Upcoming Jobs ───── */

function renderUpcomingJobs() {
  const tbody = document.getElementById('upcomingJobsBody');
  if (!tbody) return;

  const today = new Date().toISOString().split('T')[0];
  const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const upcoming = (allJobs || []).filter(j => j.cleaning_date >= today && j.cleaning_date <= in7days)
    .sort((a, b) => a.cleaning_date.localeCompare(b.cleaning_date));

  if (upcoming.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:1rem;">No upcoming jobs.</td></tr>';
    return;
  }

  tbody.innerHTML = upcoming.map(j => {
    const d = new Date(j.cleaning_date + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-ZA', {weekday:'short', month:'short', day:'numeric'});
    const prop = (properties || []).find(p => String(p.id) === String(j.property_id));
    const cleaner = (cleaners || []).find(c => String(c.id) === String(j.cleaner_id));
    const ci = cleaners ? cleaners.indexOf(cleaner) : -1;
    const color = ci >= 0 ? CLEANER_COLORS[ci % CLEANER_COLORS.length] : 'var(--gray-400)';
    const isUnassigned = !cleaner;

    return `<tr${isUnassigned ? ' style="background:var(--danger-bg);"' : ''}>
      <td style="font-weight:600;${isUnassigned ? 'color:var(--danger);' : ''}">${dateStr}</td>
      <td>${j.start_time || '-'}</td>
      <td>${prop ? escHtml(prop.name) : '-'}</td>
      <td>${j.type || 'Checkout Clean'}</td>
      <td>${cleaner
        ? `<span class="cleaner-tag"><span class="dot" style="background:${color}"></span> ${escHtml(cleaner.name)}</span>`
        : `<span class="cleaner-tag" style="background:var(--danger-bg);color:var(--danger);"><span class="dot" style="background:var(--danger)"></span> None</span>`
      }</td>
      <td><span class="status-chip ${cleaner ? 'assigned' : 'unassigned'}">${cleaner ? 'Assigned' : 'Unassigned'}</span></td>
    </tr>`;
  }).join('');
}

/* ───── Property assignment ───── */

async function assignProperty(cleanerId, propertyId) {
  if (!propertyId) return;
  await api(`/api/cleaners/${cleanerId}/properties`, {
    method: 'POST',
    body: JSON.stringify({ property_id: parseInt(propertyId) }),
  });
  loadData();
}

async function removeProperty(cleanerId, propertyId) {
  await api(`/api/cleaners/${cleanerId}/properties/${propertyId}`, { method: 'DELETE' });
  loadData();
}

/* ───── Delete cleaner ───── */

async function deleteCleaner(id) {
  if (!confirm('Delete this cleaner?')) return;
  await api(`/api/cleaners/${id}`, { method: 'DELETE' });
  loadData();
}

/* ───── Availability modal ───── */

function openAvailModal(cleanerId) {
  const cleaner = allCleaners.find(c => c.id === cleanerId);
  if (!cleaner) return;
  openAvailabilityModal(cleanerId, cleaner.name, cleaner.availability);
}

function openAvailabilityModal(cleanerId, name, currentAvail) {
  document.getElementById('modalCleanerId').value = cleanerId;
  document.getElementById('modalCleanerName').textContent = name;

  const slotsContainer = document.getElementById('availabilitySlots');
  const availMap = {};
  for (const a of currentAvail) {
    availMap[a.day_of_week] = a;
  }

  slotsContainer.innerHTML = DAY_NAMES.map((dayName, i) => {
    const slot = availMap[i];
    return `
    <div class="form-row" style="align-items:center;margin-bottom:0.5rem;">
      <div style="width:100px;"><label>
        <input type="checkbox" name="day_${i}_enabled" ${slot ? 'checked' : ''}> ${dayName.slice(0, 3)}
      </label></div>
      <div class="form-group" style="margin-bottom:0;">
        <input type="time" name="day_${i}_start" value="${slot ? slot.start_time : '09:00'}">
      </div>
      <div style="padding:0 0.3rem;">to</div>
      <div class="form-group" style="margin-bottom:0;">
        <input type="time" name="day_${i}_end" value="${slot ? slot.end_time : '17:00'}">
      </div>
    </div>`;
  }).join('');

  document.getElementById('availabilityModal').classList.add('active');
}

function closeModal() {
  document.getElementById('availabilityModal').classList.remove('active');
}

async function saveAvailability(event) {
  event.preventDefault();
  const form = event.target;
  const cleanerId = form.cleaner_id.value;
  const schedule = [];

  for (let i = 0; i < 7; i++) {
    const enabled = form[`day_${i}_enabled`].checked;
    if (enabled) {
      schedule.push({
        day_of_week: i,
        start_time: form[`day_${i}_start`].value,
        end_time: form[`day_${i}_end`].value,
      });
    }
  }

  await api(`/api/cleaners/${cleanerId}/availability`, {
    method: 'PUT',
    body: JSON.stringify({ schedule }),
  });
  closeModal();
  loadData();
}

/* ───── Override modal ───── */

function openOverrideModal(cleanerId) {
  document.getElementById('overrideCleanerId').value = cleanerId;
  document.getElementById('overrideModal').classList.add('active');
}

function closeOverrideModal() {
  document.getElementById('overrideModal').classList.remove('active');
}

async function saveOverride(event) {
  event.preventDefault();
  const form = event.target;
  const cleanerId = form.cleaner_id.value;

  await api(`/api/cleaners/${cleanerId}/overrides`, {
    method: 'POST',
    body: JSON.stringify({
      date: form.date.value,
      available: form.available.value === '1',
    }),
  });
  closeOverrideModal();
  loadData();
}

async function deleteOverride(cleanerId, overrideId) {
  await api(`/api/cleaners/${cleanerId}/overrides/${overrideId}`, { method: 'DELETE' });
  loadData();
}

/* ───── Pay Summary ───── */

async function loadPaySummary(month) {
  if (!month) return;
  const container = document.getElementById('paySummaryContainer');
  container.innerHTML = '<p style="color:var(--gray-400);">Loading...</p>';

  try {
    const propParam = typeof getPropertyIdsParam === 'function' ? getPropertyIdsParam() : 'all';
    let url = `/api/cleaners/pay-summary?month=${month}`;
    if (propParam && propParam !== 'all') url += `&property_id=${propParam}`;

    const [summaryData, payments] = await Promise.all([
      api(url),
      api(`/api/cleaners/payments?month=${month}`),
    ]);

    payData = summaryData;
    payPayments = payments;
    renderPaySummary(payData);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Failed to load pay summary: ${err.message}</div>`;
  }
}

function getPaymentForCleaner(cleanerId, month) {
  return payPayments.find(p => p.cleaner_id === cleanerId && p.month === month);
}

function buildWhatsAppUrl(cleaner, amount, month) {
  const c = allCleaners.find(cl => cl.id === cleaner.cleaner_id);
  if (!c || !c.phone) return '';
  const phone = c.phone.replace(/^\+/, '');
  const name = encodeURIComponent(c.name);
  const amountStr = encodeURIComponent('R' + fmtNum(amount));
  const monthStr = encodeURIComponent(month);
  return `https://wa.me/${phone}?text=Hi%20${name},%20your%20payment%20of%20${amountStr}%20for%20${monthStr}%20has%20been%20processed.`;
}

function renderPaySummary(data) {
  const container = document.getElementById('paySummaryContainer');

  if (!data.cleaners || data.cleaners.length === 0) {
    container.innerHTML = '<p style="color:var(--gray-400);">No completed jobs found for this month.</p>';
    return;
  }

  let html = `
  <table class="table" style="margin-top:1rem;">
    <thead>
      <tr>
        <th>Cleaner</th>
        <th>Property</th>
        <th>Date</th>
        <th>Hours/Job</th>
        <th>Rate</th>
        <th style="text-align:right;">Amount (ZAR)</th>
        <th>Payment Status</th>
      </tr>
    </thead>
    <tbody>`;

  for (const cleaner of data.cleaners) {
    const payment = getPaymentForCleaner(cleaner.cleaner_id, data.month);
    const whatsAppUrl = buildWhatsAppUrl(cleaner, cleaner.subtotal, data.month);

    for (let i = 0; i < cleaner.jobs.length; i++) {
      const job = cleaner.jobs[i];
      html += `<tr>`;

      if (i === 0) {
        const rowspan = cleaner.jobs.length;
        html += `<td rowspan="${rowspan}" style="font-weight:600;vertical-align:top;">
          ${escHtml(cleaner.cleaner_name)}
          ${whatsAppUrl ? `<a href="${whatsAppUrl}" target="_blank" rel="noopener" title="Send WhatsApp payment notification" style="margin-left:0.4rem;text-decoration:none;font-size:1.1rem;vertical-align:middle;">&#128172;</a>` : ''}
        </td>`;
      }

      html += `
        <td>${escHtml(job.property_name)}</td>
        <td>${job.cleaning_date}</td>
        <td>${job.rate_type === 'flat' ? 'Flat' : fmtNum(job.hours) + ' hrs'}</td>
        <td>${fmtMoney(job.rate)}${job.rate_type === 'flat' ? '/job' : '/hr'}</td>
        <td style="text-align:right;">${fmtMoney(job.amount)}</td>`;

      if (i === 0) {
        html += `<td rowspan="${cleaner.jobs.length}" style="vertical-align:top;">`;
        if (payment && payment.paid_at) {
          const paidDate = new Date(payment.paid_at).toLocaleDateString();
          html += `<span style="background:#00800020;color:#166534;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.85rem;font-weight:600;">Paid on ${escHtml(paidDate)}</span>`;
          if (payment.payment_method) {
            html += `<br><span style="font-size:0.8rem;color:#666;margin-top:0.2rem;display:inline-block;">via ${escHtml(payment.payment_method)}</span>`;
          }
        } else {
          html += `<div id="pay-action-${cleaner.cleaner_id}">
            <button class="btn btn-primary btn-sm" onclick="showPayForm(${cleaner.cleaner_id}, ${cleaner.subtotal})">Mark as Paid</button>
          </div>`;
        }
        html += `</td>`;
      }

      html += `</tr>`;
    }
    html += `<tr style="background:#f0f0f0;font-weight:600;">
      <td colspan="6" style="text-align:right;">Subtotal - ${escHtml(cleaner.cleaner_name)}</td>
      <td></td>
    </tr>`;
  }

  html += `<tr style="background:#e0e7ff;font-weight:700;font-size:1.1rem;">
    <td colspan="6" style="text-align:right;">Grand Total</td>
    <td style="text-align:right;">${fmtMoney(data.grand_total)}</td>
  </tr>`;

  html += '</tbody></table>';
  container.innerHTML = html;
}

function showPayForm(cleanerId, amount) {
  const el = document.getElementById(`pay-action-${cleanerId}`);
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.3rem;">
      <select id="pay-method-${cleanerId}" style="font-size:0.85rem;padding:0.2rem;">
        <option value="EFT">EFT</option>
        <option value="Cash">Cash</option>
        <option value="PayFast">PayFast</option>
        <option value="Other">Other</option>
      </select>
      <div style="display:flex;gap:0.3rem;">
        <button class="btn btn-primary btn-sm" onclick="confirmPayment(${cleanerId}, ${amount})">Confirm</button>
        <button class="btn btn-secondary btn-sm" onclick="cancelPayForm(${cleanerId}, ${amount})">Cancel</button>
      </div>
    </div>`;
}

function cancelPayForm(cleanerId, amount) {
  const el = document.getElementById(`pay-action-${cleanerId}`);
  if (!el) return;
  el.innerHTML = `<button class="btn btn-primary btn-sm" onclick="showPayForm(${cleanerId}, ${amount})">Mark as Paid</button>`;
}

async function confirmPayment(cleanerId, amount) {
  const method = document.getElementById(`pay-method-${cleanerId}`).value;
  const month = document.getElementById('payMonthInput').value;
  if (!month) return;

  try {
    const payment = await api('/api/cleaners/payments', {
      method: 'POST',
      body: JSON.stringify({
        cleaner_id: cleanerId,
        month: month,
        amount: amount,
        payment_method: method,
        notes: '',
      }),
    });

    await api(`/api/cleaners/payments/${payment.id}/mark-paid`, { method: 'PATCH' });

    loadPaySummary(month);
  } catch (err) {
    alert('Failed to record payment: ' + err.message);
  }
}

/* ───── Export CSV ───── */

function exportPayCSV() {
  if (!payData || !payData.cleaners || payData.cleaners.length === 0) {
    alert('No pay data to export. Select a month first.');
    return;
  }

  const rows = [['Cleaner', 'Property', 'Date', 'Hours/Job', 'Rate Type', 'Rate', 'Amount (ZAR)']];

  for (const cleaner of payData.cleaners) {
    for (const job of cleaner.jobs) {
      rows.push([
        cleaner.cleaner_name,
        job.property_name,
        job.cleaning_date,
        job.rate_type === 'flat' ? 'Flat' : job.hours,
        job.rate_type,
        job.rate,
        job.amount.toFixed(2),
      ]);
    }
    rows.push(['', '', '', '', '', 'Subtotal', cleaner.subtotal.toFixed(2)]);
  }

  rows.push(['', '', '', '', '', 'Grand Total', payData.grand_total.toFixed(2)]);

  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cleaner-pay-${payData.month}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───── Init ───── */

// Default pay month to current month
const payInput = document.getElementById('payMonthInput');
if (payInput) {
  const now = new Date();
  payInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

// Initial load (with auth check)
(async () => {
  const user = await checkAuth();
  if (!user) return;
  loadData();
})();
