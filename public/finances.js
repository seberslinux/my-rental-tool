/* finances.js — Finances page logic */

let categories = [];
let properties = [];
let allExpenses = [];
let csvPreviewData = [];
let pnlData = null;

const COLORS = ['#1a1a2e', '#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#6a4c93', '#f4845f', '#264653', '#f4a261'];

// ─── API helper ───

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ─── Init ───

document.addEventListener('DOMContentLoaded', async () => {
  await loadBaseData();
  loadExpenses();
  loadPnl();
  loadCostSettings();
  loadKeywordMappings();
  restoreDateFilters();
});

window.addEventListener('propertyChanged', () => {
  loadExpenses();
  loadPnl();
  loadCostSettings();
});

// ─── Tab switching ───

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-bar button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  btn.classList.add('active');
}

// ─── Base data ───

async function loadBaseData() {
  try {
    [categories, properties] = await Promise.all([
      api('/api/finances/categories'),
      api('/api/properties'),
    ]);
    populatePropertySelects();
    populateCategorySelects();
  } catch (err) {
    console.error('Failed to load base data:', err);
  }
}

function populatePropertySelects() {
  const selects = [
    document.getElementById('expFilterProperty'),
    document.getElementById('expProperty'),
    document.getElementById('csvPropertySelect'),
  ];

  for (const sel of selects) {
    if (!sel) continue;
    const hasAll = sel.id === 'expFilterProperty';
    sel.innerHTML = hasAll ? '<option value="">All Properties</option>' : '';
    properties.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  }
}

function populateCategorySelects() {
  const selects = [
    document.getElementById('expFilterCategory'),
    document.getElementById('expCategory'),
    document.getElementById('newKeywordCategory'),
  ];

  for (const sel of selects) {
    if (!sel) continue;
    const hasAll = sel.id === 'expFilterCategory';
    sel.innerHTML = hasAll ? '<option value="">All Categories</option>' : '';
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = sel.id === 'newKeywordCategory' ? c.id : c.name;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
  }
}

// ─── Date filter persistence ───

function saveDateFilters() {
  const from = document.getElementById('expFilterFrom').value;
  const to = document.getElementById('expFilterTo').value;
  if (from) localStorage.setItem('fin_exp_from', from);
  if (to) localStorage.setItem('fin_exp_to', to);
}

function restoreDateFilters() {
  const from = localStorage.getItem('fin_exp_from');
  const to = localStorage.getItem('fin_exp_to');
  if (from) document.getElementById('expFilterFrom').value = from;
  if (to) document.getElementById('expFilterTo').value = to;
}

// ─── KPIs ───

function renderKPIs(summary) {
  if (!summary) return;
  const fmt = n => 'R ' + Math.round(n).toLocaleString('en-ZA');
  const noCosts = summary.total_costs === 0;
  const profitCls = noCosts ? 'muted' : (summary.net_profit >= 0 ? 'positive' : 'negative');
  const marginCls = noCosts ? 'muted' : (summary.profit_margin >= 0 ? 'positive' : 'negative');
  const kpis = [
    { value: fmt(summary.total_revenue), label: 'Total Revenue', cls: '' },
    { value: fmt(summary.total_costs), label: 'Total Costs', cls: '' },
    { value: fmt(summary.net_profit), label: 'Net Profit', cls: profitCls },
    { value: summary.profit_margin + '%', label: 'Profit Margin', cls: marginCls },
  ];

  // Scope label
  const ids = getSelectedPropertyIds();
  let scopeLabel = 'All Properties';
  if (!ids.includes('all') && ids.length === 1) {
    const prop = properties.find(p => String(p.id) === ids[0]);
    scopeLabel = prop ? prop.name : '1 Property';
  } else if (!ids.includes('all')) {
    scopeLabel = ids.length + ' Properties';
  }

  document.getElementById('kpiGrid').innerHTML =
    `<div style="grid-column:1/-1;font-size:0.85rem;color:#666;margin-bottom:-0.5rem;">Showing: <strong>${escHtml(scopeLabel)}</strong></div>` +
    kpis.map(k => `<div class="kpi-card"><div class="kpi-value ${k.cls}">${k.value}</div><div class="kpi-label">${k.label}</div></div>`).join('');

  // Warning banner when no costs
  let banner = document.getElementById('finNoCostsBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'finNoCostsBanner';
    const kpiGrid = document.getElementById('kpiGrid');
    kpiGrid.parentNode.insertBefore(banner, kpiGrid.nextSibling);
  }
  if (noCosts && summary.total_revenue > 0) {
    banner.innerHTML = '<div style="background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:0.6rem 1rem;border-radius:6px;margin-top:0.5rem;font-size:0.9rem;">No costs configured — profit figures are estimates only. <a href="#" onclick="switchTab(\'costs\', document.querySelector(\'.tab-bar button:nth-child(3)\'));return false;" style="color:#92400e;font-weight:600;">Add fixed costs in Cost Settings</a></div>';
  } else {
    banner.innerHTML = '';
  }
}

// ─── EXPENSES ───

async function loadExpenses() {
  saveDateFilters();
  const params = new URLSearchParams();
  const propParam = getPropertyIdsParam();
  const from = document.getElementById('expFilterFrom').value;
  const to = document.getElementById('expFilterTo').value;
  const cat = document.getElementById('expFilterCategory').value;
  const filterProp = document.getElementById('expFilterProperty').value;

  if (filterProp) params.set('property_id', filterProp);
  else if (propParam && propParam !== 'all') params.set('property_id', propParam);
  if (cat) params.set('category', cat);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    allExpenses = await api('/api/finances/expenses?' + params.toString());
    renderExpenses();
  } catch (err) {
    console.error('Failed to load expenses:', err);
    document.getElementById('expenseTableBody').innerHTML =
      `<tr><td colspan="7" style="color:#cc0000;">Failed to load expenses: ${escHtml(err.message)}</td></tr>`;
  }
}

function renderExpenses() {
  const body = document.getElementById('expenseTableBody');
  if (allExpenses.length === 0) {
    body.innerHTML = '<tr><td colspan="7" style="color:#999;">No expenses found. Add one using the button above.</td></tr>';
    return;
  }

  body.innerHTML = allExpenses.map(e => `
    <tr>
      <td>${escHtml(e.expense_date)}</td>
      <td>${escHtml(e.property_name)}</td>
      <td>${escHtml(e.category)}</td>
      <td>R ${Number(e.amount).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td>
      <td>${escHtml(e.description)}</td>
      <td>${e.recurring ? '<span class="badge badge-confirmed">' + escHtml(e.recurring_frequency || 'Yes') + '</span>' : '-'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editExpense(${e.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteExpense(${e.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openAddExpenseModal() {
  document.getElementById('expenseModalTitle').textContent = 'Add Expense';
  document.getElementById('expenseEditId').value = '';
  document.getElementById('expenseForm').reset();
  document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('recurringFreqGroup').style.display = 'none';
  document.getElementById('expenseModal').classList.add('active');
}

function closeExpenseModal() {
  document.getElementById('expenseModal').classList.remove('active');
}

function toggleRecurringFreq() {
  const show = document.getElementById('expRecurring').checked;
  document.getElementById('recurringFreqGroup').style.display = show ? 'block' : 'none';
}

async function saveExpense(event) {
  event.preventDefault();
  const editId = document.getElementById('expenseEditId').value;
  const data = {
    property_id: parseInt(document.getElementById('expProperty').value),
    category: document.getElementById('expCategory').value,
    amount: parseFloat(document.getElementById('expAmount').value),
    description: document.getElementById('expDescription').value,
    expense_date: document.getElementById('expDate').value,
    recurring: document.getElementById('expRecurring').checked ? 1 : 0,
    recurring_frequency: document.getElementById('expRecurring').checked ? document.getElementById('expFrequency').value : '',
  };

  try {
    if (editId) {
      await api(`/api/finances/expenses/${editId}`, { method: 'PUT', body: JSON.stringify(data) });
    } else {
      await api('/api/finances/expenses', { method: 'POST', body: JSON.stringify(data) });
    }
    closeExpenseModal();
    loadExpenses();
    loadPnl();
  } catch (err) {
    alert('Error saving expense: ' + err.message);
  }
}

function editExpense(id) {
  const exp = allExpenses.find(e => e.id === id);
  if (!exp) return;

  document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
  document.getElementById('expenseEditId').value = id;
  document.getElementById('expDate').value = exp.expense_date;
  document.getElementById('expProperty').value = exp.property_id;
  document.getElementById('expCategory').value = exp.category;
  document.getElementById('expAmount').value = exp.amount;
  document.getElementById('expDescription').value = exp.description || '';
  document.getElementById('expRecurring').checked = !!exp.recurring;
  document.getElementById('recurringFreqGroup').style.display = exp.recurring ? 'block' : 'none';
  if (exp.recurring_frequency) {
    document.getElementById('expFrequency').value = exp.recurring_frequency;
  }
  document.getElementById('expenseModal').classList.add('active');
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    await api(`/api/finances/expenses/${id}`, { method: 'DELETE' });
    loadExpenses();
    loadPnl();
  } catch (err) {
    alert('Error deleting expense: ' + err.message);
  }
}

// ─── P&L ───

function getPnlDates() {
  const fromEl = document.getElementById('pnlFrom');
  const toEl = document.getElementById('pnlTo');
  return { from: fromEl.value, to: toEl.value };
}

function setPnlRange(range, btn) {
  document.querySelectorAll('#pnlDateRange button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const fromEl = document.getElementById('pnlFrom');
  const toEl = document.getElementById('pnlTo');
  const customEls = [fromEl, toEl, document.getElementById('pnlApplyCustom')];

  if (range === 'custom') {
    customEls.forEach(el => el.style.display = '');
    return;
  }

  customEls.forEach(el => el.style.display = 'none');

  const today = new Date();
  const to = today.toISOString().split('T')[0];
  let from;

  switch (range) {
    case '30d':
      from = new Date(today - 30 * 86400000).toISOString().split('T')[0];
      break;
    case '90d':
      from = new Date(today - 90 * 86400000).toISOString().split('T')[0];
      break;
    case '6m':
      from = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate()).toISOString().split('T')[0];
      break;
    case '12m':
      from = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];
      break;
    case 'ytd':
      from = today.getFullYear() + '-01-01';
      break;
    default:
      from = new Date(today - 30 * 86400000).toISOString().split('T')[0];
  }

  fromEl.value = from;
  toEl.value = to;
  localStorage.setItem('fin_pnl_range', range);
  loadPnl();
}

async function loadPnl() {
  const params = new URLSearchParams();
  const propParam = getPropertyIdsParam();
  const { from, to } = getPnlDates();

  if (propParam && propParam !== 'all') params.set('property_id', propParam);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    pnlData = await api('/api/finances/pnl?' + params.toString());
    renderKPIs(pnlData.summary);
    renderPnlChart();
    renderCostBreakdown();
    renderBookingProfitability();
    renderPropertyBreakdown();
  } catch (err) {
    console.error('Failed to load P&L:', err);
  }
}

function renderPnlChart() {
  const container = document.getElementById('pnlChart');
  const monthly = pnlData.monthly_pnl;

  if (!monthly || monthly.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;width:100%;">No P&L data for this period</div>';
    return;
  }

  const maxVal = Math.max(...monthly.flatMap(m => [m.revenue, m.costs]), 1);

  container.innerHTML = monthly.map(m => {
    const hRev = Math.max(2, (m.revenue / maxVal) * 100);
    const hCost = Math.max(2, (m.costs / maxVal) * 100);
    const label = fmtMonth(m.month);
    return `<div class="bar-col">
      <div class="bar-value" style="font-size:0.55rem;">R ${fmtNum(m.revenue)}</div>
      <div class="pnl-bar-group">
        <div class="bar" style="height:${hRev}%;background:#1a1a2e;width:18px;max-width:18px;" title="Revenue: R ${fmtNum(m.revenue)}"></div>
        <div class="bar" style="height:${hCost}%;background:#e63946;width:18px;max-width:18px;" title="Costs: R ${fmtNum(m.costs)}"></div>
      </div>
      <div class="bar-label">${label}</div>
    </div>`;
  }).join('');
}

function renderCostBreakdown() {
  const container = document.getElementById('costBreakdownChart');
  const breakdown = pnlData.cost_breakdown;

  if (!breakdown || breakdown.length === 0) {
    container.innerHTML = '<div style="color:#999;text-align:center;padding:1rem;">No cost data for this period</div>';
    return;
  }

  const max = Math.max(...breakdown.map(b => b.amount), 1);

  container.innerHTML = breakdown.map((b, i) => {
    const pct = Math.max(2, (b.amount / max) * 100);
    const color = COLORS[i % COLORS.length];
    return `<div class="h-bar-row">
      <div class="h-bar-label">${escHtml(b.category)}</div>
      <div class="h-bar-track">
        <div class="h-bar-fill" style="width:${pct}%;background:${color};">R ${fmtNum(b.amount)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderBookingProfitability() {
  const body = document.getElementById('bookingProfitBody');
  const bookings = pnlData.booking_profitability;

  if (!bookings || bookings.length === 0) {
    body.innerHTML = '<tr><td colspan="8" style="color:#999;">No booking data for this period</td></tr>';
    return;
  }

  body.innerHTML = bookings.map(b => {
    const profitClass = b.net_profit >= 0 ? 'color:#00aa44' : 'color:#cc0000';
    return `<tr>
      <td>${escHtml(b.guest_name || '-')}</td>
      <td>${escHtml(b.property_name)}</td>
      <td>${b.check_in}</td>
      <td>${b.check_out}</td>
      <td>R ${fmtNum(b.revenue)}</td>
      <td>R ${fmtNum(b.cleaning_cost)}</td>
      <td>R ${fmtNum(b.platform_fee)}</td>
      <td style="${profitClass};font-weight:600;">R ${fmtNum(b.net_profit)}</td>
    </tr>`;
  }).join('');
}

// ─── P&L BY PROPERTY BREAKDOWN ───

async function renderPropertyBreakdown() {
  const container = document.getElementById('propertyBreakdownContainer');
  const content = document.getElementById('propertyBreakdownContent');
  const ids = getSelectedPropertyIds();

  if (!ids.includes('all')) {
    container.style.display = 'none';
    return;
  }

  if (properties.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  content.innerHTML = '<div class="loading">Loading property breakdown...</div>';

  const { from, to } = getPnlDates();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const results = await Promise.all(
      properties.map(function(p) {
        var propParams = new URLSearchParams(params);
        propParams.set('property_id', p.id);
        return api('/api/finances/pnl?' + propParams.toString())
          .then(function(data) { return { property: p, pnl: data }; })
          .catch(function() { return { property: p, pnl: null }; });
      })
    );

    var totalRevenue = 0;
    var totalCosts = 0;
    var totalProfit = 0;

    var rows = results.map(function(r) {
      var s = r.pnl && r.pnl.summary ? r.pnl.summary : {};
      var rev = s.total_revenue || 0;
      var costs = s.total_costs || 0;
      var profit = s.net_profit || 0;
      var margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;

      totalRevenue += rev;
      totalCosts += costs;
      totalProfit += profit;

      var profitStyle = profit >= 0 ? 'color:#00aa44' : 'color:#cc0000';
      var marginStyle = margin >= 0 ? 'color:#00aa44' : 'color:#cc0000';

      return '<tr>' +
        '<td>' + escHtml(r.property.name) + '</td>' +
        '<td>R ' + fmtNum(rev) + '</td>' +
        '<td>R ' + fmtNum(costs) + '</td>' +
        '<td style="' + profitStyle + ';font-weight:600;">R ' + fmtNum(profit) + '</td>' +
        '<td style="' + marginStyle + ';font-weight:600;">' + margin + '%</td>' +
        '</tr>';
    });

    var totalMargin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;
    var totalProfitStyle = totalProfit >= 0 ? 'color:#00aa44' : 'color:#cc0000';
    var totalMarginStyle = totalMargin >= 0 ? 'color:#00aa44' : 'color:#cc0000';

    rows.push(
      '<tr style="font-weight:700;border-top:2px solid #333;background:#f8f8f8;">' +
        '<td>Total</td>' +
        '<td>R ' + fmtNum(totalRevenue) + '</td>' +
        '<td>R ' + fmtNum(totalCosts) + '</td>' +
        '<td style="' + totalProfitStyle + '">R ' + fmtNum(totalProfit) + '</td>' +
        '<td style="' + totalMarginStyle + '">' + totalMargin + '%</td>' +
      '</tr>'
    );

    content.innerHTML = '<table class="data-table">' +
      '<thead><tr><th>Property</th><th>Revenue</th><th>Costs</th><th>Net Profit</th><th>Margin</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody>' +
      '</table>';
  } catch (err) {
    content.innerHTML = '<div style="color:#cc0000;">Failed to load property breakdown: ' + escHtml(err.message) + '</div>';
  }
}

// ─── COST SETTINGS ───

async function loadCostSettings() {
  const container = document.getElementById('costSettingsContainer');

  if (properties.length === 0) {
    container.innerHTML = '<div style="color:#999;">No properties found. Add properties first.</div>';
    return;
  }

  try {
    let html = '';
    for (const p of properties) {
      const costs = await api(`/api/finances/costs/${p.id}`);
      const costMap = {};
      costs.forEach(c => { costMap[c.category_id] = c; });

      html += `<div class="cost-property-section">
        <h3>${escHtml(p.name)}</h3>
        <table class="data-table cost-table">
          <thead>
            <tr><th>Category</th><th>Monthly Amount (R)</th><th>Variable</th></tr>
          </thead>
          <tbody>
            ${categories.map(cat => {
              const existing = costMap[cat.id];
              return `<tr>
                <td>${escHtml(cat.name)}</td>
                <td><input type="number" step="0.01" min="0" id="cost-${p.id}-${cat.id}" value="${existing ? existing.monthly_amount : 0}"></td>
                <td>
                  <label class="toggle-switch">
                    <input type="checkbox" id="var-${p.id}-${cat.id}" ${existing && existing.is_variable ? 'checked' : ''}>
                    <span class="slider"></span>
                  </label>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="actions">
          <button class="btn btn-primary" onclick="saveCosts(${p.id})">Save Costs for ${escHtml(p.name)}</button>
        </div>
      </div>`;
    }
    container.innerHTML = html;
    renderCategoryList();
  } catch (err) {
    container.innerHTML = `<div style="color:#cc0000;">Error loading cost settings: ${escHtml(err.message)}</div>`;
  }
}

async function saveCosts(propertyId) {
  try {
    for (const cat of categories) {
      const amountEl = document.getElementById(`cost-${propertyId}-${cat.id}`);
      const varEl = document.getElementById(`var-${propertyId}-${cat.id}`);
      if (!amountEl) continue;

      await api('/api/finances/costs', {
        method: 'POST',
        body: JSON.stringify({
          property_id: propertyId,
          category_id: cat.id,
          monthly_amount: parseFloat(amountEl.value) || 0,
          is_variable: varEl.checked ? 1 : 0,
        }),
      });
    }
    alert('Costs saved successfully!');
  } catch (err) {
    alert('Error saving costs: ' + err.message);
  }
}

// ─── CATEGORIES ───

async function addCategory() {
  const nameEl = document.getElementById('newCategoryName');
  const name = nameEl.value.trim();
  if (!name) return;

  try {
    await api('/api/finances/categories', { method: 'POST', body: JSON.stringify({ name }) });
    nameEl.value = '';
    await loadBaseData();
    loadCostSettings();
  } catch (err) {
    alert('Error adding category: ' + err.message);
  }
}

async function deleteCategory(id) {
  if (!confirm('Delete this custom category?')) return;
  try {
    await api(`/api/finances/categories/${id}`, { method: 'DELETE' });
    await loadBaseData();
    loadCostSettings();
  } catch (err) {
    alert('Error deleting category: ' + err.message);
  }
}

function renderCategoryList() {
  const container = document.getElementById('categoryList');
  const custom = categories.filter(c => !c.is_default);

  if (custom.length === 0) {
    container.innerHTML = '<p style="color:#999;font-size:0.85rem;">No custom categories yet.</p>';
    return;
  }

  container.innerHTML = '<div class="tag-list">' + custom.map(c =>
    `<span class="tag">${escHtml(c.name)} <span class="remove" onclick="deleteCategory(${c.id})">&times;</span></span>`
  ).join('') + '</div>';
}

// ─── CSV IMPORT ───

function handleCsvFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      alert('CSV file appears to be empty or has no data rows.');
      return;
    }

    // Parse header
    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
    const dateIdx = header.findIndex(h => h.includes('date'));
    const descIdx = header.findIndex(h => h.includes('desc') || h.includes('narration') || h.includes('reference') || h.includes('memo'));
    const amtIdx = header.findIndex(h => h.includes('amount') || h.includes('debit') || h.includes('value'));

    if (dateIdx === -1 || amtIdx === -1) {
      alert('Could not detect date and amount columns. Ensure CSV has headers containing "date" and "amount".');
      return;
    }

    const transactions = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length <= Math.max(dateIdx, descIdx, amtIdx)) continue;

      const rawAmount = cols[amtIdx].replace(/[^0-9.\-]/g, '');
      const amount = parseFloat(rawAmount);
      if (isNaN(amount) || amount === 0) continue;

      transactions.push({
        date: cols[dateIdx].trim(),
        description: descIdx >= 0 ? cols[descIdx].trim() : '',
        amount: Math.abs(amount),
      });
    }

    if (transactions.length === 0) {
      alert('No valid transactions found in CSV.');
      return;
    }

    const propertyId = document.getElementById('csvPropertySelect').value;
    if (!propertyId) {
      alert('Please select a property for this import.');
      return;
    }

    try {
      const result = await api('/api/finances/import-csv', {
        method: 'POST',
        body: JSON.stringify({ transactions, property_id: parseInt(propertyId) }),
      });

      csvPreviewData = [
        ...result.categorized.map(t => ({ ...t, auto: true })),
        ...result.uncategorized.map(t => ({ ...t, category: '', auto: false })),
      ];

      renderCsvPreview();
      document.getElementById('csvPreviewContainer').style.display = '';
    } catch (err) {
      alert('Error processing CSV: ' + err.message);
    }
  };

  reader.readAsText(file);
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function renderCsvPreview() {
  const body = document.getElementById('csvPreviewBody');
  const catOptions = categories.map(c => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`).join('');

  body.innerHTML = csvPreviewData.map((t, i) => {
    const selected = t.category ? t.category : '';
    return `<tr>
      <td>${escHtml(t.date)}</td>
      <td>${escHtml(t.description)}</td>
      <td>R ${Number(t.amount).toFixed(2)}</td>
      <td>
        <select id="csvCat-${i}" ${t.auto ? '' : 'style="border-color:#ff9900;"'}>
          <option value="">-- Select --</option>
          ${catOptions}
        </select>
        ${t.auto ? '<span style="font-size:0.7rem;color:#00aa44;margin-left:3px;">auto</span>' : ''}
      </td>
    </tr>`;
  }).join('');

  // Set selected values after render
  csvPreviewData.forEach((t, i) => {
    const sel = document.getElementById(`csvCat-${i}`);
    if (sel && t.category) sel.value = t.category;
  });
}

async function confirmCsvImport() {
  const expenses = [];
  const propertyId = document.getElementById('csvPropertySelect').value;

  for (let i = 0; i < csvPreviewData.length; i++) {
    const sel = document.getElementById(`csvCat-${i}`);
    const category = sel ? sel.value : csvPreviewData[i].category;
    if (!category) continue; // skip uncategorized

    expenses.push({
      property_id: parseInt(propertyId),
      category,
      amount: csvPreviewData[i].amount,
      description: csvPreviewData[i].description,
      expense_date: csvPreviewData[i].date,
    });
  }

  if (expenses.length === 0) {
    alert('No categorized expenses to import. Please assign categories first.');
    return;
  }

  try {
    const result = await api('/api/finances/import-csv/confirm', {
      method: 'POST',
      body: JSON.stringify({ expenses }),
    });
    alert(`Successfully imported ${result.imported} expenses!`);
    cancelCsvImport();
    loadExpenses();
    loadPnl();
  } catch (err) {
    alert('Error importing: ' + err.message);
  }
}

function cancelCsvImport() {
  csvPreviewData = [];
  document.getElementById('csvPreviewContainer').style.display = 'none';
  document.getElementById('csvFileInput').value = '';
}

// ─── KEYWORD MAPPINGS ───

async function loadKeywordMappings() {
  try {
    const mappings = await api('/api/finances/keyword-mappings');
    renderKeywordMappings(mappings);
  } catch (err) {
    console.error('Failed to load keyword mappings:', err);
  }
}

function renderKeywordMappings(mappings) {
  const container = document.getElementById('keywordMappingList');
  if (mappings.length === 0) {
    container.innerHTML = '<p style="color:#999;font-size:0.85rem;">No keyword mappings yet. Add mappings above to auto-categorize CSV imports.</p>';
    return;
  }

  container.innerHTML = `<table class="data-table">
    <thead><tr><th>Keyword</th><th>Category</th><th>Actions</th></tr></thead>
    <tbody>${mappings.map(m => `
      <tr>
        <td>${escHtml(m.keyword)}</td>
        <td>${escHtml(m.category_name)}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteKeywordMapping(${m.id})">Delete</button></td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

async function addKeywordMapping() {
  const keyword = document.getElementById('newKeyword').value.trim();
  const categoryId = document.getElementById('newKeywordCategory').value;
  if (!keyword || !categoryId) return;

  try {
    await api('/api/finances/keyword-mappings', {
      method: 'POST',
      body: JSON.stringify({ keyword, category_id: parseInt(categoryId) }),
    });
    document.getElementById('newKeyword').value = '';
    loadKeywordMappings();
  } catch (err) {
    alert('Error adding mapping: ' + err.message);
  }
}

async function deleteKeywordMapping(id) {
  if (!confirm('Delete this keyword mapping?')) return;
  try {
    await api(`/api/finances/keyword-mappings/${id}`, { method: 'DELETE' });
    loadKeywordMappings();
  } catch (err) {
    alert('Error deleting mapping: ' + err.message);
  }
}

// ─── BANK CONNECT ───

function submitBankConnectInterest() {
  const email = document.getElementById('bankConnectEmail').value.trim();
  if (!email) {
    alert('Please enter your email address.');
    return;
  }
  alert('Thank you! We\'ll notify you at ' + email + ' when bank connect is available.');
  document.getElementById('bankConnectEmail').value = '';
}

// ─── DRAG & DROP for CSV ───

(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('csvDropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.style.borderColor = '#1a1a2e';
      dropZone.style.background = '#f8f9ff';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = '#ddd';
      dropZone.style.background = '';
    });

    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.borderColor = '#ddd';
      dropZone.style.background = '';
      if (e.dataTransfer.files.length > 0) {
        handleCsvFile(e.dataTransfer.files[0]);
      }
    });
  });
})();

// ─── Utilities ───

function fmtNum(n) {
  return Math.round(n).toLocaleString('en-ZA');
}

function fmtMonth(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(mo) - 1] + ' ' + y.slice(2);
}

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize P&L date range to 30d on first load
(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('fin_pnl_range') || '30d';
    const btns = document.querySelectorAll('#pnlDateRange button');
    const rangeMap = { '30d': 0, '90d': 1, '6m': 2, '12m': 3, 'ytd': 4, 'custom': 5 };
    const idx = rangeMap[saved];
    if (idx !== undefined && btns[idx]) {
      setPnlRange(saved, btns[idx]);
    } else {
      setPnlRange('30d', btns[0]);
    }
  });
})();
