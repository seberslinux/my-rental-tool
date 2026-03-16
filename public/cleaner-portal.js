/* cleaner-portal.js */

let myProfile = null;
let myJobs = [];
let allUsers = [];
let jobMonth = new Date();
let jobView = 'calendar';

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

/* ───── Init ───── */

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check — shared.js will redirect non-cleaners away
  const user = await checkAuth();
  if (!user) return;

  const isPinAuth = user.authType === 'pin';

  document.getElementById('portalUser').innerHTML =
    `<span>${escHtml(user.name)}</span><button class="btn-logout" onclick="doLogout()">Logout</button>`;

  // Hide Messages & Shopping tabs for PIN-auth cleaners
  if (isPinAuth) {
    document.querySelectorAll('.staff-only-tab').forEach(el => el.style.display = 'none');
  }

  // Tab switching
  document.querySelectorAll('.portal-tabs button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  await loadProfile();
  loadJobs();
  if (!isPinAuth) loadMessages();
});

function switchTab(tab) {
  document.querySelectorAll('.portal-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));

  if (tab === 'messages') loadMessages();
  if (tab === 'availability') renderAvailability();
  if (tab === 'maintenance') loadMaintenance();
  if (tab === 'checklist') initInventory();
  if (tab === 'shopping') loadShopping();
  if (tab === 'settings') loadSettings();
}

/* ───── Profile ───── */

async function loadProfile() {
  myProfile = await api('/api/cleaner-portal/me');
  if (!myProfile) return;
  // Populate property dropdowns
  const selectors = ['maintProperty', 'invProperty', 'shopProperty'];
  for (const id of selectors) {
    const el = document.getElementById(id);
    if (!el) continue;
    const isShop = id === 'shopProperty';
    el.innerHTML = (isShop ? '<option value="">General</option>' : '') +
      myProfile.properties.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  }
}

/* ───── Jobs ───── */

function setJobView(view) {
  jobView = view;
  document.getElementById('btnCalView').className = `btn btn-sm ${view === 'calendar' ? 'btn-primary' : 'btn-secondary'}`;
  document.getElementById('btnListView').className = `btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`;
  document.getElementById('jobCalendarView').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('jobListView').style.display = view === 'list' ? '' : 'none';
  renderJobs();
}

function changeJobMonth(delta) {
  jobMonth.setMonth(jobMonth.getMonth() + delta);
  loadJobs();
}

async function loadJobs() {
  const y = jobMonth.getFullYear(), m = jobMonth.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  document.getElementById('jobMonthLabel').textContent =
    new Date(y, m).toLocaleString('default', { month: 'long', year: 'numeric' });

  myJobs = await api(`/api/cleaner-portal/jobs?from=${from}&to=${to}`) || [];
  renderJobs();
}

function renderJobs() {
  if (jobView === 'calendar') renderJobCalendar();
  else renderJobList();
}

function renderJobCalendar() {
  const grid = document.getElementById('jobCalendarView');
  const y = jobMonth.getFullYear(), m = jobMonth.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];

  // Build job lookup
  const jobsByDate = {};
  for (const j of myJobs) {
    if (!jobsByDate[j.cleaning_date]) jobsByDate[j.cleaning_date] = [];
    jobsByDate[j.cleaning_date].push(j);
  }

  // Build availability lookup
  const weeklyAvail = {};
  if (myProfile) {
    for (const a of (myProfile.availability || [])) weeklyAvail[a.day_of_week] = a;
  }
  const overrideMap = {};
  if (myProfile) {
    for (const o of (myProfile.overrides || [])) overrideMap[o.date] = o.available;
  }

  let html = DAY_SHORT.map(d => `<div class="day-header">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="day"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(y, m, day).getDay();
    const isToday = dateStr === todayStr;
    const jobs = jobsByDate[dateStr] || [];

    let classes = 'day';
    let content = `<div class="date-num">${day}</div>`;

    if (jobs.length > 0) {
      classes += ' has-job';
      for (const j of jobs) {
        const statusCls = j.status;
        content += `<div class="booking-label" style="margin-top:2px;">
          <span class="job-status ${statusCls}" style="font-size:0.55rem;padding:1px 4px;">${j.status}</span>
          <span style="font-size:0.65rem;">${escHtml(j.property_name)}</span>
        </div>`;
      }
    } else if (overrideMap[dateStr] !== undefined) {
      classes += overrideMap[dateStr] ? ' available' : ' unavailable';
    } else if (weeklyAvail[dow]) {
      classes += ' available';
      content += `<div class="booking-label" style="color:#16a34a;">${weeklyAvail[dow].start_time}-${weeklyAvail[dow].end_time}</div>`;
    } else {
      classes += ' unavailable';
    }

    if (isToday) classes += ' today';
    html += `<div class="${classes}" style="cursor:pointer;" onclick="showJobDetail('${dateStr}')">${content}</div>`;
  }

  grid.innerHTML = html;
}

function renderJobList() {
  const container = document.getElementById('jobListView');
  if (myJobs.length === 0) {
    container.innerHTML = '<p style="color:#999;">No jobs this month.</p>';
    return;
  }
  container.innerHTML = myJobs.map(j => `
    <div class="job-card ${j.status}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <strong>${escHtml(j.property_name)}</strong>
          <span class="job-status ${j.status}" style="margin-left:0.5rem;">${j.status}</span>
          <div style="font-size:0.85rem;color:#666;margin-top:0.25rem;">
            ${j.cleaning_date} &middot; ${j.start_time || '10:00'} - ${j.end_time || '13:00'}
          </div>
          ${j.property_address ? `<div style="font-size:0.8rem;color:#888;">${escHtml(j.property_address)}</div>` : ''}
          ${j.guest_name ? `<div style="font-size:0.8rem;margin-top:0.25rem;">Guest: ${escHtml(j.guest_name)} (${j.num_guests || '?'} guests)</div>` : ''}
          ${j.special_requirements ? `<div class="special-req">Special: ${escHtml(j.special_requirements)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${j.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="updateJobStatus(${j.id}, 'confirmed')">Confirm</button>` : ''}
          ${j.status !== 'completed' && j.status !== 'ready' ? `<button class="btn btn-secondary btn-sm" onclick="updateJobStatus(${j.id}, 'completed')">Complete</button>` : ''}
          ${j.status === 'confirmed' || j.status === 'completed' ? `<button class="btn btn-sm" style="background:#8b5cf6;color:#fff;border:none;" onclick="openJobChecklist(${j.id})">Checklist</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function showJobDetail(dateStr) {
  const jobs = myJobs.filter(j => j.cleaning_date === dateStr);
  if (jobs.length === 0) return;
  // Switch to list view filtered to this date
  setJobView('list');
}

async function updateJobStatus(jobId, status) {
  const result = await api(`/api/cleaner-portal/jobs/${jobId}/status`, {
    method: 'PUT', body: JSON.stringify({ status })
  });
  if (result && result.error) { alert(result.error); return; }
  showToast(`Job ${status}`);
  loadJobs();
}

/* ───── Availability ───── */

function renderAvailability() {
  if (!myProfile) return;
  const slots = document.getElementById('availSlots');
  const availMap = {};
  for (const a of (myProfile.availability || [])) availMap[a.day_of_week] = a;

  slots.innerHTML = DAY_NAMES.map((name, i) => {
    const slot = availMap[i];
    return `
    <div class="form-row" style="align-items:center;margin-bottom:0.5rem;">
      <div style="width:110px;"><label>
        <input type="checkbox" name="day_${i}_enabled" ${slot ? 'checked' : ''}> ${name.slice(0, 3)}
      </label></div>
      <div class="form-group" style="margin-bottom:0;">
        <input type="time" name="day_${i}_start" value="${slot ? slot.start_time : '09:00'}" style="width:auto;">
      </div>
      <div style="padding:0 0.3rem;">to</div>
      <div class="form-group" style="margin-bottom:0;">
        <input type="time" name="day_${i}_end" value="${slot ? slot.end_time : '17:00'}" style="width:auto;">
      </div>
    </div>`;
  }).join('');

  renderOverrides();
}

async function saveMyAvailability(e) {
  e.preventDefault();
  const form = e.target;
  const schedule = [];
  for (let i = 0; i < 7; i++) {
    if (form[`day_${i}_enabled`].checked) {
      schedule.push({
        day_of_week: i,
        start_time: form[`day_${i}_start`].value,
        end_time: form[`day_${i}_end`].value
      });
    }
  }
  await api('/api/cleaner-portal/availability', { method: 'PUT', body: JSON.stringify({ schedule }) });
  await loadProfile();
  showToast('Schedule saved');
  renderAvailability();
}

function renderOverrides() {
  const el = document.getElementById('overridesList');
  if (!myProfile || !myProfile.overrides || myProfile.overrides.length === 0) {
    el.innerHTML = '<p style="color:#999;font-size:0.85rem;">No date overrides set.</p>';
    return;
  }
  el.innerHTML = myProfile.overrides.map(o => `
    <span class="tag" style="background:${o.available ? '#dcfce7' : '#fee2e2'};">
      ${o.date}: ${o.available ? 'Available' : 'Unavailable'}
      <span class="remove" onclick="deleteOverride(${o.id})">&times;</span>
    </span>
  `).join(' ');
}

async function addMyOverride() {
  const date = document.getElementById('overrideDate').value;
  const available = document.getElementById('overrideStatus').value === '1';
  if (!date) { alert('Please select a date'); return; }
  await api('/api/cleaner-portal/overrides', { method: 'POST', body: JSON.stringify({ date, available }) });
  await loadProfile();
  renderOverrides();
  showToast('Override added');
}

async function deleteOverride(id) {
  await api(`/api/cleaner-portal/overrides/${id}`, { method: 'DELETE' });
  await loadProfile();
  renderOverrides();
}

/* ───── Messages ───── */

async function loadMessages() {
  const [messages, users] = await Promise.all([
    api('/api/cleaner-portal/messages'),
    api('/api/cleaner-portal/users')
  ]);
  allUsers = users || [];

  // Populate recipient dropdown
  const sel = document.getElementById('msgRecipient');
  sel.innerHTML = '<option value="">Everyone</option>' +
    allUsers.filter(u => u.id !== currentUser.id).map(u =>
      `<option value="${u.id}">${escHtml(u.name)} (${u.role})</option>`
    ).join('');

  // Render messages
  const container = document.getElementById('messagesList');
  if (!messages || messages.length === 0) {
    container.innerHTML = '<p style="color:#999;">No messages yet.</p>';
    return;
  }

  container.innerHTML = messages.map(m => {
    const isIncoming = m.recipient_id === currentUser.id;
    const isBroadcast = !m.recipient_id;
    const unread = isIncoming && !m.read;
    const direction = isIncoming ? `From: ${escHtml(m.sender_name)}` :
      (isBroadcast ? `${escHtml(m.sender_name)} to Everyone` : `To: ${escHtml(m.recipient_name)}`);
    const time = new Date(m.created_at + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <div class="msg-item ${unread ? 'unread' : ''}" onclick="markMsgRead(${m.id}, ${isIncoming})">
        <div class="msg-meta">${direction} &middot; ${time}</div>
        ${m.subject ? `<div style="font-weight:600;margin-top:2px;">${escHtml(m.subject)}</div>` : ''}
        <div style="font-size:0.85rem;margin-top:2px;">${escHtml(m.body)}</div>
      </div>`;
  }).join('');

  // Update unread badge
  const unreadCount = (messages || []).filter(m => m.recipient_id === currentUser.id && !m.read).length;
  const tabBtn = document.querySelector('[data-tab="messages"]');
  const existing = tabBtn.querySelector('.unread-badge');
  if (existing) existing.remove();
  if (unreadCount > 0) {
    tabBtn.insertAdjacentHTML('beforeend', `<span class="unread-badge">${unreadCount}</span>`);
  }
}

async function markMsgRead(id, isIncoming) {
  if (!isIncoming) return;
  await api(`/api/cleaner-portal/messages/${id}/read`, { method: 'PATCH' });
  loadMessages();
}

async function sendMsg() {
  const recipient_id = document.getElementById('msgRecipient').value || null;
  const subject = document.getElementById('msgSubject').value.trim();
  const body = document.getElementById('msgBody').value.trim();
  if (!body) { alert('Message cannot be empty'); return; }
  const result = await api('/api/cleaner-portal/messages', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipient_id ? parseInt(recipient_id) : null, subject, body })
  });
  if (result && result.error) { alert(result.error); return; }
  document.getElementById('msgSubject').value = '';
  document.getElementById('msgBody').value = '';
  showToast('Message sent');
  loadMessages();
}

/* ───── Maintenance ───── */

async function loadMaintenance() {
  const issues = await api('/api/cleaner-portal/maintenance') || [];
  const container = document.getElementById('maintList');
  if (issues.length === 0) {
    container.innerHTML = '<p style="color:#999;">No issues reported.</p>';
    return;
  }
  container.innerHTML = issues.map(i => {
    const priorityColors = { urgent: '#ef4444', high: '#f59e0b', medium: '#2563eb', low: '#6b7280' };
    const color = priorityColors[i.priority] || '#6b7280';
    return `
      <div style="border-left:4px solid ${color};padding:0.5rem 0.75rem;margin-bottom:0.5rem;border-radius:0 6px 6px 0;background:#f9fafb;">
        <div style="display:flex;justify-content:space-between;">
          <strong>${escHtml(i.title)}</strong>
          <span style="font-size:0.75rem;color:${color};font-weight:600;text-transform:uppercase;">${i.priority} &middot; ${i.status}</span>
        </div>
        <div style="font-size:0.8rem;color:#666;">${escHtml(i.property_name)} &middot; ${i.reported_date}</div>
        ${i.description ? `<div style="font-size:0.85rem;margin-top:0.25rem;">${escHtml(i.description)}</div>` : ''}
      </div>`;
  }).join('');
}

async function reportIssue(e) {
  e.preventDefault();
  const result = await api('/api/cleaner-portal/maintenance', {
    method: 'POST',
    body: JSON.stringify({
      property_id: parseInt(document.getElementById('maintProperty').value),
      title: document.getElementById('maintTitle').value.trim(),
      description: document.getElementById('maintDesc').value.trim(),
      category: document.getElementById('maintCategory').value,
      priority: document.getElementById('maintPriority').value,
    })
  });
  if (result && result.error) { alert(result.error); return; }
  document.getElementById('maintTitle').value = '';
  document.getElementById('maintDesc').value = '';
  showToast('Issue reported');
  loadMaintenance();
}

/* ───── Checklist / Inventory ───── */

let inventoryItems = [];
let activeJobId = null;

async function initInventory() {
  await loadInventory();
}

async function loadInventory() {
  const propId = document.getElementById('invProperty').value;
  if (!propId) { document.getElementById('inventoryList').innerHTML = '<p style="color:#999;">Select a property.</p>'; return; }

  inventoryItems = await api(`/api/cleaner-portal/inventory/${propId}`) || [];

  // Load jobs for this property
  const jobs = (myJobs.length > 0 ? myJobs : await api('/api/cleaner-portal/jobs') || [])
    .filter(j => String(j.property_id) === String(propId));
  const jobSel = document.getElementById('invJob');
  jobSel.innerHTML = '<option value="">Select job...</option>' +
    jobs.map(j => `<option value="${j.id}">${j.cleaning_date} - ${escHtml(j.property_name)} (${j.status})</option>`).join('');

  renderInventory();
}

function renderInventory() {
  const container = document.getElementById('inventoryList');
  if (inventoryItems.length === 0) {
    container.innerHTML = '<p style="color:#999;">No checklist items set up for this property. Ask your admin to add items.</p>';
    document.getElementById('btnSubmitInv').disabled = true;
    document.getElementById('btnReady').disabled = true;
    return;
  }

  let currentCat = '';
  let html = '';
  for (const item of inventoryItems) {
    if (item.category !== currentCat) {
      currentCat = item.category;
      html += `<div style="font-weight:600;margin-top:0.75rem;margin-bottom:0.25rem;color:#1a1a2e;">${escHtml(currentCat)}</div>`;
    }
    const isTask = (item.item_type || 'task') === 'task';
    if (isTask) {
      html += `
        <div class="checklist-row" data-item-id="${item.id}">
          <label style="flex:3;display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
            <input type="checkbox" class="inv-task-check"> ${escHtml(item.item_name)}
          </label>
          <div style="flex:1;">
            <input type="text" class="inv-notes" placeholder="Notes" style="font-size:0.8rem;">
          </div>
        </div>`;
    } else {
      html += `
        <div class="checklist-row" data-item-id="${item.id}">
          <div style="flex:2;">${escHtml(item.item_name)} <span style="color:#999;font-size:0.75rem;">(expect: ${item.expected_quantity})</span></div>
          <div style="flex:1;">
            <input type="number" class="inv-qty" value="${item.expected_quantity}" min="0" style="width:60px;font-size:0.85rem;">
          </div>
          <div style="flex:1;">
            <select class="inv-status" style="font-size:0.8rem;">
              <option value="ok">OK</option>
              <option value="low">Low</option>
              <option value="missing">Missing</option>
              <option value="damaged">Damaged</option>
            </select>
          </div>
          <div style="flex:1;">
            <input type="text" class="inv-notes" placeholder="Notes" style="font-size:0.8rem;">
          </div>
        </div>`;
    }
  }
  container.innerHTML = html;
  document.getElementById('btnSubmitInv').disabled = false;
}

async function loadJobChecklist() {
  const jobId = document.getElementById('invJob').value;
  if (!jobId) return;
  activeJobId = jobId;

  // Use the merged checklist endpoint
  const merged = await api(`/api/cleaner-portal/jobs/${jobId}/checklist`) || [];
  if (merged.length === 0) {
    // Fall back to loading existing checks for backward compat
    const checks = await api(`/api/cleaner-portal/inventory/checks/${jobId}`) || [];
    prefillChecks(checks);
    return;
  }

  // Pre-fill form with existing checks from merged data
  for (const item of merged) {
    if (!item.check) continue;
    const row = document.querySelector(`.checklist-row[data-item-id="${item.id}"]`);
    if (!row) continue;
    const taskCheck = row.querySelector('.inv-task-check');
    if (taskCheck) {
      taskCheck.checked = item.check.status === 'ok';
    } else {
      const qtyInput = row.querySelector('.inv-qty');
      if (qtyInput) qtyInput.value = item.check.actual_quantity;
      const statusSel = row.querySelector('.inv-status');
      if (statusSel) statusSel.value = item.check.status;
    }
    const notesInput = row.querySelector('.inv-notes');
    if (notesInput) notesInput.value = item.check.notes || '';
  }

  // Enable ready button
  document.getElementById('btnReady').disabled = false;
}

function prefillChecks(checks) {
  for (const check of checks) {
    const row = document.querySelector(`.checklist-row[data-item-id="${check.checklist_item_id}"]`);
    if (!row) continue;
    const taskCheck = row.querySelector('.inv-task-check');
    if (taskCheck) {
      taskCheck.checked = check.status === 'ok';
    } else {
      const qtyInput = row.querySelector('.inv-qty');
      if (qtyInput) qtyInput.value = check.actual_quantity;
      const statusSel = row.querySelector('.inv-status');
      if (statusSel) statusSel.value = check.status;
    }
    const notesInput = row.querySelector('.inv-notes');
    if (notesInput) notesInput.value = check.notes || '';
  }
}

// Open checklist tab from job card
function openJobChecklist(jobId) {
  // Find the job to set property dropdown
  const job = myJobs.find(j => j.id === jobId);
  if (!job) return;

  switchTab('checklist');

  // Set property and job selectors
  const propSel = document.getElementById('invProperty');
  if (propSel) propSel.value = String(job.property_id);

  loadInventory().then(() => {
    const jobSel = document.getElementById('invJob');
    if (jobSel) jobSel.value = String(jobId);
    loadJobChecklist();
  });
}

async function submitInventoryCheck() {
  const jobId = document.getElementById('invJob').value;
  if (!jobId) { alert('Please select a cleaning job'); return; }
  activeJobId = jobId;

  const rows = document.querySelectorAll('.checklist-row');
  const items = Array.from(rows).map(row => {
    const taskCheck = row.querySelector('.inv-task-check');
    if (taskCheck) {
      return {
        checklist_item_id: parseInt(row.dataset.itemId),
        actual_quantity: taskCheck.checked ? 1 : 0,
        status: taskCheck.checked ? 'ok' : 'missing',
        notes: (row.querySelector('.inv-notes')?.value || '').trim(),
      };
    }
    return {
      checklist_item_id: parseInt(row.dataset.itemId),
      actual_quantity: parseInt(row.querySelector('.inv-qty')?.value) || 0,
      status: row.querySelector('.inv-status')?.value || 'ok',
      notes: (row.querySelector('.inv-notes')?.value || '').trim(),
    };
  });

  const result = await api('/api/cleaner-portal/inventory/check', {
    method: 'POST',
    body: JSON.stringify({ cleaning_job_id: parseInt(jobId), items })
  });
  if (result && result.error) { alert(result.error); return; }
  showToast(`Checklist saved (${items.length} items)`);
  document.getElementById('btnReady').disabled = false;
}

async function markReadyForCheckin() {
  const jobId = document.getElementById('invJob').value || activeJobId;
  if (!jobId) { alert('Please select a cleaning job first'); return; }

  // Save checklist first
  await submitInventoryCheck();

  if (!confirm('Mark this property as ready for check-in? This will notify the admin and property manager.')) return;

  const result = await api(`/api/cleaner-portal/jobs/${jobId}/ready`, { method: 'POST' });
  if (result && result.error) {
    alert(result.error);
    return;
  }
  showToast('Marked as Ready for Check-in! Notifications sent.');
  loadJobs();
}

/* ───── Shopping List ───── */

async function loadShopping() {
  const items = await api('/api/cleaner-portal/shopping-list') || [];
  const container = document.getElementById('shopList');
  if (items.length === 0) {
    container.innerHTML = '<p style="color:#999;">Shopping list is empty.</p>';
    return;
  }

  const needed = items.filter(i => i.status === 'needed');
  const purchased = items.filter(i => i.status === 'purchased');

  let html = '';
  if (needed.length > 0) {
    html += '<h4 style="margin-bottom:0.5rem;">Needed</h4>';
    html += needed.map(i => `
      <div class="shop-item">
        <div>
          <strong>${escHtml(i.item_name)}</strong> x${i.quantity}
          ${i.property_name ? `<span style="font-size:0.75rem;color:#666;"> - ${escHtml(i.property_name)}</span>` : ''}
          ${i.notes ? `<div style="font-size:0.75rem;color:#888;">${escHtml(i.notes)}</div>` : ''}
          <div style="font-size:0.7rem;color:#999;">Added by ${escHtml(i.added_by_name)}</div>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-primary btn-sm" onclick="markPurchased(${i.id})">Purchased</button>
          <button class="btn btn-danger btn-sm" onclick="deleteShopItem(${i.id})">Remove</button>
        </div>
      </div>`).join('');
  }
  if (purchased.length > 0) {
    html += '<h4 style="margin-top:1rem;margin-bottom:0.5rem;color:#666;">Purchased</h4>';
    html += purchased.map(i => `
      <div class="shop-item purchased">
        <div>
          <strong>${escHtml(i.item_name)}</strong> x${i.quantity}
          ${i.property_name ? `<span style="font-size:0.75rem;color:#666;"> - ${escHtml(i.property_name)}</span>` : ''}
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteShopItem(${i.id})" style="font-size:0.7rem;">Remove</button>
      </div>`).join('');
  }
  container.innerHTML = html;
}

async function addShopItem(e) {
  e.preventDefault();
  const result = await api('/api/cleaner-portal/shopping-list', {
    method: 'POST',
    body: JSON.stringify({
      item_name: document.getElementById('shopItem').value.trim(),
      quantity: parseInt(document.getElementById('shopQty').value) || 1,
      property_id: document.getElementById('shopProperty').value || null,
    })
  });
  if (result && result.error) { alert(result.error); return; }
  document.getElementById('shopItem').value = '';
  document.getElementById('shopQty').value = '1';
  showToast('Item added');
  loadShopping();
}

async function markPurchased(id) {
  await api(`/api/cleaner-portal/shopping-list/${id}/purchased`, { method: 'PATCH' });
  loadShopping();
}

async function deleteShopItem(id) {
  await api(`/api/cleaner-portal/shopping-list/${id}`, { method: 'DELETE' });
  loadShopping();
}

/* ───── Settings ───── */

async function loadSettings() {
  const prefs = await api('/api/cleaner-portal/notification-prefs');
  if (!prefs) return;
  document.getElementById('prefEnabled').checked = !!prefs.whatsapp_enabled;
  document.getElementById('pref7Days').checked = !!prefs.notify_7_days;
  document.getElementById('pref1Day').checked = !!prefs.notify_1_day;
  document.getElementById('pref2Hours').checked = !!prefs.notify_2_hours;

  // iCal
  const ical = await api('/api/cleaner-portal/ical/token');
  renderIcal(ical);
}

async function savePrefs() {
  await api('/api/cleaner-portal/notification-prefs', {
    method: 'PUT',
    body: JSON.stringify({
      whatsapp_enabled: document.getElementById('prefEnabled').checked,
      notify_7_days: document.getElementById('pref7Days').checked,
      notify_1_day: document.getElementById('pref1Day').checked,
      notify_2_hours: document.getElementById('pref2Hours').checked,
    })
  });
  showToast('Preferences saved');
}

async function generateIcal() {
  const result = await api('/api/cleaner-portal/ical/generate', { method: 'POST' });
  renderIcal(result);
  showToast('Calendar link generated');
}

function renderIcal(data) {
  const section = document.getElementById('icalSection');
  if (!data || !data.url) {
    section.innerHTML = '<button class="btn btn-primary" onclick="generateIcal()">Generate Calendar Link</button>';
    return;
  }
  const webcalUrl = data.url.replace(/^https?:/, 'webcal:');
  section.innerHTML = `
    <div style="margin-bottom:0.75rem;">
      <label style="font-size:0.85rem;font-weight:600;">Calendar URL:</label>
      <div style="display:flex;gap:4px;margin-top:4px;">
        <input type="text" id="icalUrl" value="${escHtml(data.url)}" readonly style="flex:1;font-size:0.8rem;">
        <button class="btn btn-secondary btn-sm" onclick="copyIcal()">Copy</button>
      </div>
    </div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
      <a href="${webcalUrl}" class="btn btn-primary btn-sm">Add to Calendar App</a>
      <button class="btn btn-secondary btn-sm" onclick="generateIcal()">Regenerate</button>
    </div>
    <p style="font-size:0.75rem;color:#999;margin-top:0.5rem;">Use the URL above in Google Calendar (Add by URL) or click "Add to Calendar App" for Apple/Outlook.</p>
  `;
}

function copyIcal() {
  const input = document.getElementById('icalUrl');
  navigator.clipboard.writeText(input.value).then(() => showToast('Copied to clipboard'));
}
