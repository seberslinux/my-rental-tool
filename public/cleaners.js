/* cleaners.js – enhanced cleaners management */

let allProperties = [];
let allCleaners = [];
let cleanerCalendarMonth = {};
let combinedMonth = new Date();
let viewMode = 'per-cleaner';
let payData = null;
let payPayments = [];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ───── API helper ───── */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

/* ───── Property changed listener ───── */

window.addEventListener('propertyChanged', () => {
  loadData();
  // Reload pay summary if a month is selected
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

/* ───── Data loading ───── */

async function loadData() {
  try {
    const [cleaners, properties] = await Promise.all([
      api('/api/cleaners'),
      api('/api/properties'),
    ]);
    allProperties = properties;
    allCleaners = cleaners;
    renderCleaners(getFilteredCleaners());
    if (viewMode === 'combined') {
      renderCombinedCalendar();
    }
  } catch (err) {
    document.getElementById('cleanersList').innerHTML =
      `<div class="alert alert-error">Failed to load: ${err.message}</div>`;
  }
}

/* ───── Rate type toggles ───── */

function toggleAddRate(value) {
  document.getElementById('addHourlyGroup').style.display = value === 'hourly' ? '' : 'none';
  document.getElementById('addFlatGroup').style.display = value === 'flat' ? '' : 'none';
}

function toggleEditRate(value) {
  document.getElementById('editHourlyGroup').style.display = value === 'hourly' ? '' : 'none';
  document.getElementById('editFlatGroup').style.display = value === 'flat' ? '' : 'none';
}

/* ───── View mode ───── */

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('btnPerCleaner').className = mode === 'per-cleaner' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('btnCombined').className = mode === 'combined' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('cleanersList').style.display = mode === 'per-cleaner' ? '' : 'none';
  document.getElementById('combinedCalendarView').style.display = mode === 'combined' ? '' : 'none';
  if (mode === 'combined') {
    renderCombinedCalendar();
  }
}

/* ───── Add cleaner ───── */

async function addCleaner(event) {
  event.preventDefault();
  const form = event.target;
  const rateType = form.rate_type.value;
  const data = {
    name: form.name.value,
    phone: form.phone.value,
    email: form.email.value,
    rate_type: rateType,
    hourly_rate: rateType === 'hourly' ? parseFloat(form.hourly_rate.value) || 0 : 0,
    flat_rate: rateType === 'flat' ? parseFloat(form.flat_rate.value) || 0 : 0,
    notes: form.notes.value,
  };

  try {
    await api('/api/cleaners', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    // Reset radio to hourly
    form.rate_type.value = 'hourly';
    toggleAddRate('hourly');
    loadData();
  } catch (err) {
    alert('Failed to add cleaner: ' + err.message);
  }
}

/* ───── Edit cleaner modal ───── */

function openEditModal(cleaner) {
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

/* ───── Render cleaners (per-cleaner view) ───── */

function renderCleaners(cleaners) {
  const container = document.getElementById('cleanersList');

  if (cleaners.length === 0) {
    container.innerHTML = '<div class="alert alert-info">No cleaners added yet.</div>';
    return;
  }

  container.innerHTML = cleaners.map((c) => {
    const assignedIds = new Set(c.properties.map((p) => p.id));
    cleanerCalendarMonth[c.id] = cleanerCalendarMonth[c.id] || new Date();

    const rateDisplay = c.rate_type === 'flat'
      ? `R ${fmtNum(c.flat_rate)}/job`
      : `R ${fmtNum(c.hourly_rate)}/hr`;

    return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div>
          <h2 style="margin-bottom:0.3rem;">${escHtml(c.name)}</h2>
          <span style="color:#666;font-size:0.85rem;">${escHtml(c.phone)} ${c.email ? '| ' + escHtml(c.email) : ''}</span>
          <span style="margin-left:0.8rem;font-weight:600;color:#2563eb;">${rateDisplay}</span>
        </div>
        <div class="actions" style="margin-top:0;">
          <button class="btn btn-secondary btn-sm" onclick='openEditModal(${JSON.stringify(c).replace(/'/g, "&#39;")})'>Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCleaner(${c.id})">Delete</button>
        </div>
      </div>

      ${c.notes ? `<div style="margin-bottom:0.8rem;font-size:0.85rem;color:#555;"><em>${escHtml(c.notes)}</em></div>` : ''}

      <div style="margin-bottom:1rem;">
        <strong>Assigned Properties:</strong>
        <div class="tag-list" style="margin-top:0.3rem;">
          ${c.properties.map((p) => `
            <span class="tag">${escHtml(p.name)}
              <span class="remove" onclick="removeProperty(${c.id}, ${p.id})">&times;</span>
            </span>`).join('')}
          <select onchange="assignProperty(${c.id}, this.value); this.value='';" style="width:auto;font-size:0.8rem;">
            <option value="">+ Assign...</option>
            ${allProperties.filter((p) => !assignedIds.has(p.id)).map((p) =>
              `<option value="${p.id}">${escHtml(p.name)}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div style="margin-bottom:1rem;">
        <strong>Weekly Schedule:</strong>
        <div style="margin-top:0.3rem;font-size:0.85rem;">
          ${c.availability.length === 0
            ? '<span style="color:#999">No schedule set</span>'
            : c.availability.map((a) =>
                `<span class="tag">${DAY_NAMES[a.day_of_week]}: ${a.start_time}\u2013${a.end_time}</span>`
              ).join(' ')}
        </div>
        <div class="actions" style="margin-top:0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="openAvailabilityModal(${c.id}, '${escHtml(c.name)}', ${JSON.stringify(c.availability).replace(/"/g, '&quot;')})">Edit Schedule</button>
          <button class="btn btn-secondary btn-sm" onclick="openOverrideModal(${c.id})">Add Date Override</button>
        </div>
        ${c.overrides.length > 0 ? `
          <div style="margin-top:0.5rem;font-size:0.85rem;">
            <strong>Overrides:</strong>
            ${c.overrides.map((o) => `
              <span class="tag" style="background:${o.available ? '#00800020' : '#ff000015'}">
                ${o.date}: ${o.available ? 'Available' : 'Unavailable'}
                <span class="remove" onclick="deleteOverride(${c.id}, ${o.id})">&times;</span>
              </span>`).join(' ')}
          </div>` : ''}
      </div>

      <div>
        <strong>Calendar:</strong>
        <div class="month-nav" style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="changeCleanerMonth(${c.id}, -1)">&larr;</button>
          <h3 id="cleaner-month-${c.id}" style="min-width:150px;text-align:center;font-size:0.95rem;"></h3>
          <button class="btn btn-secondary btn-sm" onclick="changeCleanerMonth(${c.id}, 1)">&rarr;</button>
        </div>
        <div class="calendar-grid" id="cleaner-cal-${c.id}"></div>
      </div>
    </div>`;
  }).join('');

  // Render calendars and fetch jobs for each
  for (const c of cleaners) {
    renderCleanerCalendar(c);
  }
}

/* ───── Per-cleaner calendar ───── */

async function renderCleanerCalendar(cleaner) {
  const grid = document.getElementById(`cleaner-cal-${cleaner.id}`);
  const monthLabel = document.getElementById(`cleaner-month-${cleaner.id}`);
  if (!grid) return;

  const month = cleanerCalendarMonth[cleaner.id] || new Date();
  const year = month.getFullYear();
  const m = month.getMonth();

  monthLabel.textContent = new Date(year, m).toLocaleString('default', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  // Build availability map
  const weeklyAvail = {};
  for (const a of cleaner.availability) {
    weeklyAvail[a.day_of_week] = a;
  }

  const overrideMap = {};
  for (const o of cleaner.overrides) {
    overrideMap[o.date] = o.available;
  }

  // Fetch jobs for this cleaner
  let jobDates = {};
  try {
    const jobs = await api(`/api/cleaners/${cleaner.id}/jobs`);
    for (const j of jobs) {
      jobDates[j.cleaning_date] = j;
    }
  } catch (e) {
    // ignore
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = days.map((d) => `<div class="day-header">${d}</div>`).join('');

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="day"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(year, m, day).getDay();

    let classes = 'day';
    let label = '';

    // Check if there is a job on this date
    if (jobDates[dateStr]) {
      classes += ' has-job';
      label = jobDates[dateStr].property_name || 'Job';
    } else if (overrideMap[dateStr] !== undefined) {
      classes += overrideMap[dateStr] ? ' available' : ' unavailable';
      label = overrideMap[dateStr] ? 'Override: Avail' : 'Override: Off';
    } else if (weeklyAvail[dow]) {
      classes += ' available';
      label = `${weeklyAvail[dow].start_time}\u2013${weeklyAvail[dow].end_time}`;
    } else {
      classes += ' unavailable';
    }

    html += `<div class="${classes}" style="cursor:pointer;" onclick="clickCalendarDay(${cleaner.id}, '${dateStr}')">
      <div class="date-num">${day}</div>
      <div class="booking-label">${escHtml(label)}</div>
    </div>`;
  }

  grid.innerHTML = html;
}

/* ───── Click calendar day to toggle override ───── */

async function clickCalendarDay(cleanerId, date) {
  const cleaner = allCleaners.find((c) => c.id === cleanerId);
  if (!cleaner) return;

  const dow = new Date(date + 'T12:00:00').getDay();

  // Determine current state
  const override = cleaner.overrides.find((o) => o.date === date);
  const weeklyAvail = {};
  for (const a of cleaner.availability) {
    weeklyAvail[a.day_of_week] = true;
  }

  let currentlyAvailable;
  if (override) {
    currentlyAvailable = !!override.available;
  } else {
    currentlyAvailable = !!weeklyAvail[dow];
  }

  // Toggle: if available, mark unavailable; if unavailable, mark available
  await api(`/api/cleaners/${cleanerId}/overrides`, {
    method: 'POST',
    body: JSON.stringify({ date, available: !currentlyAvailable }),
  });

  loadData();
}

/* ───── Combined calendar ───── */

function changeCombinedMonth(delta) {
  combinedMonth.setMonth(combinedMonth.getMonth() + delta);
  renderCombinedCalendar();
}

async function renderCombinedCalendar() {
  const label = document.getElementById('combinedMonthLabel');
  const head = document.getElementById('combinedCalendarHead');
  const body = document.getElementById('combinedCalendarBody');

  const year = combinedMonth.getFullYear();
  const m = combinedMonth.getMonth();
  label.textContent = new Date(year, m).toLocaleString('default', { month: 'long', year: 'numeric' });

  const daysInMonth = new Date(year, m + 1, 0).getDate();

  // Header row: Cleaner | 1 | 2 | 3 | ...
  let headHtml = '<tr><th style="position:sticky;left:0;background:#fff;z-index:2;">Cleaner</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, m, d).getDay();
    const dayLabel = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow];
    headHtml += `<th style="min-width:32px;text-align:center;font-size:0.75rem;">${d}<br>${dayLabel}</th>`;
  }
  headHtml += '</tr>';
  head.innerHTML = headHtml;

  // Fetch all cleaner jobs for the month (filtered by property)
  const filtered = getFilteredCleaners();
  const jobsByCleanerDate = {};
  for (const c of filtered) {
    jobsByCleanerDate[c.id] = {};
    try {
      const jobs = await api(`/api/cleaners/${c.id}/jobs`);
      for (const j of jobs) {
        jobsByCleanerDate[c.id][j.cleaning_date] = j;
      }
    } catch (e) {
      // ignore
    }
  }

  let bodyHtml = '';
  for (const c of filtered) {
    const weeklyAvail = {};
    for (const a of c.availability) {
      weeklyAvail[a.day_of_week] = true;
    }
    const overrideMap = {};
    for (const o of c.overrides) {
      overrideMap[o.date] = o.available;
    }

    bodyHtml += `<tr><td style="position:sticky;left:0;background:#fff;z-index:1;white-space:nowrap;font-weight:600;font-size:0.85rem;">${escHtml(c.name)}</td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(year, m, d).getDay();

      let bg = '#ff000020'; // unavailable = red
      let title = 'Unavailable';

      if (jobsByCleanerDate[c.id] && jobsByCleanerDate[c.id][dateStr]) {
        bg = '#3b82f620'; // job = blue
        title = 'Job: ' + (jobsByCleanerDate[c.id][dateStr].property_name || '');
      } else if (overrideMap[dateStr] !== undefined) {
        bg = overrideMap[dateStr] ? '#00800020' : '#ff000020';
        title = overrideMap[dateStr] ? 'Available (override)' : 'Unavailable (override)';
      } else if (weeklyAvail[dow]) {
        bg = '#00800020'; // available = green
        title = 'Available';
      }

      bodyHtml += `<td style="background:${bg};text-align:center;cursor:pointer;padding:4px;" title="${escHtml(title)}" onclick="clickCalendarDay(${c.id}, '${dateStr}')"></td>`;
    }
    bodyHtml += '</tr>';
  }

  body.innerHTML = bodyHtml;
}

/* ───── Cleaner month nav ───── */

function changeCleanerMonth(cleanerId, delta) {
  const m = cleanerCalendarMonth[cleanerId] || new Date();
  m.setMonth(m.getMonth() + delta);
  cleanerCalendarMonth[cleanerId] = m;
  loadData();
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
  container.innerHTML = '<p style="color:#999;">Loading...</p>';

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
    loadPaymentHistory();
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
    container.innerHTML = '<p style="color:#999;">No completed jobs found for this month.</p>';
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
        <td>R ${fmtNum(job.rate)}${job.rate_type === 'flat' ? '/job' : '/hr'}</td>
        <td style="text-align:right;">R ${fmtNum(job.amount)}</td>`;

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
    <td style="text-align:right;">R ${fmtNum(data.grand_total)}</td>
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
    // Create the payment record
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

    // Mark it as paid
    await api(`/api/cleaners/payments/${payment.id}/mark-paid`, { method: 'PATCH' });

    // Reload
    loadPaySummary(month);
  } catch (err) {
    alert('Failed to record payment: ' + err.message);
  }
}

/* ───── Payment History ───── */

async function loadPaymentHistory() {
  const container = document.getElementById('paymentHistoryContainer');
  if (!container) return;

  try {
    const payments = await api('/api/cleaners/payments');

    if (!payments || payments.length === 0) {
      container.innerHTML = '<p style="color:#999;">No payments recorded yet.</p>';
      return;
    }

    let html = `
    <table class="table" style="margin-top:1rem;">
      <thead>
        <tr>
          <th>Cleaner</th>
          <th>Month</th>
          <th style="text-align:right;">Amount</th>
          <th>Method</th>
          <th>Paid Date</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>`;

    for (const p of payments) {
      const paidDate = p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '-';
      const status = p.paid_at
        ? '<span style="background:#00800020;color:#166534;padding:0.15rem 0.4rem;border-radius:4px;font-size:0.8rem;font-weight:600;">Paid</span>'
        : '<span style="background:#ff000015;color:#991b1b;padding:0.15rem 0.4rem;border-radius:4px;font-size:0.8rem;font-weight:600;">Pending</span>';

      html += `<tr>
        <td>${escHtml(p.cleaner_name || '')}</td>
        <td>${escHtml(p.month)}</td>
        <td style="text-align:right;">R ${fmtNum(p.amount)}</td>
        <td>${escHtml(p.payment_method || '-')}</td>
        <td>${paidDate}</td>
        <td>${status}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Failed to load payment history: ${err.message}</div>`;
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

loadData();
loadPaymentHistory();
