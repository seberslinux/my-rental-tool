/* cleaner-portal.js — mobile-first cleaner portal */

let myProfile = null;
let myJobs = [];
let allUsers = [];
let jobMonth = new Date();
let jobView = 'calendar';

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

/* ───── Inline shared helpers (so portal works standalone) ───── */

function _escHtml(str) {
  if (typeof escHtml === 'function') return escHtml(str);
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _showToast(message, type) {
  if (typeof showToast === 'function') return showToast(message, type);
  alert(message);
}

function _doLogout() {
  if (typeof doLogout === 'function') return doLogout();
  fetch('/api/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/login.html'; });
}

// Expose doLogout globally for onclick
window.doLogout = function() { _doLogout(); };

/* ───── Magic Link Token Auth ───── */

async function tryTokenAuth() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return false;

  try {
    const res = await fetch('/api/auth/cleaner-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (res.ok) {
      // Remove token from URL for security
      const url = new URL(window.location);
      url.searchParams.delete('token');
      history.replaceState(null, '', url.pathname);
      return true;
    } else {
      // Invalid token — redirect to login
      window.location.href = '/login.html';
      return false;
    }
  } catch (err) {
    window.location.href = '/login.html';
    return false;
  }
}

/* ───── Init ───── */

document.addEventListener('DOMContentLoaded', async () => {
  // Override body display from styles.css flex layout
  document.body.style.display = 'block';

  // Try magic link auth first
  const tokenResult = await tryTokenAuth();

  // Auth check — shared.js will redirect non-cleaners away
  const user = await checkAuth();
  if (!user) return;

  const isPinAuth = user.authType === 'pin' || user.authType === 'token';

  // Set header
  const initials = user.name ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerName').textContent = user.name || 'Cleaner Portal';

  // Hide Messages & Shopping for PIN/token-auth cleaners
  // (these are not shown in bottom nav by default; only staff-auth cleaners see them)

  // Bottom nav tab switching
  document.querySelectorAll('.bottom-nav button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  await loadProfile();
  loadJobs();
});

function switchTab(tab) {
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));

  if (tab === 'maintenance') loadMaintenance();
  if (tab === 'checklist') initInventory();
  if (tab === 'settings') { loadSettings(); renderAvailability(); }
}

/* ───── Profile ───── */

async function loadProfile() {
  myProfile = await api('/api/cleaner-portal/me');
  if (!myProfile) return;
  const selectors = ['maintProperty', 'invProperty', 'shopProperty'];
  for (const id of selectors) {
    const el = document.getElementById(id);
    if (!el) continue;
    const isShop = id === 'shopProperty';
    el.innerHTML = (isShop ? '<option value="">General</option>' : '') +
      myProfile.properties.map(p => `<option value="${p.id}">${_escHtml(p.name)}</option>`).join('');
  }
}

/* ───── Jobs ───── */

function setJobView(view) {
  jobView = view;
  document.getElementById('btnCalView').classList.toggle('active', view === 'calendar');
  document.getElementById('btnListView').classList.toggle('active', view === 'list');
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

  const jobsByDate = {};
  for (const j of myJobs) {
    if (!jobsByDate[j.cleaning_date]) jobsByDate[j.cleaning_date] = [];
    jobsByDate[j.cleaning_date].push(j);
  }

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
        content += `<div class="job-dot ${j.status}"></div>`;
      }
    } else if (overrideMap[dateStr] !== undefined) {
      classes += overrideMap[dateStr] ? ' available' : ' unavailable';
    } else if (weeklyAvail[dow]) {
      classes += ' available';
    } else {
      classes += ' unavailable';
    }

    if (isToday) classes += ' today';
    html += `<div class="${classes}" onclick="showJobDetail('${dateStr}')">${content}</div>`;
  }

  grid.innerHTML = html;
}

function renderJobList() {
  const container = document.getElementById('jobListView');
  if (myJobs.length === 0) {
    container.innerHTML = '<div class="empty-state">No jobs this month.</div>';
    return;
  }
  container.innerHTML = myJobs.map(j => `
    <div class="job-card ${j.status}">
      <div class="job-header">
        <span class="job-property">${_escHtml(j.property_name)}</span>
        <span class="job-status ${j.status}">${j.status}</span>
      </div>
      <div class="job-meta">${j.cleaning_date} &middot; ${j.start_time || '10:00'} - ${j.end_time || '13:00'}</div>
      ${j.property_address ? `<div class="job-address">${_escHtml(j.property_address)}</div>` : ''}
      ${j.guest_name ? `<div class="job-guest">Guest: ${_escHtml(j.guest_name)} (${j.num_guests || '?'} guests)</div>` : ''}
      ${j.special_requirements ? `<div class="special-req">Special: ${_escHtml(j.special_requirements)}</div>` : ''}
      <div class="job-actions">
        ${j.status === 'pending' ? `<button class="btn btn-primary btn-full" onclick="updateJobStatus(${j.id}, 'confirmed')">Confirm Job</button>` : ''}
        ${j.status !== 'completed' && j.status !== 'ready' ? `<button class="btn btn-secondary btn-full" onclick="updateJobStatus(${j.id}, 'completed')">Mark Complete</button>` : ''}
        ${j.status === 'confirmed' || j.status === 'completed' ? `<button class="btn btn-purple btn-full" onclick="openJobChecklist(${j.id})">Open Checklist</button>` : ''}
      </div>
    </div>
  `).join('');
}

function showJobDetail(dateStr) {
  const jobs = myJobs.filter(j => j.cleaning_date === dateStr);
  if (jobs.length === 0) return;
  setJobView('list');
}

async function updateJobStatus(jobId, status) {
  const result = await api(`/api/cleaner-portal/jobs/${jobId}/status`, {
    method: 'PUT', body: JSON.stringify({ status })
  });
  if (result && result.error) { alert(result.error); return; }
  _showToast(`Job ${status}`);
  loadJobs();
}

/* ───── Availability (now under Settings) ───── */

function renderAvailability() {
  if (!myProfile) return;
  const slots = document.getElementById('availSlots');
  if (!slots) return;
  const availMap = {};
  for (const a of (myProfile.availability || [])) availMap[a.day_of_week] = a;

  slots.innerHTML = DAY_NAMES.map((name, i) => {
    const slot = availMap[i];
    return `
    <div class="avail-row">
      <div class="avail-day">
        <input type="checkbox" name="day_${i}_enabled" id="day_${i}_enabled" ${slot ? 'checked' : ''}>
        <label for="day_${i}_enabled" style="font-weight:500;font-size:0.9rem;">${name.slice(0, 3)}</label>
      </div>
      <div class="avail-times">
        <input type="time" name="day_${i}_start" value="${slot ? slot.start_time : '09:00'}">
        <span>to</span>
        <input type="time" name="day_${i}_end" value="${slot ? slot.end_time : '17:00'}">
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
  _showToast('Schedule saved');
  renderAvailability();
}

function renderOverrides() {
  const el = document.getElementById('overridesList');
  if (!el) return;
  if (!myProfile || !myProfile.overrides || myProfile.overrides.length === 0) {
    el.innerHTML = '<p class="empty-state" style="padding:0.5rem 0;">No date overrides set.</p>';
    return;
  }
  el.innerHTML = myProfile.overrides.map(o => `
    <span class="tag" style="background:${o.available ? 'var(--success-bg)' : 'var(--danger-bg)'};">
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
  _showToast('Override added');
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

  const sel = document.getElementById('msgRecipient');
  if (sel) {
    sel.innerHTML = '<option value="">Everyone</option>' +
      allUsers.filter(u => u.id !== currentUser.id).map(u =>
        `<option value="${u.id}">${_escHtml(u.name)} (${u.role})</option>`
      ).join('');
  }

  const container = document.getElementById('messagesList');
  if (!container) return;
  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="empty-state">No messages yet.</div>';
    return;
  }

  container.innerHTML = messages.map(m => {
    const isIncoming = m.recipient_id === currentUser.id;
    const isBroadcast = !m.recipient_id;
    const unread = isIncoming && !m.read;
    const direction = isIncoming ? `From: ${_escHtml(m.sender_name)}` :
      (isBroadcast ? `${_escHtml(m.sender_name)} to Everyone` : `To: ${_escHtml(m.recipient_name)}`);
    const time = new Date(m.created_at + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <div class="msg-item ${unread ? 'unread' : ''}" onclick="markMsgRead(${m.id}, ${isIncoming})">
        <div class="msg-meta">${direction} &middot; ${time}</div>
        ${m.subject ? `<div style="font-weight:600;margin-top:2px;">${_escHtml(m.subject)}</div>` : ''}
        <div style="font-size:0.85rem;margin-top:2px;">${_escHtml(m.body)}</div>
      </div>`;
  }).join('');
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
  _showToast('Message sent');
  loadMessages();
}

/* ───── Maintenance ───── */

async function loadMaintenance() {
  const issues = await api('/api/cleaner-portal/maintenance') || [];
  const container = document.getElementById('maintList');
  if (!container) return;
  if (issues.length === 0) {
    container.innerHTML = '<div class="empty-state">No issues reported.</div>';
    return;
  }
  container.innerHTML = issues.map(i => {
    const priorityColors = { urgent: 'var(--danger)', high: 'var(--warning)', medium: 'var(--primary)', low: 'var(--gray-400)' };
    const color = priorityColors[i.priority] || 'var(--gray-400)';
    return `
      <div class="maint-card ${i.priority}">
        <div class="maint-header">
          <span class="maint-title">${_escHtml(i.title)}</span>
          <span class="maint-badge" style="color:${color};">${i.priority} &middot; ${i.status}</span>
        </div>
        <div class="maint-sub">${_escHtml(i.property_name)} &middot; ${i.reported_date}</div>
        ${i.description ? `<div class="maint-desc">${_escHtml(i.description)}</div>` : ''}
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
  _showToast('Issue reported');
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
  if (!propId) { document.getElementById('inventoryList').innerHTML = '<div class="empty-state">Select a property.</div>'; return; }

  inventoryItems = await api(`/api/cleaner-portal/inventory/${propId}`) || [];

  const jobs = (myJobs.length > 0 ? myJobs : await api('/api/cleaner-portal/jobs') || [])
    .filter(j => String(j.property_id) === String(propId));
  const jobSel = document.getElementById('invJob');
  jobSel.innerHTML = '<option value="">Select job...</option>' +
    jobs.map(j => `<option value="${j.id}">${j.cleaning_date} - ${_escHtml(j.property_name)} (${j.status})</option>`).join('');

  renderInventory();
}

function renderInventory() {
  const container = document.getElementById('inventoryList');
  if (inventoryItems.length === 0) {
    container.innerHTML = '<div class="empty-state">No checklist items set up for this property. Ask your admin to add items.</div>';
    document.getElementById('btnSubmitInv').disabled = true;
    document.getElementById('btnReady').disabled = true;
    return;
  }

  let currentCat = '';
  let html = '';
  for (const item of inventoryItems) {
    if (item.category !== currentCat) {
      currentCat = item.category;
      html += `<div class="checklist-category">${_escHtml(currentCat)}</div>`;
    }
    const isTask = (item.item_type || 'task') === 'task';
    if (isTask) {
      html += `
        <div class="checklist-row" data-item-id="${item.id}">
          <input type="checkbox" class="inv-task-check" id="task_${item.id}">
          <label for="task_${item.id}">${_escHtml(item.item_name)}</label>
        </div>`;
    } else {
      html += `
        <div class="inv-item-row" data-item-id="${item.id}">
          <div class="inv-item-name">${_escHtml(item.item_name)} <span class="expected">(expect: ${item.expected_quantity})</span></div>
          <div class="inv-item-fields">
            <input type="number" class="inv-qty" value="${item.expected_quantity}" min="0" placeholder="Qty">
            <select class="inv-status">
              <option value="ok">OK</option>
              <option value="low">Low</option>
              <option value="missing">Missing</option>
              <option value="damaged">Damaged</option>
            </select>
          </div>
          <div style="margin-top:0.35rem;">
            <input type="text" class="inv-notes" placeholder="Notes (optional)">
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

  const merged = await api(`/api/cleaner-portal/jobs/${jobId}/checklist`) || [];
  if (merged.length === 0) {
    const checks = await api(`/api/cleaner-portal/inventory/checks/${jobId}`) || [];
    prefillChecks(checks);
    return;
  }

  for (const item of merged) {
    if (!item.check) continue;
    const row = document.querySelector(`.checklist-row[data-item-id="${item.id}"], .inv-item-row[data-item-id="${item.id}"]`);
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

  document.getElementById('btnReady').disabled = false;
}

function prefillChecks(checks) {
  for (const check of checks) {
    const row = document.querySelector(`.checklist-row[data-item-id="${check.checklist_item_id}"], .inv-item-row[data-item-id="${check.checklist_item_id}"]`);
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

function openJobChecklist(jobId) {
  const job = myJobs.find(j => j.id === jobId);
  if (!job) return;

  switchTab('checklist');

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

  const checklistRows = document.querySelectorAll('.checklist-row[data-item-id]');
  const invRows = document.querySelectorAll('.inv-item-row[data-item-id]');
  const items = [];

  checklistRows.forEach(row => {
    const taskCheck = row.querySelector('.inv-task-check');
    if (taskCheck) {
      items.push({
        checklist_item_id: parseInt(row.dataset.itemId),
        actual_quantity: taskCheck.checked ? 1 : 0,
        status: taskCheck.checked ? 'ok' : 'missing',
        notes: (row.querySelector('.inv-notes')?.value || '').trim(),
      });
    }
  });

  invRows.forEach(row => {
    items.push({
      checklist_item_id: parseInt(row.dataset.itemId),
      actual_quantity: parseInt(row.querySelector('.inv-qty')?.value) || 0,
      status: row.querySelector('.inv-status')?.value || 'ok',
      notes: (row.querySelector('.inv-notes')?.value || '').trim(),
    });
  });

  const result = await api('/api/cleaner-portal/inventory/check', {
    method: 'POST',
    body: JSON.stringify({ cleaning_job_id: parseInt(jobId), items })
  });
  if (result && result.error) { alert(result.error); return; }
  _showToast(`Checklist saved (${items.length} items)`);
  document.getElementById('btnReady').disabled = false;
}

async function markReadyForCheckin() {
  const jobId = document.getElementById('invJob').value || activeJobId;
  if (!jobId) { alert('Please select a cleaning job first'); return; }

  await submitInventoryCheck();

  if (!confirm('Mark this property as ready for check-in? This will notify the admin and property manager.')) return;

  const result = await api(`/api/cleaner-portal/jobs/${jobId}/ready`, { method: 'POST' });
  if (result && result.error) {
    alert(result.error);
    return;
  }
  _showToast('Marked as Ready for Check-in! Notifications sent.');
  loadJobs();
}

/* ───── Shopping List ───── */

async function loadShopping() {
  const items = await api('/api/cleaner-portal/shopping-list') || [];
  const container = document.getElementById('shopList');
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">Shopping list is empty.</div>';
    return;
  }

  const needed = items.filter(i => i.status === 'needed');
  const purchased = items.filter(i => i.status === 'purchased');

  let html = '';
  if (needed.length > 0) {
    html += '<h4 style="margin-bottom:0.5rem;font-size:0.9rem;">Needed</h4>';
    html += needed.map(i => `
      <div class="shop-item">
        <div class="shop-info">
          <strong>${_escHtml(i.item_name)}</strong> x${i.quantity}
          ${i.property_name ? `<span style="font-size:0.75rem;color:var(--gray-500);"> - ${_escHtml(i.property_name)}</span>` : ''}
          ${i.notes ? `<div style="font-size:0.75rem;color:var(--gray-400);">${_escHtml(i.notes)}</div>` : ''}
          <div style="font-size:0.7rem;color:var(--gray-400);">Added by ${_escHtml(i.added_by_name)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="btn btn-primary btn-sm" onclick="markPurchased(${i.id})">Bought</button>
          <button class="btn btn-danger btn-sm" onclick="deleteShopItem(${i.id})">Remove</button>
        </div>
      </div>`).join('');
  }
  if (purchased.length > 0) {
    html += '<h4 style="margin-top:1rem;margin-bottom:0.5rem;font-size:0.9rem;color:var(--gray-500);">Purchased</h4>';
    html += purchased.map(i => `
      <div class="shop-item purchased">
        <div class="shop-info">
          <strong>${_escHtml(i.item_name)}</strong> x${i.quantity}
          ${i.property_name ? `<span style="font-size:0.75rem;color:var(--gray-500);"> - ${_escHtml(i.property_name)}</span>` : ''}
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteShopItem(${i.id})">Remove</button>
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
  _showToast('Item added');
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
  _showToast('Preferences saved');
}

async function generateIcal() {
  const result = await api('/api/cleaner-portal/ical/generate', { method: 'POST' });
  renderIcal(result);
  _showToast('Calendar link generated');
}

function renderIcal(data) {
  const section = document.getElementById('icalSection');
  if (!section) return;
  if (!data || !data.url) {
    section.innerHTML = '<button class="btn btn-primary btn-full" onclick="generateIcal()">Generate Calendar Link</button>';
    return;
  }
  const webcalUrl = data.url.replace(/^https?:/, 'webcal:');
  section.innerHTML = `
    <div style="margin-bottom:0.75rem;">
      <label style="font-size:0.85rem;font-weight:600;">Calendar URL:</label>
      <div style="display:flex;gap:4px;margin-top:4px;">
        <input type="text" id="icalUrl" value="${_escHtml(data.url)}" readonly style="flex:1;font-size:0.8rem;padding:0.5rem;border:1px solid var(--gray-300);border-radius:6px;min-height:40px;">
        <button class="btn btn-secondary btn-sm" onclick="copyIcal()">Copy</button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <a href="${webcalUrl}" class="btn btn-primary btn-full" style="text-decoration:none;text-align:center;">Add to Calendar App</a>
      <button class="btn btn-secondary btn-full" onclick="generateIcal()">Regenerate</button>
    </div>
    <p style="font-size:0.75rem;color:var(--gray-400);margin-top:0.5rem;">Use the URL above in Google Calendar (Add by URL) or click "Add to Calendar App" for Apple/Outlook.</p>
  `;
}

function copyIcal() {
  const input = document.getElementById('icalUrl');
  navigator.clipboard.writeText(input.value).then(() => _showToast('Copied to clipboard'));
}
