/* maintenance.js */

let allIssues = [];

document.addEventListener('DOMContentLoaded', () => {
  loadIssues();
  loadSummary();

  document.getElementById('filterStatus').addEventListener('change', renderIssues);
  document.getElementById('filterPriority').addEventListener('change', renderIssues);
});

window.addEventListener('propertyChanged', () => {
  loadIssues();
  loadSummary();
});

async function loadIssues() {
  try {
    const propParam = getPropertyIdsParam();
    const qs = propParam !== 'all' ? `?property_id=${propParam}` : '';
    const res = await fetch(`/api/maintenance${qs}`);
    if (!res.ok) throw new Error('Failed to load issues');
    allIssues = await res.json();
    renderIssues();
  } catch (err) {
    console.error('Error loading issues:', err);
    document.getElementById('issuesList').innerHTML =
      '<div class="empty-state">Failed to load issues.</div>';
  }
}

async function loadSummary() {
  try {
    const propParam = getPropertyIdsParam();
    const qs = propParam !== 'all' ? `?property_id=${propParam}` : '';
    const res = await fetch(`/api/maintenance/summary${qs}`);
    if (!res.ok) throw new Error('Failed to load summary');
    const data = await res.json();
    renderSummary(data);
  } catch (err) {
    console.error('Error loading summary:', err);
  }
}

function renderSummary(data) {
  const bar = document.getElementById('summaryBar');
  bar.innerHTML = `
    <div class="summary-stat">
      <div class="stat-value">${data.total}</div>
      <div class="stat-label">Total</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${data.open}</div>
      <div class="stat-label">Open</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${data.in_progress}</div>
      <div class="stat-label">In Progress</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${data.resolved}</div>
      <div class="stat-label">Resolved</div>
    </div>
    <div class="summary-stat urgent">
      <div class="stat-value">${data.urgent_open}</div>
      <div class="stat-label">Urgent Open</div>
    </div>
  `;
}

function renderIssues() {
  const statusFilter = document.getElementById('filterStatus').value;
  const priorityFilter = document.getElementById('filterPriority').value;

  let filtered = allIssues;
  if (statusFilter) {
    filtered = filtered.filter(i => i.status === statusFilter);
  }
  if (priorityFilter) {
    filtered = filtered.filter(i => i.priority === priorityFilter);
  }

  const container = document.getElementById('issuesList');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No maintenance issues found.</div>';
    return;
  }

  container.innerHTML = filtered.map(issue => {
    const statusClass = `badge-status-${issue.status}`;
    const priorityClass = `badge-priority-${issue.priority}`;
    const statusLabel = issue.status === 'in_progress' ? 'In Progress' :
      issue.status.charAt(0).toUpperCase() + issue.status.slice(1);
    const priorityLabel = issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1);

    let meta = `<span>Reported: ${escHtml(issue.reported_date)}</span>`;
    if (issue.resolved_date) {
      meta += `<span>Resolved: ${escHtml(issue.resolved_date)}</span>`;
    }
    if (issue.cost > 0) {
      meta += `<span>Cost: R ${fmtNum(issue.cost)}</span>`;
    }
    if (issue.assigned_to) {
      meta += `<span>Assigned to: ${escHtml(issue.assigned_to)}</span>`;
    }

    const resolveBtn = issue.status !== 'resolved'
      ? `<button class="btn-resolve" onclick="resolveIssue(${issue.id})">Resolve</button>`
      : '';

    return `
      <div class="issue-card">
        <div class="issue-card-header">
          <h3>${escHtml(issue.title)}</h3>
          <div class="issue-badges">
            <span class="badge badge-property">${escHtml(issue.property_name)}</span>
            <span class="badge badge-category">${escHtml(issue.category)}</span>
            <span class="badge ${statusClass}">${statusLabel}</span>
            <span class="badge ${priorityClass}">${priorityLabel}</span>
          </div>
        </div>
        ${issue.description ? `<div class="issue-desc">${escHtml(issue.description)}</div>` : ''}
        <div class="issue-meta">${meta}</div>
        <div class="issue-actions">
          <button onclick="openEditModal(${issue.id})">Edit</button>
          ${resolveBtn}
          <button class="btn-delete" onclick="deleteIssue(${issue.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function populatePropertyDropdown() {
  const sel = document.getElementById('issueProperty');
  sel.innerHTML = '';
  for (const p of _allProperties) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

function openAddModal() {
  document.getElementById('issueModalTitle').textContent = 'Add Issue';
  document.getElementById('issueEditId').value = '';
  document.getElementById('issueForm').reset();
  document.getElementById('issuePriority').value = 'medium';
  document.getElementById('issueStatusGroup').style.display = 'none';
  populatePropertyDropdown();
  document.getElementById('issueModal').classList.add('active');
}

function openEditModal(id) {
  const issue = allIssues.find(i => i.id === id);
  if (!issue) return;

  document.getElementById('issueModalTitle').textContent = 'Edit Issue';
  document.getElementById('issueEditId').value = issue.id;
  populatePropertyDropdown();

  document.getElementById('issueProperty').value = issue.property_id;
  document.getElementById('issueTitle').value = issue.title;
  document.getElementById('issueDescription').value = issue.description || '';
  document.getElementById('issueCategory').value = issue.category || 'General';
  document.getElementById('issuePriority').value = issue.priority || 'medium';
  document.getElementById('issueCost').value = issue.cost || 0;
  document.getElementById('issueAssigned').value = issue.assigned_to || '';
  document.getElementById('issueStatus').value = issue.status || 'open';
  document.getElementById('issueStatusGroup').style.display = 'block';

  document.getElementById('issueModal').classList.add('active');
}

function closeModal() {
  document.getElementById('issueModal').classList.remove('active');
}

async function saveIssue(e) {
  e.preventDefault();

  const editId = document.getElementById('issueEditId').value;
  const body = {
    property_id: parseInt(document.getElementById('issueProperty').value),
    title: document.getElementById('issueTitle').value.trim(),
    description: document.getElementById('issueDescription').value.trim(),
    category: document.getElementById('issueCategory').value,
    priority: document.getElementById('issuePriority').value,
    cost: parseFloat(document.getElementById('issueCost').value) || 0,
    assigned_to: document.getElementById('issueAssigned').value.trim(),
  };

  if (editId) {
    body.status = document.getElementById('issueStatus').value;
  }

  try {
    const url = editId ? `/api/maintenance/${editId}` : '/api/maintenance';
    const method = editId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save');
    }

    closeModal();
    loadIssues();
    loadSummary();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function resolveIssue(id) {
  if (!confirm('Mark this issue as resolved?')) return;
  try {
    const res = await fetch(`/api/maintenance/${id}/resolve`, { method: 'PATCH' });
    if (!res.ok) throw new Error('Failed to resolve');
    loadIssues();
    loadSummary();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteIssue(id) {
  if (!confirm('Delete this issue? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/maintenance/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    loadIssues();
    loadSummary();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
