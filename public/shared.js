/* shared.js – loaded on every page */

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
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('booking')) return 'Booking.com';
  if (p.includes('vrbo') || p.includes('homeaway')) return 'VRBO';
  return platform || 'Direct';
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

  const ids = getSelectedPropertyIds();
  if (ids.includes('all')) {
    btn.textContent = 'All Properties';
  } else if (ids.length === 1) {
    const prop = _allProperties.find(p => String(p.id) === ids[0]);
    btn.textContent = prop ? prop.name : '1 Property';
  } else {
    btn.textContent = `${ids.length} Properties`;
  }
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

  const container = document.getElementById('globalPropertySelect');
  if (!container) return;

  // Change the container from select to div if needed
  let wrapper = container;
  if (container.tagName === 'SELECT') {
    // Replace the select element with a div
    wrapper = document.createElement('div');
    wrapper.id = 'globalPropertySelect';
    wrapper.className = 'prop-multi-container';
    container.parentNode.replaceChild(wrapper, container);
  }

  try {
    const res = await fetch('/api/properties');
    if (!res.ok) throw new Error('Failed to fetch properties');
    _allProperties = await res.json();
  } catch (err) {
    console.error('shared.js: could not load properties', err);
    _allProperties = [];
  }

  _buildMultiSelect(wrapper);
});
