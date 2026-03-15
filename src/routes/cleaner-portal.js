const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/database');

// Resolve the cleaner record for the logged-in user (matched by email)
function getMyCleanerRecord(req) {
  const db = getDb();
  if (!req.user) return null;
  return db.prepare('SELECT * FROM cleaners WHERE email = ?').get(req.user.email) || null;
}

function requireCleaner(req, res, next) {
  const cleaner = getMyCleanerRecord(req);
  if (!cleaner) return res.status(403).json({ error: 'No cleaner profile linked to your account' });
  req.cleaner = cleaner;
  next();
}

// My profile + assigned properties
router.get('/me', requireCleaner, (req, res) => {
  const db = getDb();
  const c = req.cleaner;
  c.properties = db.prepare(
    'SELECT p.* FROM properties p JOIN cleaner_properties cp ON p.id = cp.property_id WHERE cp.cleaner_id = ?'
  ).all(c.id);
  c.availability = db.prepare(
    'SELECT * FROM cleaner_availability WHERE cleaner_id = ? ORDER BY day_of_week'
  ).all(c.id);
  c.overrides = db.prepare(
    'SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = ? ORDER BY date'
  ).all(c.id);
  res.json(c);
});

// My jobs (with guest info + special requirements)
router.get('/jobs', requireCleaner, (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  let sql = `SELECT cj.*, p.name as property_name, p.address as property_address,
             b.guest_name, b.num_guests, b.special_requirements, b.check_in, b.check_out
             FROM cleaning_jobs cj
             JOIN properties p ON cj.property_id = p.id
             LEFT JOIN bookings b ON cj.booking_id = b.id
             WHERE cj.cleaner_id = ?`;
  const params = [req.cleaner.id];
  if (from) { sql += ' AND cj.cleaning_date >= ?'; params.push(from); }
  if (to) { sql += ' AND cj.cleaning_date <= ?'; params.push(to); }
  sql += ' ORDER BY cj.cleaning_date ASC, cj.start_time ASC';
  res.json(db.prepare(sql).all(...params));
});

// Update job status
router.put('/jobs/:jobId/status', requireCleaner, (req, res) => {
  const db = getDb();
  const { status } = req.body;
  if (!['pending', 'confirmed', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const job = db.prepare('SELECT * FROM cleaning_jobs WHERE id = ? AND cleaner_id = ?').get(req.params.jobId, req.cleaner.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  db.prepare('UPDATE cleaning_jobs SET status = ? WHERE id = ?').run(status, job.id);
  res.json({ updated: true });
});

// Availability
router.put('/availability', requireCleaner, (req, res) => {
  const db = getDb();
  const { schedule } = req.body;
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule array required' });
  const del = db.prepare('DELETE FROM cleaner_availability WHERE cleaner_id = ?');
  const ins = db.prepare('INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    del.run(req.cleaner.id);
    for (const s of schedule) {
      if (s.day_of_week == null || !s.start_time || !s.end_time) continue;
      ins.run(req.cleaner.id, s.day_of_week, s.start_time, s.end_time);
    }
  })();
  const updated = db.prepare('SELECT * FROM cleaner_availability WHERE cleaner_id = ? ORDER BY day_of_week').all(req.cleaner.id);
  res.json(updated);
});

router.post('/overrides', requireCleaner, (req, res) => {
  const db = getDb();
  const { date, available } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const existing = db.prepare('SELECT id FROM cleaner_availability_overrides WHERE cleaner_id = ? AND date = ?').get(req.cleaner.id, date);
  if (existing) {
    db.prepare('UPDATE cleaner_availability_overrides SET available = ? WHERE id = ?').run(available ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO cleaner_availability_overrides (cleaner_id, date, available) VALUES (?, ?, ?)').run(req.cleaner.id, date, available ? 1 : 0);
  }
  res.json({ date, available: !!available });
});

router.delete('/overrides/:id', requireCleaner, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cleaner_availability_overrides WHERE id = ? AND cleaner_id = ?').run(req.params.id, req.cleaner.id);
  res.json({ deleted: true });
});

// Messaging
router.get('/messages', (req, res) => {
  const db = getDb();
  const messages = db.prepare(
    `SELECT m.*, s.name as sender_name, r.name as recipient_name
     FROM messages m
     JOIN users s ON m.sender_id = s.id
     LEFT JOIN users r ON m.recipient_id = r.id
     WHERE m.sender_id = ? OR m.recipient_id = ? OR m.recipient_id IS NULL
     ORDER BY m.created_at DESC`
  ).all(req.user.id, req.user.id);
  res.json(messages);
});

router.post('/messages', (req, res) => {
  const db = getDb();
  const { recipient_id, subject, body } = req.body;
  if (!body) return res.status(400).json({ error: 'Message body required' });
  const result = db.prepare(
    'INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, recipient_id || null, subject || '', body);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/messages/:id/read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE messages SET read = 1 WHERE id = ? AND recipient_id = ?').run(req.params.id, req.user.id);
  res.json({ read: true });
});

router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all();
  res.json(users);
});

// Maintenance (scoped to cleaner's properties)
router.get('/maintenance', requireCleaner, (req, res) => {
  const db = getDb();
  const propIds = db.prepare('SELECT property_id FROM cleaner_properties WHERE cleaner_id = ?').all(req.cleaner.id).map(r => r.property_id);
  if (propIds.length === 0) return res.json([]);
  const placeholders = propIds.map(() => '?').join(',');
  const issues = db.prepare(
    `SELECT m.*, p.name as property_name FROM maintenance_issues m
     JOIN properties p ON m.property_id = p.id
     WHERE m.property_id IN (${placeholders})
     ORDER BY m.reported_date DESC`
  ).all(...propIds);
  res.json(issues);
});

router.post('/maintenance', requireCleaner, (req, res) => {
  const db = getDb();
  const { property_id, title, description, category, priority } = req.body;
  if (!property_id || !title) return res.status(400).json({ error: 'property_id and title required' });
  // Verify cleaner has access to this property
  const access = db.prepare('SELECT 1 FROM cleaner_properties WHERE cleaner_id = ? AND property_id = ?').get(req.cleaner.id, property_id);
  if (!access) return res.status(403).json({ error: 'No access to this property' });
  const today = new Date().toISOString().split('T')[0];
  const result = db.prepare(
    'INSERT INTO maintenance_issues (property_id, title, description, category, priority, reported_date, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(property_id, title, description || '', category || 'General', priority || 'medium', today, req.cleaner.name);
  res.status(201).json({ id: result.lastInsertRowid });
});

// Inventory checklist
router.get('/inventory/:propertyId', requireCleaner, (req, res) => {
  const db = getDb();
  const items = db.prepare(
    'SELECT * FROM inventory_checklists WHERE property_id = ? ORDER BY category, sort_order, item_name'
  ).all(req.params.propertyId);
  res.json(items);
});

router.post('/inventory/check', requireCleaner, (req, res) => {
  const db = getDb();
  const { cleaning_job_id, items } = req.body;
  if (!cleaning_job_id || !Array.isArray(items)) return res.status(400).json({ error: 'cleaning_job_id and items array required' });
  // Verify job belongs to this cleaner
  const job = db.prepare('SELECT id FROM cleaning_jobs WHERE id = ? AND cleaner_id = ?').get(cleaning_job_id, req.cleaner.id);
  if (!job) return res.status(403).json({ error: 'Job not found or not yours' });
  const ins = db.prepare(
    'INSERT INTO inventory_checks (checklist_item_id, cleaning_job_id, actual_quantity, status, notes) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    // Clear previous checks for this job
    db.prepare('DELETE FROM inventory_checks WHERE cleaning_job_id = ?').run(cleaning_job_id);
    for (const item of items) {
      ins.run(item.checklist_item_id, cleaning_job_id, item.actual_quantity || 0, item.status || 'ok', item.notes || '');
    }
  })();
  res.json({ saved: items.length });
});

router.get('/inventory/checks/:jobId', requireCleaner, (req, res) => {
  const db = getDb();
  const checks = db.prepare(
    `SELECT ic.*, ich.item_name, ich.category, ich.expected_quantity
     FROM inventory_checks ic
     JOIN inventory_checklists ich ON ic.checklist_item_id = ich.id
     WHERE ic.cleaning_job_id = ?`
  ).all(req.params.jobId);
  res.json(checks);
});

// Shopping list
router.get('/shopping-list', (req, res) => {
  const db = getDb();
  const items = db.prepare(
    `SELECT s.*, p.name as property_name, u.name as added_by_name
     FROM shopping_list s
     LEFT JOIN properties p ON s.property_id = p.id
     JOIN users u ON s.added_by = u.id
     ORDER BY s.status ASC, s.created_at DESC`
  ).all();
  res.json(items);
});

router.post('/shopping-list', (req, res) => {
  const db = getDb();
  const { property_id, item_name, quantity, unit, notes } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name required' });
  const result = db.prepare(
    'INSERT INTO shopping_list (property_id, item_name, quantity, unit, added_by, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(property_id || null, item_name, quantity || 1, unit || '', req.user.id, notes || '');
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/shopping-list/:id/purchased', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE shopping_list SET status = 'purchased', purchased_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ purchased: true });
});

router.delete('/shopping-list/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM shopping_list WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// Notification preferences
router.get('/notification-prefs', requireCleaner, (req, res) => {
  const db = getDb();
  let prefs = db.prepare('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = ?').get(req.cleaner.id);
  if (!prefs) {
    db.prepare('INSERT INTO cleaner_notification_prefs (cleaner_id) VALUES (?)').run(req.cleaner.id);
    prefs = db.prepare('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = ?').get(req.cleaner.id);
  }
  res.json(prefs);
});

router.put('/notification-prefs', requireCleaner, (req, res) => {
  const db = getDb();
  const { whatsapp_enabled, notify_7_days, notify_1_day, notify_2_hours } = req.body;
  let prefs = db.prepare('SELECT id FROM cleaner_notification_prefs WHERE cleaner_id = ?').get(req.cleaner.id);
  if (!prefs) {
    db.prepare('INSERT INTO cleaner_notification_prefs (cleaner_id) VALUES (?)').run(req.cleaner.id);
  }
  db.prepare(
    'UPDATE cleaner_notification_prefs SET whatsapp_enabled = ?, notify_7_days = ?, notify_1_day = ?, notify_2_hours = ? WHERE cleaner_id = ?'
  ).run(whatsapp_enabled ? 1 : 0, notify_7_days ? 1 : 0, notify_1_day ? 1 : 0, notify_2_hours ? 1 : 0, req.cleaner.id);
  res.json({ updated: true });
});

// iCal subscription
router.get('/ical/token', requireCleaner, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT token FROM ical_tokens WHERE cleaner_id = ?').get(req.cleaner.id);
  if (!row) return res.json({ token: null, url: null });
  const url = `${req.protocol}://${req.get('host')}/ical/${row.token}`;
  res.json({ token: row.token, url });
});

router.post('/ical/generate', requireCleaner, (req, res) => {
  const db = getDb();
  const token = crypto.randomUUID();
  const existing = db.prepare('SELECT id FROM ical_tokens WHERE cleaner_id = ?').get(req.cleaner.id);
  if (existing) {
    db.prepare('UPDATE ical_tokens SET token = ?, created_at = datetime(\'now\') WHERE cleaner_id = ?').run(token, req.cleaner.id);
  } else {
    db.prepare('INSERT INTO ical_tokens (cleaner_id, token) VALUES (?, ?)').run(req.cleaner.id, token);
  }
  const url = `${req.protocol}://${req.get('host')}/ical/${token}`;
  res.json({ token, url });
});

module.exports = router;
