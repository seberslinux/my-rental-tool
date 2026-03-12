const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// Get all cleaners with their assigned properties
router.get('/', (req, res) => {
  const db = getDb();
  const cleaners = db.prepare('SELECT * FROM cleaners ORDER BY name ASC').all();

  for (const cleaner of cleaners) {
    cleaner.properties = db
      .prepare(
        `SELECT p.* FROM properties p
         JOIN cleaner_properties cp ON p.id = cp.property_id
         WHERE cp.cleaner_id = ?`
      )
      .all(cleaner.id);

    cleaner.availability = db
      .prepare('SELECT * FROM cleaner_availability WHERE cleaner_id = ? ORDER BY day_of_week ASC')
      .all(cleaner.id);

    cleaner.overrides = db
      .prepare('SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = ? ORDER BY date ASC')
      .all(cleaner.id);
  }

  res.json(cleaners);
});

// Pay summary for a month
router.get('/pay-summary', (req, res) => {
  const db = getDb();
  const month = req.query.month; // YYYY-MM

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param required in YYYY-MM format' });
  }

  const startDate = `${month}-01`;
  const endDate = `${month}-31`; // SQLite BETWEEN is inclusive; 31 is safe for any month

  let sql = `SELECT cj.*, p.name AS property_name, p.cleaning_hours_required,
            c.name AS cleaner_name, c.hourly_rate, c.flat_rate, c.rate_type
     FROM cleaning_jobs cj
     JOIN properties p ON cj.property_id = p.id
     JOIN cleaners c ON cj.cleaner_id = c.id
     WHERE cj.status = 'completed'
       AND cj.cleaning_date BETWEEN ? AND ?`;
  const params = [startDate, endDate];

  if (req.query.property_id && req.query.property_id !== 'all') {
    const propIds = req.query.property_id.split(',').map(s => s.trim()).filter(Boolean);
    if (propIds.length > 0) {
      sql += ` AND cj.property_id IN (${propIds.map(() => '?').join(',')})`;
      propIds.forEach(id => params.push(id));
    }
  }

  sql += ' ORDER BY c.name ASC, cj.cleaning_date ASC';
  const jobs = db.prepare(sql).all(...params);

  const cleanerMap = {};
  let grandTotal = 0;

  for (const job of jobs) {
    if (!cleanerMap[job.cleaner_id]) {
      cleanerMap[job.cleaner_id] = {
        cleaner_id: job.cleaner_id,
        cleaner_name: job.cleaner_name,
        jobs: [],
        subtotal: 0,
      };
    }

    const hours = job.cleaning_hours_required || 0;
    const rate = job.rate_type === 'flat' ? job.flat_rate : job.hourly_rate;
    const amount = job.rate_type === 'flat' ? job.flat_rate : job.hourly_rate * hours;

    cleanerMap[job.cleaner_id].jobs.push({
      job_id: job.id,
      property_name: job.property_name,
      cleaning_date: job.cleaning_date,
      hours: hours,
      rate: rate,
      rate_type: job.rate_type,
      amount: amount,
    });

    cleanerMap[job.cleaner_id].subtotal += amount;
    grandTotal += amount;
  }

  res.json({
    month,
    cleaners: Object.values(cleanerMap),
    grand_total: grandTotal,
  });
});

// Available cleaners for a specific date and property
router.get('/available-for-date', (req, res) => {
  const db = getDb();
  const { date, property_id } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'date query param is required' });
  }

  const dow = new Date(date + 'T12:00:00').getDay(); // day of week 0-6

  // Get cleaners assigned to the property (or all if no property_id)
  let cleaners;
  if (property_id) {
    cleaners = db.prepare(
      `SELECT c.* FROM cleaners c
       JOIN cleaner_properties cp ON c.id = cp.cleaner_id
       WHERE cp.property_id = ?
       ORDER BY c.name ASC`
    ).all(property_id);
  } else {
    cleaners = db.prepare('SELECT * FROM cleaners ORDER BY name ASC').all();
  }

  const available = [];

  for (const cleaner of cleaners) {
    // Check override first
    const override = db.prepare(
      'SELECT available FROM cleaner_availability_overrides WHERE cleaner_id = ? AND date = ?'
    ).get(cleaner.id, date);

    let isAvailable;
    if (override) {
      isAvailable = !!override.available;
    } else {
      // Check weekly schedule
      const weeklySlot = db.prepare(
        'SELECT * FROM cleaner_availability WHERE cleaner_id = ? AND day_of_week = ?'
      ).get(cleaner.id, dow);
      isAvailable = !!weeklySlot;
    }

    if (!isAvailable) continue;

    // Check if they already have a job on that date
    const existingJob = db.prepare(
      'SELECT id FROM cleaning_jobs WHERE cleaner_id = ? AND cleaning_date = ?'
    ).get(cleaner.id, date);

    if (existingJob) continue;

    available.push(cleaner);
  }

  res.json(available);
});

// Create a cleaner
router.post('/', (req, res) => {
  const db = getDb();
  const { name, phone, email, hourly_rate, flat_rate, rate_type, notes } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  // Validate E.164 phone format
  if (!/^\+\d{10,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Phone must be in E.164 format (e.g. +27821234567)' });
  }

  const result = db.prepare(
    'INSERT INTO cleaners (name, phone, email, hourly_rate, flat_rate, rate_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, phone, email || '', hourly_rate || 0, flat_rate || 0, rate_type || 'hourly', notes || '');

  res.status(201).json({
    id: result.lastInsertRowid,
    name,
    phone,
    email: email || '',
    hourly_rate: hourly_rate || 0,
    flat_rate: flat_rate || 0,
    rate_type: rate_type || 'hourly',
    notes: notes || '',
  });
});

// Assign a cleaning job
router.post('/jobs/assign', (req, res) => {
  const db = getDb();
  const { cleaner_id, property_id, booking_id, cleaning_date, start_time, end_time } = req.body;

  if (!cleaner_id || !property_id || !cleaning_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'cleaner_id, property_id, cleaning_date, start_time, and end_time are required' });
  }

  const result = db.prepare(
    `INSERT INTO cleaning_jobs (cleaner_id, property_id, booking_id, cleaning_date, start_time, end_time, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).run(cleaner_id, property_id, booking_id || null, cleaning_date, start_time, end_time);

  const job = db.prepare('SELECT * FROM cleaning_jobs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(job);
});

// Update a cleaner
router.put('/:id', (req, res) => {
  const db = getDb();

  if (req.body.phone && !/^\+\d{10,15}$/.test(req.body.phone)) {
    return res.status(400).json({ error: 'Phone must be in E.164 format (e.g. +27821234567)' });
  }

  const fields = ['name', 'phone', 'email', 'hourly_rate', 'flat_rate', 'rate_type', 'notes'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE cleaners SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM cleaners WHERE id = ?').get(req.params.id);
  if (!updated) return res.status(404).json({ error: 'Cleaner not found' });
  res.json(updated);
});

// Delete a cleaner
router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM cleaners WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Cleaner not found' });
  res.json({ deleted: true });
});

// Assign a cleaner to a property
router.post('/:id/properties', (req, res) => {
  const db = getDb();
  const { property_id } = req.body;

  try {
    db.prepare('INSERT INTO cleaner_properties (cleaner_id, property_id) VALUES (?, ?)').run(
      req.params.id,
      property_id
    );
    res.json({ assigned: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Already assigned' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Remove a cleaner from a property
router.delete('/:id/properties/:propertyId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cleaner_properties WHERE cleaner_id = ? AND property_id = ?').run(
    req.params.id,
    req.params.propertyId
  );
  res.json({ removed: true });
});

// Set weekly availability for a cleaner (replaces all existing)
router.put('/:id/availability', (req, res) => {
  const db = getDb();
  const { schedule } = req.body;
  // schedule: [{ day_of_week: 0-6, start_time: "09:00", end_time: "17:00" }, ...]

  if (!Array.isArray(schedule)) {
    return res.status(400).json({ error: 'Schedule must be an array' });
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM cleaner_availability WHERE cleaner_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)'
    );
    for (const slot of schedule) {
      insert.run(req.params.id, slot.day_of_week, slot.start_time, slot.end_time);
    }
  });

  transaction();

  const availability = db
    .prepare('SELECT * FROM cleaner_availability WHERE cleaner_id = ? ORDER BY day_of_week ASC')
    .all(req.params.id);
  res.json(availability);
});

// Add/update a date-specific override
router.post('/:id/overrides', (req, res) => {
  const db = getDb();
  const { date, available } = req.body;

  if (!date) return res.status(400).json({ error: 'Date is required' });

  // Upsert override
  const existing = db
    .prepare('SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = ? AND date = ?')
    .get(req.params.id, date);

  if (existing) {
    db.prepare('UPDATE cleaner_availability_overrides SET available = ? WHERE id = ?').run(
      available ? 1 : 0,
      existing.id
    );
  } else {
    db.prepare(
      'INSERT INTO cleaner_availability_overrides (cleaner_id, date, available) VALUES (?, ?, ?)'
    ).run(req.params.id, date, available ? 1 : 0);
  }

  res.json({ date, available: !!available });
});

// Delete a date override
router.delete('/:id/overrides/:overrideId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM cleaner_availability_overrides WHERE id = ? AND cleaner_id = ?').run(
    req.params.overrideId,
    req.params.id
  );
  res.json({ deleted: true });
});

// Get cleaning jobs for a cleaner
router.get('/:id/jobs', (req, res) => {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT cj.*, p.name as property_name
       FROM cleaning_jobs cj
       JOIN properties p ON cj.property_id = p.id
       WHERE cj.cleaner_id = ?
       ORDER BY cj.cleaning_date ASC`
    )
    .all(req.params.id);
  res.json(jobs);
});

// Update cleaning job status
router.put('/jobs/:jobId/status', (req, res) => {
  const db = getDb();
  const { status } = req.body;

  if (!['pending', 'confirmed', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare('UPDATE cleaning_jobs SET status = ? WHERE id = ?').run(status, req.params.jobId);
  const job = db.prepare('SELECT * FROM cleaning_jobs WHERE id = ?').get(req.params.jobId);
  res.json(job);
});

module.exports = router;
