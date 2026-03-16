const express = require('express');
const router = express.Router();
const { getAll, getOne, run } = require('../db/database');
const { scopeProperties, enforcePropertyScope } = require('../middleware/auth');

// Apply property scoping to all maintenance routes
router.use(scopeProperties);

// Helper: parse comma-separated property IDs
function parsePropertyIds(raw) {
  if (!raw || raw === 'all') return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function scopedPropertyIds(req) {
  return enforcePropertyScope(req, parsePropertyIds(req.query.property_id));
}

function addPropertyFilter(propIds, column, params) {
  if (!propIds) return '';
  const placeholders = propIds.map((id, i) => `$${params.length + i + 1}`).join(',');
  propIds.forEach(id => params.push(id));
  return ` AND ${column} IN (${placeholders})`;
}

// Priority ordering for sorting: urgent first
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

// GET /maintenance/summary — must be defined before /:id
router.get('/summary', async (req, res) => {
  try {
    const propIds = scopedPropertyIds(req);
    let where = '1=1';
    const params = [];
    where += addPropertyFilter(propIds, 'm.property_id', params);

    const rows = await getAll(`
      SELECT m.status, m.priority, COUNT(*) as cnt
      FROM maintenance_issues m
      WHERE ${where}
      GROUP BY m.status, m.priority
    `, params);

    let open = 0, in_progress = 0, resolved = 0, total = 0, urgent_open = 0;
    for (const r of rows) {
      total += parseInt(r.cnt);
      if (r.status === 'open') {
        open += parseInt(r.cnt);
        if (r.priority === 'urgent') urgent_open += parseInt(r.cnt);
      } else if (r.status === 'in_progress') {
        in_progress += parseInt(r.cnt);
        if (r.priority === 'urgent') urgent_open += parseInt(r.cnt);
      } else if (r.status === 'resolved') {
        resolved += parseInt(r.cnt);
      }
    }

    res.json({ open, in_progress, resolved, total, urgent_open });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /maintenance — list all issues
router.get('/', async (req, res) => {
  try {
    const { status, priority } = req.query;
    const propIds = scopedPropertyIds(req);

    let where = '1=1';
    const params = [];

    where += addPropertyFilter(propIds, 'm.property_id', params);

    if (status) {
      params.push(status);
      where += ` AND m.status = $${params.length}`;
    }
    if (priority) {
      params.push(priority);
      where += ` AND m.priority = $${params.length}`;
    }

    const issues = await getAll(`
      SELECT m.*, p.name as property_name
      FROM maintenance_issues m
      JOIN properties p ON m.property_id = p.id
      WHERE ${where}
      ORDER BY
        CASE m.priority
          WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC,
        m.reported_date DESC
    `, params);

    res.json(issues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /maintenance/:id — single issue
router.get('/:id', async (req, res) => {
  try {
    const issue = await getOne(`
      SELECT m.*, p.name as property_name
      FROM maintenance_issues m
      JOIN properties p ON m.property_id = p.id
      WHERE m.id = $1
    `, [req.params.id]);

    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /maintenance — create issue
router.post('/', async (req, res) => {
  try {
    const { property_id, title, description, category, priority, cost, assigned_to } = req.body;

    if (!property_id || !title) {
      return res.status(400).json({ error: 'property_id and title are required' });
    }

    const reported_date = new Date().toISOString().split('T')[0];

    const result = await run(`
      INSERT INTO maintenance_issues (property_id, title, description, category, priority, cost, assigned_to, reported_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [
      property_id,
      title,
      description || '',
      category || 'General',
      priority || 'medium',
      cost || 0,
      assigned_to || '',
      reported_date
    ]);

    const issue = await getOne(`
      SELECT m.*, p.name as property_name
      FROM maintenance_issues m
      JOIN properties p ON m.property_id = p.id
      WHERE m.id = $1
    `, [result.rows[0].id]);

    res.status(201).json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /maintenance/:id — update issue
router.put('/:id', async (req, res) => {
  try {
    const existing = await getOne('SELECT * FROM maintenance_issues WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Issue not found' });

    const fields = ['property_id', 'title', 'description', 'category', 'status', 'priority', 'reported_date', 'resolved_date', 'cost', 'assigned_to'];
    const updates = [];
    const params = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${params.length + 1}`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    await run(`UPDATE maintenance_issues SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

    const issue = await getOne(`
      SELECT m.*, p.name as property_name
      FROM maintenance_issues m
      JOIN properties p ON m.property_id = p.id
      WHERE m.id = $1
    `, [req.params.id]);

    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /maintenance/:id/resolve — resolve issue
router.patch('/:id/resolve', async (req, res) => {
  try {
    const existing = await getOne('SELECT * FROM maintenance_issues WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Issue not found' });

    const resolved_date = new Date().toISOString().split('T')[0];
    await run(`UPDATE maintenance_issues SET status = 'resolved', resolved_date = $1 WHERE id = $2`, [resolved_date, req.params.id]);

    const issue = await getOne(`
      SELECT m.*, p.name as property_name
      FROM maintenance_issues m
      JOIN properties p ON m.property_id = p.id
      WHERE m.id = $1
    `, [req.params.id]);

    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /maintenance/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await getOne('SELECT * FROM maintenance_issues WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Issue not found' });

    await run('DELETE FROM maintenance_issues WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
