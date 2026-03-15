const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { bulkConvert, bulkConvertExpenses, getDisplayCurrency } = require('../services/exchange-rates');

// Helper: parse property_id param (supports comma-separated IDs or 'all')
function parsePropertyIds(raw) {
  if (!raw || raw === 'all') return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function addPropertyFilter(propIds, column, params) {
  if (!propIds) return '';
  const placeholders = propIds.map(() => '?').join(',');
  propIds.forEach(id => params.push(id));
  return ` AND ${column} IN (${placeholders})`;
}

// ─── Expense Categories ───

router.get('/categories', (req, res) => {
  try {
    const db = getDb();
    const categories = db.prepare('SELECT * FROM expense_categories ORDER BY is_default DESC, name ASC').all();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = db.prepare('INSERT INTO expense_categories (name, is_default) VALUES (?, 0)').run(name.trim());
    res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), is_default: 0 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const cat = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    if (cat.is_default) return res.status(400).json({ error: 'Cannot delete default category' });

    db.prepare('DELETE FROM expense_categories WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Property Costs ───

router.get('/costs/:propertyId', (req, res) => {
  try {
    const db = getDb();
    const costs = db.prepare(`
      SELECT pc.*, ec.name as category_name
      FROM property_costs pc
      JOIN expense_categories ec ON pc.category_id = ec.id
      WHERE pc.property_id = ?
      ORDER BY ec.name ASC
    `).all(req.params.propertyId);
    res.json(costs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/costs', (req, res) => {
  try {
    const db = getDb();
    const { property_id, category_id, monthly_amount, is_variable } = req.body;
    if (!property_id || !category_id) {
      return res.status(400).json({ error: 'property_id and category_id are required' });
    }

    const result = db.prepare(`
      INSERT INTO property_costs (property_id, category_id, monthly_amount, is_variable)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(property_id, category_id) DO UPDATE SET
        monthly_amount = excluded.monthly_amount,
        is_variable = excluded.is_variable
    `).run(property_id, category_id, monthly_amount || 0, is_variable ? 1 : 0);

    res.json({ id: result.lastInsertRowid, property_id, category_id, monthly_amount: monthly_amount || 0, is_variable: is_variable ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Expenses (manual ledger) ───

router.get('/expenses', (req, res) => {
  try {
    const db = getDb();
    const { property_id, category, from, to } = req.query;
    const propIds = parsePropertyIds(property_id);

    let sql = `
      SELECT e.*, p.name as property_name, ec.name as category_name
      FROM expenses e
      JOIN properties p ON e.property_id = p.id
      LEFT JOIN expense_categories ec ON e.category = ec.name
      WHERE 1=1
    `;
    const params = [];

    sql += addPropertyFilter(propIds, 'e.property_id', params);
    if (category) {
      sql += ' AND e.category = ?';
      params.push(category);
    }
    if (from) {
      sql += ' AND e.expense_date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND e.expense_date <= ?';
      params.push(to);
    }

    sql += ' ORDER BY e.expense_date DESC';

    const expenses = db.prepare(sql).all(...params);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/expenses', (req, res) => {
  try {
    const db = getDb();
    const { property_id, category, amount, description, expense_date, receipt_path, recurring, recurring_frequency, currency } = req.body;

    if (!property_id || !category || amount == null || !expense_date) {
      return res.status(400).json({ error: 'property_id, category, amount, and expense_date are required' });
    }

    // Verify the category exists
    const cat = db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(category);
    if (!cat) {
      return res.status(400).json({ error: `Category "${category}" not found` });
    }

    const result = db.prepare(`
      INSERT INTO expenses (property_id, category, amount, description, expense_date, receipt_path, recurring, recurring_frequency, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(property_id, category, amount, description || '', expense_date, receipt_path || '', recurring ? 1 : 0, recurring_frequency || '', currency || 'ZAR');

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/expenses/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    const fields = ['property_id', 'category', 'amount', 'description', 'expense_date', 'receipt_path', 'recurring', 'recurring_frequency', 'currency'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(field === 'recurring' ? (req.body[field] ? 1 : 0) : req.body[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    db.prepare(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/expenses/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CSV Import ───

router.post('/import-csv', (req, res) => {
  try {
    const db = getDb();
    const { transactions, property_id } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'transactions array is required' });
    }

    const mappings = db.prepare(`
      SELECT km.keyword, ec.name as category_name
      FROM csv_keyword_mappings km
      JOIN expense_categories ec ON km.category_id = ec.id
    `).all();

    const categorized = [];
    const uncategorized = [];

    for (const tx of transactions) {
      const desc = (tx.description || '').toLowerCase();
      let matched = null;

      for (const m of mappings) {
        if (desc.includes(m.keyword.toLowerCase())) {
          matched = m.category_name;
          break;
        }
      }

      const entry = {
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        property_id: property_id,
      };

      if (matched) {
        entry.category = matched;
        categorized.push(entry);
      } else {
        uncategorized.push(entry);
      }
    }

    res.json({ categorized, uncategorized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-csv/confirm', (req, res) => {
  try {
    const db = getDb();
    const { expenses } = req.body;

    if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
      return res.status(400).json({ error: 'expenses array is required' });
    }

    const insert = db.prepare(`
      INSERT INTO expenses (property_id, category, amount, description, expense_date)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((items) => {
      let count = 0;
      for (const e of items) {
        insert.run(e.property_id, e.category, e.amount, e.description || '', e.expense_date);
        count++;
      }
      return count;
    });

    const count = transaction(expenses);
    res.json({ imported: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Keyword Mappings ───

router.get('/keyword-mappings', (req, res) => {
  try {
    const db = getDb();
    const mappings = db.prepare(`
      SELECT km.*, ec.name as category_name
      FROM csv_keyword_mappings km
      JOIN expense_categories ec ON km.category_id = ec.id
      ORDER BY km.keyword ASC
    `).all();
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/keyword-mappings', (req, res) => {
  try {
    const db = getDb();
    const { keyword, category_id } = req.body;
    if (!keyword || !category_id) {
      return res.status(400).json({ error: 'keyword and category_id are required' });
    }

    const result = db.prepare('INSERT INTO csv_keyword_mappings (keyword, category_id) VALUES (?, ?)').run(keyword.trim(), category_id);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/keyword-mappings/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM csv_keyword_mappings WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── P&L Data ───

router.get('/pnl', async (req, res) => {
  try {
    const db = getDb();
    const { property_id, from, to } = req.query;
    const propIds = parsePropertyIds(property_id);
    const displayCurrency = getDisplayCurrency();

    // Build date filters
    let bookingWhere = "b.status = 'confirmed'";
    let expenseWhere = '1=1';
    const bookingParams = [];
    const expenseParams = [];

    bookingWhere += addPropertyFilter(propIds, 'b.property_id', bookingParams);
    expenseWhere += addPropertyFilter(propIds, 'e.property_id', expenseParams);
    if (from) {
      bookingWhere += ' AND b.check_in >= ?';
      bookingParams.push(from);
      expenseWhere += ' AND e.expense_date >= ?';
      expenseParams.push(from);
    }
    if (to) {
      bookingWhere += ' AND b.check_in <= ?';
      bookingParams.push(to);
      expenseWhere += ' AND e.expense_date <= ?';
      expenseParams.push(to);
    }

    // Fetch individual bookings for currency conversion
    const revenueBookings = db.prepare(`
      SELECT b.total_price, b.check_in, b.currency FROM bookings b WHERE ${bookingWhere}
    `).all(...bookingParams);
    await bulkConvert(revenueBookings, displayCurrency);
    const totalRevenue = revenueBookings.reduce((sum, b) => sum + (b.converted_total_price || 0), 0);

    // Fetch individual expenses for currency conversion
    const expenseRows = db.prepare(`
      SELECT e.amount, e.expense_date, e.currency FROM expenses e WHERE ${expenseWhere}
    `).all(...expenseParams);
    await bulkConvertExpenses(expenseRows, displayCurrency);
    const totalCosts = expenseRows.reduce((sum, e) => sum + (e.converted_amount || 0), 0);

    const netProfit = totalRevenue - totalCosts;
    const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100 * 10) / 10 : 0;

    // Monthly P&L (with conversion)
    const monthlyRevenueMap = {};
    for (const b of revenueBookings) {
      const month = b.check_in.substring(0, 7);
      monthlyRevenueMap[month] = (monthlyRevenueMap[month] || 0) + (b.converted_total_price || 0);
    }

    const monthlyCostsMap = {};
    for (const e of expenseRows) {
      const month = e.expense_date.substring(0, 7);
      monthlyCostsMap[month] = (monthlyCostsMap[month] || 0) + (e.converted_amount || 0);
    }

    // Merge monthly data
    const monthMap = {};
    for (const [month, revenue] of Object.entries(monthlyRevenueMap)) {
      monthMap[month] = { month, revenue: Math.round(revenue * 100) / 100, costs: 0, net_profit: 0 };
    }
    for (const [month, costs] of Object.entries(monthlyCostsMap)) {
      if (!monthMap[month]) monthMap[month] = { month, revenue: 0, costs: 0, net_profit: 0 };
      monthMap[month].costs = Math.round(costs * 100) / 100;
    }
    const monthlyPnl = Object.values(monthMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, net_profit: Math.round((m.revenue - m.costs) * 100) / 100 }));

    // Cost breakdown by category (with conversion)
    const allExpenses = db.prepare(`
      SELECT e.category, e.amount, e.expense_date, e.currency FROM expenses e WHERE ${expenseWhere}
    `).all(...expenseParams);
    await bulkConvertExpenses(allExpenses, displayCurrency);
    const catMap = {};
    for (const e of allExpenses) {
      catMap[e.category] = (catMap[e.category] || 0) + (e.converted_amount || 0);
    }
    const costBreakdown = Object.entries(catMap)
      .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);

    // Booking profitability
    const bookings = db.prepare(`
      SELECT b.id as booking_id, b.guest_name, b.check_in, b.check_out, b.total_price,
             b.platform, b.property_id, b.currency,
             p.name as property_name, p.cleaning_hours_required,
             p.commission_airbnb, p.commission_booking, p.commission_vrbo,
             p.bank_charge_airbnb, p.bank_charge_booking, p.bank_charge_vrbo, p.vat_rate
      FROM bookings b
      JOIN properties p ON b.property_id = p.id
      WHERE ${bookingWhere}
      ORDER BY b.check_in DESC
    `).all(...bookingParams);
    await bulkConvert(bookings, displayCurrency);

    const bookingProfitability = bookings.map(bk => {
      const revenue = bk.converted_total_price || 0;

      // Platform fee + bank charge
      const platform = (bk.platform || '').toLowerCase();
      let commissionRate = 0;
      let bankChargeRate = 0;
      if (platform.includes('airbnb')) {
        commissionRate = (bk.commission_airbnb || 18) / 100;
        bankChargeRate = (bk.bank_charge_airbnb || 0) / 100;
      } else if (platform.includes('booking')) {
        commissionRate = (bk.commission_booking || 15) / 100;
        bankChargeRate = (bk.bank_charge_booking || 2.1) / 100;
      } else if (platform.includes('vrbo') || platform.includes('homeaway')) {
        commissionRate = (bk.commission_vrbo || 8) / 100;
        bankChargeRate = (bk.bank_charge_vrbo || 0) / 100;
      }
      const platformFee = Math.round(revenue * commissionRate * 100) / 100;
      const bankCharge = Math.round(revenue * bankChargeRate * 100) / 100;

      // Cleaning cost: find the cleaner assigned to this booking's cleaning job
      let cleaningCost = 0;
      const cleaningJob = db.prepare(`
        SELECT cj.cleaner_id, c.hourly_rate, c.flat_rate, c.rate_type
        FROM cleaning_jobs cj
        LEFT JOIN cleaners c ON cj.cleaner_id = c.id
        WHERE cj.booking_id = ?
        LIMIT 1
      `).get(bk.booking_id);

      if (cleaningJob && cleaningJob.cleaner_id) {
        if (cleaningJob.rate_type === 'flat') {
          cleaningCost = cleaningJob.flat_rate || 0;
        } else {
          cleaningCost = (cleaningJob.hourly_rate || 0) * (bk.cleaning_hours_required || 2.5);
        }
      }

      const netProfit = revenue - platformFee - bankCharge - cleaningCost;

      return {
        booking_id: bk.booking_id,
        guest_name: bk.guest_name,
        property_name: bk.property_name,
        check_in: bk.check_in,
        check_out: bk.check_out,
        platform: bk.platform,
        revenue,
        cleaning_cost: Math.round(cleaningCost * 100) / 100,
        platform_fee: platformFee,
        bank_charge: bankCharge,
        net_profit: Math.round(netProfit * 100) / 100,
      };
    });

    res.json({
      display_currency: displayCurrency,
      summary: {
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_costs: Math.round(totalCosts * 100) / 100,
        net_profit: Math.round(netProfit * 100) / 100,
        profit_margin: profitMargin,
      },
      monthly_pnl: monthlyPnl,
      cost_breakdown: costBreakdown,
      booking_profitability: bookingProfitability,
    });
  } catch (err) {
    console.error('P&L error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
