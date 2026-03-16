/* shared.js – loaded on every page */

/* ───── Auth ───── */

let currentUser = null;

async function checkAuth() {
  // Skip auth check on login page
  if (window.location.pathname === '/login.html') return null;
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return null;
    }
    if (!res.ok) { window.location.href = '/login.html'; return null; }
    currentUser = await res.json();
    // Redirect cleaners to their portal (both Passport-auth and PIN-auth)
    const onPortal = window.location.pathname === '/cleaner-portal.html';
    if (currentUser.role === 'cleaner' && !onPortal) {
      window.location.href = '/cleaner-portal.html';
      return null;
    }
    updateNavForAuth();
    return currentUser;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

function updateNavForAuth() {
  if (!currentUser) return;
  // Skip sidebar injection for cleaner portal and login
  const path = window.location.pathname;
  if (path === '/cleaner-portal.html' || path === '/login.html') return;

  injectSidebar();
}

/* ───── Sidebar injection ───── */

function injectSidebar() {
  // Don't inject twice
  if (document.querySelector('.sidebar')) return;

  const path = window.location.pathname;
  const isAdmin = currentUser && currentUser.role === 'admin';

  const navItems = [
    { section: 'Main', items: [
      { href: '/', label: 'Dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>', match: ['/', '/index.html'] },
      { href: '/properties.html', label: 'Properties', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', match: ['/properties.html', '/property-detail.html'] },
      { href: '/cleaners.html', label: 'Cleaners', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>', match: ['/cleaners.html'] },
    ]},
    { section: 'Insights', items: [
      { href: '/analytics.html', label: 'Analytics', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><polyline points="4 14 12 6 18 10 22 4"/></svg>', match: ['/analytics.html'] },
      { href: '/finances.html', label: 'Finances', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-4a2 2 0 100 4h2a2 2 0 110 4H8"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></svg>', match: ['/finances.html'] },
    ]},
    { section: 'Manage', items: [
      { href: '/maintenance.html', label: 'Maintenance', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>', match: ['/maintenance.html'] },
    ]},
  ];

  // Add Users link for admins
  if (isAdmin) {
    navItems[2].items.push({
      href: '/user-management.html', label: 'Users',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      match: ['/user-management.html']
    });
  }

  // Build nav HTML
  let navHtml = '';
  for (const section of navItems) {
    navHtml += `<div class="nav-section"><div class="nav-section-label">${section.section}</div>`;
    for (const item of section.items) {
      const active = item.match.includes(path) ? ' active' : '';
      navHtml += `<a class="nav-item${active}" href="${item.href}">${item.icon} ${escHtml(item.label)}</a>`;
    }
    navHtml += '</div>';
  }

  // User initials
  const initials = currentUser.name ? currentUser.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

  // Build sidebar
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-icon">
        <svg viewBox="0 0 40 40" fill="none"><rect x="4" y="14" width="32" height="24" rx="4" fill="white"/><path d="M0 18L20 4L40 18" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="14" y="24" width="12" height="14" rx="2" fill="#2563EB"/></svg>
      </div>
      <div class="logo-text"><span>Rental Manager</span></div>
    </div>
    <nav class="sidebar-nav">${navHtml}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="avatar">${initials}</div>
        <div class="user-info">
          <div class="name">${escHtml(currentUser.name)}</div>
          <div class="role">${escHtml(currentUser.role)}</div>
        </div>
        <button class="btn-logout" onclick="openSettingsModal()" title="Settings" style="margin-right:2px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
        <button class="btn-logout" onclick="doLogout()" title="Logout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  `;

  // Mobile toggle button
  const toggle = document.createElement('button');
  toggle.className = 'sidebar-toggle';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  });

  // Remove old <nav> if it exists
  const oldNav = document.querySelector('body > nav');
  if (oldNav) oldNav.remove();

  // Wrap body content in .main if not already wrapped
  if (!document.querySelector('.main')) {
    const bodyChildren = Array.from(document.body.children).filter(
      el => el.tagName !== 'SCRIPT' && !el.classList.contains('sidebar') && !el.classList.contains('sidebar-toggle') && !el.classList.contains('sidebar-overlay') && !el.classList.contains('modal-overlay')
    );

    const main = document.createElement('div');
    main.className = 'main';

    // Determine page title from the old h1 or known paths
    const pageTitle = _getPageTitle(path);

    // Build topbar
    const topbar = document.createElement('div');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <div class="topbar-left"><h1>${escHtml(pageTitle)}</h1></div>
      <div class="topbar-right"><div id="globalPropertySelect" class="prop-multi-container"></div><div id="pageToolbar"></div></div>
    `;

    main.appendChild(topbar);

    // Wrap remaining content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    for (const child of bodyChildren) {
      // Skip old nav
      if (child.tagName === 'NAV') continue;
      contentDiv.appendChild(child);
    }
    main.appendChild(contentDiv);

    document.body.prepend(overlay);
    document.body.prepend(toggle);
    document.body.prepend(sidebar);
    document.body.appendChild(main);
  }

  // Now that the topbar with #globalPropertySelect exists, init the selector
  _initPropertySelector();
}

function _getPageTitle(path) {
  const titles = {
    '/': 'Dashboard',
    '/index.html': 'Dashboard',
    '/properties.html': 'Properties',
    '/property-detail.html': 'Property Detail',
    '/cleaners.html': 'Cleaners',
    '/analytics.html': 'Analytics',
    '/finances.html': 'Finances',
    '/maintenance.html': 'Maintenance',
    '/user-management.html': 'User Management',
  };
  return titles[path] || 'Rental Manager';
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

/* ───── helpers ───── */

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ───── Currency ───── */

const CURRENCY_SYMBOLS = { ZAR: 'R', EUR: '\u20AC', USD: '$', GBP: '\u00A3' };
window.displayCurrency = 'ZAR'; // default, overwritten by fetchSettings()
window.supportedCurrencies = ['ZAR', 'EUR', 'USD', 'GBP'];

function fmtMoney(n) {
  const sym = CURRENCY_SYMBOLS[window.displayCurrency] || window.displayCurrency;
  return sym + ' ' + fmtNum(Math.round(n || 0));
}

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    if (data.display_currency) window.displayCurrency = data.display_currency;
    if (data._supported_currencies) window.supportedCurrencies = data._supported_currencies;
  } catch (e) {
    // Settings not available yet (e.g. first run), use defaults
  }
}

async function saveDisplayCurrency(currency) {
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_currency: currency }),
    });
    if (!res.ok) throw new Error('Failed to save');
    window.displayCurrency = currency;
    showToast('Currency updated to ' + currency);
    // Reload page data
    setTimeout(() => window.location.reload(), 500);
  } catch (e) {
    showToast('Failed to save currency', 'error');
  }
}

function openSettingsModal() {
  // Remove existing if any
  const existing = document.getElementById('settingsModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'settingsModal';
  overlay.style.display = 'flex';

  const options = window.supportedCurrencies.map(c => {
    const sym = CURRENCY_SYMBOLS[c] || c;
    const selected = c === window.displayCurrency ? ' selected' : '';
    return `<option value="${c}"${selected}>${sym} - ${c}</option>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <h2 style="margin-top:0;">Settings</h2>
      <div class="form-group">
        <label>Display Currency</label>
        <select id="settingsCurrencySelect" class="form-control" style="padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;font-size:0.95rem;">
          ${options}
        </select>
        <small style="color:#6b7280;margin-top:0.25rem;display:block;">All monetary values will be converted to this currency.</small>
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.5rem;">
        <button class="btn btn-secondary" onclick="document.getElementById('settingsModal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveDisplayCurrency(document.getElementById('settingsCurrencySelect').value)">Save</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function fmtMonth(monthStr) {
  if (!monthStr) return '';
  const parts = monthStr.split('-');
  if (parts.length < 2) return monthStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1);
  return date.toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

function normalizePlatform(platform) {
  if (!platform) return 'Direct';
  const p = platform.toLowerCase();
  if (p.startsWith('blocked')) return 'Blocked';
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('direct')) return 'Direct';
  if (p.includes('booking')) return 'Booking.com';
  if (p.includes('vrbo') || p.includes('homeaway')) return 'VRBO';
  return 'Direct';
}

function platformBadge(platform) {
  const norm = normalizePlatform(platform);
  const colors = {
    'Airbnb':      { bg: '#ff585d20', fg: '#ff585d', cls: 'badge-airbnb' },
    'Booking.com': { bg: '#003b9520', fg: '#003b95', cls: 'badge-booking' },
    'VRBO':        { bg: '#00875a20', fg: '#00875a', cls: 'badge-vrbo' },
  };
  const c = colors[norm] || { bg: '#66666620', fg: '#666', cls: 'badge-direct' };
  return `<span class="badge ${c.cls}">${escHtml(norm)}</span>`;
}

/* ───── Multi-select property selector ───── */

let _allProperties = [];

/**
 * Returns an array of selected property IDs (as strings).
 * If "all" is selected (or nothing stored), returns ['all'].
 */
function getSelectedPropertyIds() {
  const raw = localStorage.getItem('selectedPropertyIds');
  if (!raw) return ['all'];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return ['all'];
    return parsed;
  } catch (e) {
    return ['all'];
  }
}

/**
 * Backward-compat: returns 'all' or a single ID string.
 * If multiple are selected, returns the first one.
 * Prefer getSelectedPropertyIds() for new code.
 */
function getSelectedPropertyId() {
  const ids = getSelectedPropertyIds();
  if (ids.includes('all')) return 'all';
  if (ids.length === 1) return ids[0];
  return ids[0]; // fallback to first
}

/**
 * Returns a comma-separated string for API query params,
 * or 'all' if all properties selected.
 */
function getPropertyIdsParam() {
  const ids = getSelectedPropertyIds();
  if (ids.includes('all')) return 'all';
  return ids.join(',');
}

/**
 * Check if a given property ID is in the current selection.
 */
function isPropertySelected(propId) {
  const ids = getSelectedPropertyIds();
  if (ids.includes('all')) return true;
  return ids.includes(String(propId));
}

function _saveSelection(ids) {
  localStorage.setItem('selectedPropertyIds', JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent('propertyChanged', { detail: { propertyIds: ids } }));
}

function _buildMultiSelect(container) {
  if (!container) return;

  // Clear existing content
  container.innerHTML = '';

  // Create the dropdown button
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'prop-multi-btn';
  btn.id = 'propMultiBtn';
  container.appendChild(btn);

  // Create the dropdown panel
  const panel = document.createElement('div');
  panel.className = 'prop-multi-panel';
  panel.id = 'propMultiPanel';
  container.appendChild(panel);

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      panel.classList.remove('open');
    }
  });

  _renderMultiOptions();
}

function _renderMultiOptions() {
  const panel = document.getElementById('propMultiPanel');
  const btn = document.getElementById('propMultiBtn');
  if (!panel || !btn) return;

  const selected = getSelectedPropertyIds();
  const allChecked = selected.includes('all');

  let html = `<label class="prop-multi-option">
    <input type="checkbox" value="all" ${allChecked ? 'checked' : ''}> <strong>All Properties</strong>
  </label>`;

  for (const prop of _allProperties) {
    const checked = allChecked || selected.includes(String(prop.id));
    html += `<label class="prop-multi-option">
      <input type="checkbox" value="${prop.id}" ${checked ? 'checked' : ''}> ${escHtml(prop.name)}
    </label>`;
  }

  panel.innerHTML = html;

  // Wire up change handlers
  const allCheckbox = panel.querySelector('input[value="all"]');
  const propCheckboxes = panel.querySelectorAll('input:not([value="all"])');

  allCheckbox.addEventListener('change', () => {
    if (allCheckbox.checked) {
      propCheckboxes.forEach(cb => cb.checked = true);
      _saveSelection(['all']);
    } else {
      propCheckboxes.forEach(cb => cb.checked = false);
      _saveSelection(['all']); // can't have nothing selected, revert to all
      allCheckbox.checked = true;
      propCheckboxes.forEach(cb => cb.checked = true);
    }
    _updateBtnLabel();
  });

  propCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const checkedProps = Array.from(propCheckboxes).filter(c => c.checked).map(c => c.value);
      if (checkedProps.length === 0 || checkedProps.length === _allProperties.length) {
        // All or none → select all
        allCheckbox.checked = true;
        propCheckboxes.forEach(c => c.checked = true);
        _saveSelection(['all']);
      } else {
        allCheckbox.checked = false;
        _saveSelection(checkedProps);
      }
      _updateBtnLabel();
    });
  });

  _updateBtnLabel();
}

function _updateBtnLabel() {
  const btn = document.getElementById('propMultiBtn');
  if (!btn) return;

  const icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-right:2px;"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
  const ids = getSelectedPropertyIds();
  let label;
  if (ids.includes('all')) {
    label = 'All Properties';
  } else if (ids.length === 1) {
    const prop = _allProperties.find(p => String(p.id) === ids[0]);
    label = prop ? prop.name : '1 Property';
  } else {
    label = `${ids.length} Properties`;
  }
  btn.innerHTML = icon + ' ' + escHtml(label);
}

/* ───── Toast notifications ───── */

function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#dc2626' : '#16a34a';
  toast.style.cssText = `background:${bg};color:#fff;padding:0.75rem 1.25rem;border-radius:6px;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.15);opacity:0;transition:opacity 0.3s;max-width:350px;`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ───── Init ───── */

document.addEventListener('DOMContentLoaded', async () => {
  // Migrate old single-select localStorage to new format
  const oldSaved = localStorage.getItem('selectedPropertyId');
  if (oldSaved && !localStorage.getItem('selectedPropertyIds')) {
    if (oldSaved === 'all') {
      localStorage.setItem('selectedPropertyIds', JSON.stringify(['all']));
    } else {
      localStorage.setItem('selectedPropertyIds', JSON.stringify([oldSaved]));
    }
    localStorage.removeItem('selectedPropertyId');
  }

  // Fetch settings (currency) before page renders data
  await fetchSettings();

  // Property selector will be initialized by injectSidebar() after the topbar is created
});

let _propSelectorInitialized = false;
async function _initPropertySelector() {
  if (_propSelectorInitialized) return;
  const container = document.getElementById('globalPropertySelect');
  if (!container) return;
  _propSelectorInitialized = true;

  let wrapper = container;
  if (container.tagName === 'SELECT') {
    wrapper = document.createElement('div');
    wrapper.id = 'globalPropertySelect';
    wrapper.className = 'prop-multi-container';
    container.parentNode.replaceChild(wrapper, container);
  }

  try {
    const res = await fetch('/api/properties');
    if (res.status === 401) return;
    if (!res.ok) throw new Error('Failed to fetch properties');
    _allProperties = await res.json();
  } catch (err) {
    console.error('shared.js: could not load properties', err);
    _allProperties = [];
  }

  _buildMultiSelect(wrapper);
}
