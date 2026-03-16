const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getAll, getOne, run, transaction, inParams } = require('../db/database');

// Resolve the cleaner record for the logged-in user
async function getMyCleanerRecord(req) {
  // PIN-auth cleaner session (phone+PIN login)
  if (req.session && req.session.cleanerId) {
    return await getOne('SELECT * FROM cleaners WHERE id = $1', [req.session.cleanerId]) || null;
  }
  // Passport-auth cleaner (email match)
  if (!req.user) return null;
  return await getOne('SELECT * FROM cleaners WHERE email = $1', [req.user.email]) || null;
}

async function requireCleaner(req, res, next) {
  const cleaner = await getMyCleanerRecord(req);
  if (!cleaner) return res.status(403).json({ error: 'No cleaner profile linked to your account' });
  req.cleaner = cleaner;
  next();
}

// My profile + assigned properties
router.get('/me', requireCleaner, async (req, res) => {
  const c = req.cleaner;
  c.properties = await getAll(
    'SELECT p.* FROM properties p JOIN cleaner_properties cp ON p.id = cp.property_id WHERE cp.cleaner_id = $1',
    [c.id]
  );
  c.availability = await getAll(
    'SELECT * FROM cleaner_availability WHERE cleaner_id = $1 ORDER BY day_of_week',
    [c.id]
  );
  c.overrides = await getAll(
    'SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = $1 ORDER BY date',
    [c.id]
  );
  res.json(c);
});

// My jobs (with guest info + special requirements)
router.get('/jobs', requireCleaner, async (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT cj.*, p.name as property_name, p.address as property_address,
             b.guest_name, b.num_guests, b.special_requirements, b.check_in, b.check_out
             FROM cleaning_jobs cj
             JOIN properties p ON cj.property_id = p.id
             LEFT JOIN bookings b ON cj.booking_id = b.id
             WHERE cj.cleaner_id = $1`;
  const params = [req.cleaner.id];
  let paramIndex = 2;
  if (from) { sql += ` AND cj.cleaning_date >= $${paramIndex}`; params.push(from); paramIndex++; }
  if (to) { sql += ` AND cj.cleaning_date <= $${paramIndex}`; params.push(to); paramIndex++; }
  sql += ' ORDER BY cj.cleaning_date ASC, cj.start_time ASC';
  res.json(await getAll(sql, params));
});

// Get checklist for a job (property items merged with existing checks)
router.get('/jobs/:jobId/checklist', requireCleaner, async (req, res) => {
  const job = await getOne('SELECT * FROM cleaning_jobs WHERE id = $1 AND cleaner_id = $2', [req.params.jobId, req.cleaner.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const items = await getAll(
    'SELECT * FROM inventory_checklists WHERE property_id = $1 ORDER BY category, sort_order, item_name',
    [job.property_id]
  );
  const checks = await getAll(
    'SELECT * FROM inventory_checks WHERE cleaning_job_id = $1',
    [job.id]
  );
  const checkMap = {};
  for (const c of checks) checkMap[c.checklist_item_id] = c;

  const merged = items.map(item => ({
    ...item,
    check: checkMap[item.id] || null,
  }));
  res.json(merged);
});

// Mark job as ready for check-in
router.post('/jobs/:jobId/ready', requireCleaner, async (req, res) => {
  const job = await getOne('SELECT cj.*, p.name as property_name FROM cleaning_jobs cj JOIN properties p ON cj.property_id = p.id WHERE cj.id = $1 AND cj.cleaner_id = $2', [req.params.jobId, req.cleaner.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Verify all checklist items are completed
  const items = await getAll('SELECT id FROM inventory_checklists WHERE property_id = $1', [job.property_id]);
  if (items.length > 0) {
    const checks = await getAll('SELECT checklist_item_id FROM inventory_checks WHERE cleaning_job_id = $1', [job.id]);
    const checkedIds = new Set(checks.map(c => c.checklist_item_id));
    const missing = items.filter(i => !checkedIds.has(i.id));
    if (missing.length > 0) {
      return res.status(400).json({ error: `${missing.length} checklist item(s) not completed` });
    }
  }

  await run("UPDATE cleaning_jobs SET status = 'ready' WHERE id = $1", [job.id]);

  // Send WhatsApp notification to admin and property manager
  const adminPhone = process.env.ADMIN_WHATSAPP;
  const message = `✅ ${req.cleaner.name} marked "${job.property_name}" as ready for check-in (${job.cleaning_date}).`;

  // Collect phones to notify
  const phones = [];
  if (adminPhone) phones.push(adminPhone);

  // Find property manager(s) with phone numbers
  const managers = await getAll(
    `SELECT u.phone FROM users u
     JOIN user_property_access upa ON u.id = upa.user_id
     WHERE upa.property_id = $1 AND u.phone != '' AND u.phone IS NOT NULL`,
    [job.property_id]
  );
  for (const m of managers) {
    if (m.phone && !phones.includes(m.phone)) phones.push(m.phone);
  }

  // Send WhatsApp via API if configured
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && phones.length > 0) {
    for (const phone of phones) {
      try {
        await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: phone.replace(/^\+/, ''), type: 'text', text: { body: message } }),
        });
      } catch (err) {
        console.error(`Failed to send WhatsApp to ${phone}:`, err.message);
      }
    }
  } else if (phones.length > 0) {
    console.log(`[Ready notification] Would send to ${phones.join(', ')}: ${message}`);
  }

  res.json({ ready: true, notified: phones });
});

// Update job status
router.put('/jobs/:jobId/status', requireCleaner, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'completed', 'ready'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const job = await getOne('SELECT * FROM cleaning_jobs WHERE id = $1 AND cleaner_id = $2', [req.params.jobId, req.cleaner.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  await run('UPDATE cleaning_jobs SET status = $1 WHERE id = $2', [status, job.id]);
  res.json({ updated: true });
});

// Availability
router.put('/availability', requireCleaner, async (req, res) => {
  const { schedule } = req.body;
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule array required' });
  await transaction(async (client) => {
    await client.query('DELETE FROM cleaner_availability WHERE cleaner_id = $1', [req.cleaner.id]);
    for (const s of schedule) {
      if (s.day_of_week == null || !s.start_time || !s.end_time) continue;
      await client.query(
        'INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [req.cleaner.id, s.day_of_week, s.start_time, s.end_time]
      );
    }
  });
  const updated = await getAll('SELECT * FROM cleaner_availability WHERE cleaner_id = $1 ORDER BY day_of_week', [req.cleaner.id]);
  res.json(updated);
});

router.post('/overrides', requireCleaner, async (req, res) => {
  const { date, available } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const existing = await getOne('SELECT id FROM cleaner_availability_overrides WHERE cleaner_id = $1 AND date = $2', [req.cleaner.id, date]);
  if (existing) {
    await run('UPDATE cleaner_availability_overrides SET available = $1 WHERE id = $2', [available ? 1 : 0, existing.id]);
  } else {
    await run('INSERT INTO cleaner_availability_overrides (cleaner_id, date, available) VALUES ($1, $2, $3)', [req.cleaner.id, date, available ? 1 : 0]);
  }
  res.json({ date, available: !!available });
});

router.delete('/overrides/:id', requireCleaner, async (req, res) => {
  await run('DELETE FROM cleaner_availability_overrides WHERE id = $1 AND cleaner_id = $2', [req.params.id, req.cleaner.id]);
  res.json({ deleted: true });
});

// Messaging (only for Passport-auth users — PIN-auth cleaners use WhatsApp)
router.get('/messages', async (req, res) => {
  if (!req.user) return res.json([]);
  const messages = await getAll(
    `SELECT m.*, s.name as sender_name, r.name as recipient_name
     FROM messages m
     JOIN users s ON m.sender_id = s.id
     LEFT JOIN users r ON m.recipient_id = r.id
     WHERE m.sender_id = $1 OR m.recipient_id = $2 OR m.recipient_id IS NULL
     ORDER BY m.created_at DESC`,
    [req.user.id, req.user.id]
  );
  res.json(messages);
});

router.post('/messages', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Messaging not available for PIN-auth cleaners' });
  const { recipient_id, subject, body } = req.body;
  if (!body) return res.status(400).json({ error: 'Message body required' });
  const result = await run(
    'INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.user.id, recipient_id || null, subject || '', body]
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.patch('/messages/:id/read', async (req, res) => {
  if (!req.user) return res.json({ read: false });
  await run('UPDATE messages SET read = 1 WHERE id = $1 AND recipient_id = $2', [req.params.id, req.user.id]);
  res.json({ read: true });
});

router.get('/users', async (req, res) => {
  const users = await getAll('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name');
  res.json(users);
});

// Maintenance (scoped to cleaner's properties)
router.get('/maintenance', requireCleaner, async (req, res) => {
  const propRows = await getAll('SELECT property_id FROM cleaner_properties WHERE cleaner_id = $1', [req.cleaner.id]);
  const propIds = propRows.map(r => r.property_id);
  if (propIds.length === 0) return res.json([]);
  const ph = inParams(propIds, 1);
  const issues = await getAll(
    `SELECT m.*, p.name as property_name FROM maintenance_issues m
     JOIN properties p ON m.property_id = p.id
     WHERE m.property_id IN (${ph})
     ORDER BY m.reported_date DESC`,
    propIds
  );
  res.json(issues);
});

router.post('/maintenance', requireCleaner, async (req, res) => {
  const { property_id, title, description, category, priority } = req.body;
  if (!property_id || !title) return res.status(400).json({ error: 'property_id and title required' });
  // Verify cleaner has access to this property
  const access = await getOne('SELECT 1 FROM cleaner_properties WHERE cleaner_id = $1 AND property_id = $2', [req.cleaner.id, property_id]);
  if (!access) return res.status(403).json({ error: 'No access to this property' });
  const today = new Date().toISOString().split('T')[0];
  const result = await run(
    'INSERT INTO maintenance_issues (property_id, title, description, category, priority, reported_date, assigned_to) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [property_id, title, description || '', category || 'General', priority || 'medium', today, req.cleaner.name]
  );
  res.status(201).json({ id: result.rows[0].id });
});

// Inventory checklist
router.get('/inventory/:propertyId', requireCleaner, async (req, res) => {
  const items = await getAll(
    'SELECT * FROM inventory_checklists WHERE property_id = $1 ORDER BY category, sort_order, item_name',
    [req.params.propertyId]
  );
  res.json(items);
});

router.post('/inventory/check', requireCleaner, async (req, res) => {
  const { cleaning_job_id, items } = req.body;
  if (!cleaning_job_id || !Array.isArray(items)) return res.status(400).json({ error: 'cleaning_job_id and items array required' });
  // Verify job belongs to this cleaner
  const job = await getOne('SELECT id FROM cleaning_jobs WHERE id = $1 AND cleaner_id = $2', [cleaning_job_id, req.cleaner.id]);
  if (!job) return res.status(403).json({ error: 'Job not found or not yours' });
  await transaction(async (client) => {
    // Clear previous checks for this job
    await client.query('DELETE FROM inventory_checks WHERE cleaning_job_id = $1', [cleaning_job_id]);
    for (const item of items) {
      await client.query(
        'INSERT INTO inventory_checks (checklist_item_id, cleaning_job_id, actual_quantity, status, notes) VALUES ($1, $2, $3, $4, $5)',
        [item.checklist_item_id, cleaning_job_id, item.actual_quantity || 0, item.status || 'ok', item.notes || '']
      );
    }
  });
  res.json({ saved: items.length });
});

router.get('/inventory/checks/:jobId', requireCleaner, async (req, res) => {
  const checks = await getAll(
    `SELECT ic.*, ich.item_name, ich.category, ich.expected_quantity
     FROM inventory_checks ic
     JOIN inventory_checklists ich ON ic.checklist_item_id = ich.id
     WHERE ic.cleaning_job_id = $1`,
    [req.params.jobId]
  );
  res.json(checks);
});

// Shopping list
router.get('/shopping-list', async (req, res) => {
  const items = await getAll(
    `SELECT s.*, p.name as property_name, u.name as added_by_name
     FROM shopping_list s
     LEFT JOIN properties p ON s.property_id = p.id
     JOIN users u ON s.added_by = u.id
     ORDER BY s.status ASC, s.created_at DESC`
  );
  res.json(items);
});

router.post('/shopping-list', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Shopping list not available for PIN-auth cleaners' });
  const { property_id, item_name, quantity, unit, notes } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name required' });
  const result = await run(
    'INSERT INTO shopping_list (property_id, item_name, quantity, unit, added_by, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [property_id || null, item_name, quantity || 1, unit || '', req.user.id, notes || '']
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.patch('/shopping-list/:id/purchased', async (req, res) => {
  await run("UPDATE shopping_list SET status = 'purchased', purchased_at = NOW() WHERE id = $1", [req.params.id]);
  res.json({ purchased: true });
});

router.delete('/shopping-list/:id', async (req, res) => {
  await run('DELETE FROM shopping_list WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// Notification preferences
router.get('/notification-prefs', requireCleaner, async (req, res) => {
  let prefs = await getOne('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = $1', [req.cleaner.id]);
  if (!prefs) {
    await run('INSERT INTO cleaner_notification_prefs (cleaner_id) VALUES ($1)', [req.cleaner.id]);
    prefs = await getOne('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = $1', [req.cleaner.id]);
  }
  res.json(prefs);
});

router.put('/notification-prefs', requireCleaner, async (req, res) => {
  const { whatsapp_enabled, notify_7_days, notify_1_day, notify_2_hours } = req.body;
  let prefs = await getOne('SELECT id FROM cleaner_notification_prefs WHERE cleaner_id = $1', [req.cleaner.id]);
  if (!prefs) {
    await run('INSERT INTO cleaner_notification_prefs (cleaner_id) VALUES ($1)', [req.cleaner.id]);
  }
  await run(
    'UPDATE cleaner_notification_prefs SET whatsapp_enabled = $1, notify_7_days = $2, notify_1_day = $3, notify_2_hours = $4 WHERE cleaner_id = $5',
    [whatsapp_enabled ? 1 : 0, notify_7_days ? 1 : 0, notify_1_day ? 1 : 0, notify_2_hours ? 1 : 0, req.cleaner.id]
  );
  res.json({ updated: true });
});

// iCal subscription
router.get('/ical/token', requireCleaner, async (req, res) => {
  const row = await getOne('SELECT token FROM ical_tokens WHERE cleaner_id = $1', [req.cleaner.id]);
  if (!row) return res.json({ token: null, url: null });
  const url = `${req.protocol}://${req.get('host')}/ical/${row.token}`;
  res.json({ token: row.token, url });
});

router.post('/ical/generate', requireCleaner, async (req, res) => {
  const token = crypto.randomUUID();
  const existing = await getOne('SELECT id FROM ical_tokens WHERE cleaner_id = $1', [req.cleaner.id]);
  if (existing) {
    await run('UPDATE ical_tokens SET token = $1, created_at = NOW() WHERE cleaner_id = $2', [token, req.cleaner.id]);
  } else {
    await run('INSERT INTO ical_tokens (cleaner_id, token) VALUES ($1, $2)', [req.cleaner.id, token]);
  }
  const url = `${req.protocol}://${req.get('host')}/ical/${token}`;
  res.json({ token, url });
});

module.exports = router;
