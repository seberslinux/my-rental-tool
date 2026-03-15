/* maintenance.js */

let tickets = [];
let properties = [];
let currentFilter = 'all';
let searchTimeout = null;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await checkAuth();
  if (!user) return;
  await loadProperties();
  loadTickets();
});

window.addEventListener('propertyChanged', () => {
  loadTickets();
});

/* ───── Data loading ───── */

async function loadProperties() {
  try {
    const result = await api('/api/properties');
    if (!result) return;
    properties = result;
    populatePropertyDropdowns();
  } catch (err) {
    console.error('Error loading properties:', err);
  }
}

async function loadTickets() {
  try {
    const propParam = getPropertyIdsParam();
    const qs = propParam !== 'all' ? `?property_id=${propParam}` : '';
    const result = await api(`/api/maintenance${qs}`);
    if (!result) return;
    tickets = result;
    updateStatusCounts();
    renderTickets();
  } catch (err) {
    console.error('Error loading tickets:', err);
    document.getElementById('ticketsGrid').innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--gray-400);">Failed to load tickets.</div>';
  }
}

/* ───── Filtering ───── */

function filterTicketsDebounced() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(renderTickets, 300);
}

function filterTickets(status, btn) {
  currentFilter = status;
  document.querySelectorAll('#statusFilters .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTickets();
}

function toggleNewTicketForm() {
  const form = document.getElementById('newTicketForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

/* ───── Rendering ───── */

function updateStatusCounts() {
  const open = tickets.filter(t => t.status === 'open').length;
  const inProgress = tickets.filter(t => t.status === 'in_progress').length;
  const scheduled = tickets.filter(t => t.status === 'scheduled').length;
  const resolved = tickets.filter(t => t.status === 'resolved').length;

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('openCount', open);
  el('progressCount', inProgress);
  el('scheduledCount', scheduled);
  el('completedCount', resolved);
}

function renderTicketCard(ticket, propertyName) {
  const priorityColors = {
    urgent: 'var(--danger)',
    high: 'var(--warning)',
    medium: 'var(--primary)',
    low: 'var(--gray-300)'
  };
  const statusColors = {
    open: 'var(--danger)',
    in_progress: 'var(--warning)',
    scheduled: 'var(--primary)',
    resolved: 'var(--success)'
  };
  const statusLabels = {
    open: 'Open',
    in_progress: 'In Progress',
    scheduled: 'Scheduled',
    resolved: 'Completed'
  };
  const borderColor = priorityColors[ticket.priority] || 'var(--gray-300)';
  const statusColor = statusColors[ticket.status] || 'var(--gray-400)';
  const opacity = ticket.status === 'resolved' ? 'opacity:0.8;' : '';

  return `
  <div class="ticket-card" style="border-left:4px solid ${borderColor};${opacity}">
    <div class="ticket-header">
      <div>
        <div class="ticket-title">${escHtml(ticket.title)}</div>
        <div class="ticket-property">${escHtml(propertyName)}</div>
      </div>
      <span class="priority-badge ${ticket.priority}">${escHtml(ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1))}</span>
    </div>
    <div class="ticket-body">
      ${ticket.description ? `<div class="ticket-desc">${escHtml(ticket.description)}</div>` : ''}
      <div class="ticket-meta">
        <div class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${ticket.reported_date ? 'Reported ' + new Date(ticket.reported_date).toLocaleDateString('en-ZA', {month:'short', day:'numeric'}) : ''}
        </div>
        ${ticket.category ? `<div class="meta-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4a2 2 0 012-2h4.586a1 1 0 01.707.293l7.414 7.414a2 2 0 010 2.828l-4.586 4.586a2 2 0 01-2.828 0L4.707 10.293A1 1 0 014 9.586V7z"/></svg>
          ${escHtml(ticket.category)}
        </div>` : ''}
      </div>
    </div>
    <div class="ticket-footer">
      <div class="ticket-status"><div class="dot" style="background:${statusColor}"></div> ${statusLabels[ticket.status] || ticket.status}</div>
      <div class="ticket-actions">
        ${ticket.status === 'open' ? `<button class="primary" onclick="updateTicketStatus(${ticket.id}, 'in_progress')">Start</button>` : ''}
        ${ticket.status === 'in_progress' ? `<button class="primary" onclick="updateTicketStatus(${ticket.id}, 'resolved')">Complete</button>` : ''}
        ${ticket.status !== 'resolved' ? `<button onclick="deleteTicket(${ticket.id})">Delete</button>` : ''}
      </div>
    </div>
  </div>`;
}

function renderTickets() {
  const grid = document.getElementById('ticketsGrid');
  if (!grid) return;

  let filtered = [...tickets];

  // Status filter
  if (currentFilter !== 'all') {
    filtered = filtered.filter(t => t.status === currentFilter);
  }

  // Search filter
  const search = (document.getElementById('ticketSearch')?.value || '').toLowerCase();
  if (search) {
    filtered = filtered.filter(t =>
      (t.title || '').toLowerCase().includes(search) ||
      (t.description || '').toLowerCase().includes(search) ||
      (t.category || '').toLowerCase().includes(search)
    );
  }

  // Property filter
  const propFilter = document.getElementById('ticketPropertyFilter')?.value;
  if (propFilter) {
    filtered = filtered.filter(t => String(t.property_id) === String(propFilter));
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--gray-400);">No tickets found.</div>';
    return;
  }

  grid.innerHTML = filtered.map(t => {
    const prop = properties.find(p => String(p.id) === String(t.property_id));
    return renderTicketCard(t, prop ? prop.name : (t.property_name || 'Unknown'));
  }).join('');
}

/* ───── Dropdowns ───── */

function populatePropertyDropdowns() {
  // Populate the filter dropdown
  const filterSelect = document.getElementById('ticketPropertyFilter');
  if (filterSelect) {
    // Keep the "All Properties" option
    filterSelect.innerHTML = '<option value="">All Properties</option>';
    for (const p of properties) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      filterSelect.appendChild(opt);
    }
  }

  // Populate the new ticket form dropdown
  const ticketSelect = document.getElementById('ticketProperty');
  if (ticketSelect) {
    ticketSelect.innerHTML = '';
    for (const p of properties) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      ticketSelect.appendChild(opt);
    }
  }
}

/* ───── Actions ───── */

async function createTicket(e) {
  e.preventDefault();

  const body = {
    property_id: parseInt(document.getElementById('ticketProperty').value),
    title: document.getElementById('ticketTitle').value.trim(),
    description: document.getElementById('ticketDescription').value.trim(),
    category: document.getElementById('ticketCategory').value,
    priority: document.getElementById('ticketPriority').value,
    cost: parseFloat(document.getElementById('ticketCost').value) || 0,
    assigned_to: document.getElementById('ticketAssignee').value.trim(),
  };

  if (!body.title) return;

  try {
    const result = await api('/api/maintenance', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!result) return;

    // Reset form and hide it
    document.querySelector('#newTicketForm form').reset();
    document.getElementById('ticketPriority').value = 'medium';
    toggleNewTicketForm();

    // Reload tickets
    loadTickets();
    showToast('Ticket created successfully');
  } catch (err) {
    alert('Error creating ticket: ' + err.message);
  }
}

async function updateTicketStatus(id, newStatus) {
  try {
    if (newStatus === 'resolved') {
      // Use the dedicated resolve endpoint
      const result = await api(`/api/maintenance/${id}/resolve`, { method: 'PATCH' });
      if (!result) return;
    } else {
      const result = await api(`/api/maintenance/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      if (!result) return;
    }
    loadTickets();
    showToast('Ticket updated');
  } catch (err) {
    alert('Error updating ticket: ' + err.message);
  }
}

async function deleteTicket(id) {
  if (!confirm('Delete this ticket? This cannot be undone.')) return;
  try {
    const result = await api(`/api/maintenance/${id}`, { method: 'DELETE' });
    if (!result) return;
    loadTickets();
    showToast('Ticket deleted');
  } catch (err) {
    alert('Error deleting ticket: ' + err.message);
  }
}
