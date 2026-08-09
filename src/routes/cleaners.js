const express = require('express');
const router = express.Router();
const { getAll, getOne, run, transaction, inParams } = require('../db/database');
const crypto = require('crypto');
const { requireRole } = require('../middleware/auth');
const { sendInviteLink } = require('../services/cleaner-notify');
// One definition of who can work when, shared with assignment.
const { loadAvailability, cleanerDayStatus, ymd, prettyDate } = require('../services/availability');
// One place decides who gets told what.
const { notify } = require('../services/notify');
// One definition of what "blocked" means, shared with revenue.
const { isBlockedPlatform } = require('../services/analytics-calc');

// Long enough that an owner can send it at their convenience, short
// enough that a link forwarded once and forgotten does not stay live.
const INVITE_VALID_DAYS = 7;

// Get all cleaners with their assigned properties
router.get('/', async (req, res) => {
  const cleaners = await getAll('SELECT * FROM cleaners ORDER BY name ASC');

  for (const cleaner of cleaners) {
    cleaner.properties = await getAll(
      `SELECT p.* FROM properties p
       JOIN cleaner_properties cp ON p.id = cp.property_id
       WHERE cp.cleaner_id = $1`,
      [cleaner.id]
    );

    cleaner.availability = await getAll(
      'SELECT * FROM cleaner_availability WHERE cleaner_id = $1 ORDER BY day_of_week ASC',
      [cleaner.id]
    );

    cleaner.overrides = await getAll(
      'SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = $1 ORDER BY date ASC',
      [cleaner.id]
    );
  }

  res.json(cleaners);
});

/**
 * The calendar's view of cleaning: who is free, what needs doing, and
 * where the two do not meet.
 *
 * The manager's calendar had no idea any of this existed. It drew its
 * only cleaner marker from pending jobs keyed by day-of-month, so a job
 * on the 19th of August marked the 19th of every month, and a cleaner
 * setting their availability in their own app changed nothing anybody
 * could see.
 *
 * The shape is one entry per date, because that is how a grid is drawn.
 * The interesting field is `unmet`: a checkout with nobody attached.
 * Every checkout needs a cleaner or its nights get blocked, and until
 * now there was nowhere to see which ones were still short.
 */
router.get('/calendar', async (req, res) => {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  }

  const cleaners = await getAll('SELECT id, name FROM cleaners ORDER BY name');
  const links = await getAll('SELECT cleaner_id, property_id FROM cleaner_properties');
  const av = await loadAvailability(cleaners.map((c) => c.id));

  const jobs = await getAll(
    `SELECT cj.id, cj.property_id, cj.cleaning_date, cj.status, cj.cleaner_id,
            cj.start_time, cj.end_time, cj.reason, cj.note,
            cj.started_at, cj.completed_at,
            c.name AS cleaner_name, p.name AS property_name
       FROM cleaning_jobs cj
       LEFT JOIN cleaners c ON c.id = cj.cleaner_id
       LEFT JOIN properties p ON p.id = cj.property_id
      WHERE cj.cleaning_date >= $1 AND cj.cleaning_date <= $2`,
    [from, to]
  );

  // Checkouts are what create the work. Blocks are excluded for the same
  // reason assignment excludes them: nobody slept there.
  const checkoutRows = await getAll(
    `SELECT b.smoobu_id, b.property_id, b.check_out, b.platform, p.name AS property_name
       FROM bookings b
       LEFT JOIN properties p ON p.id = b.property_id
      WHERE b.check_out >= $1 AND b.check_out <= $2 AND b.status = 'confirmed'`,
    [from, to]
  );
  const checkouts = checkoutRows.filter((b) => !isBlockedPlatform(b.platform));

  // Arrivals too, because "before check-in" is only a thing you can ask
  // for on a day somebody actually arrives. Offering it on a day with no
  // arrival is offering a choice that cannot mean anything.
  const checkinRows = await getAll(
    `SELECT b.smoobu_id, b.property_id, b.check_in, b.platform, p.name AS property_name
       FROM bookings b
       LEFT JOIN properties p ON p.id = b.property_id
      WHERE b.check_in >= $1 AND b.check_in <= $2 AND b.status = 'confirmed'`,
    [from, to]
  );

  const days = {};
  const dayOf = (key) => {
    if (!days[key]) days[key] = { available: [], unavailable: [], jobs: [], checkouts: [], checkins: [], unmet: [] };
    return days[key];
  };

  // Walk the range rather than the rows, so a day with nothing on it
  // still reports who could have worked it.
  for (let d = new Date(`${from}T00:00:00`); ymd(d) <= to; d.setDate(d.getDate() + 1)) {
    const key = ymd(d);
    const day = dayOf(key);
    cleaners.forEach((c) => {
      const status = cleanerDayStatus(av, c.id, key);
      const entry = {
        id: c.id, name: c.name, reason: status.reason,
        property_ids: links.filter((l) => l.cleaner_id === c.id).map((l) => l.property_id),
      };
      // Both lists, not just the free one. Somebody who is not available
      // can still be asked — the job is created pending and they answer
      // it — and a manager short of a cleaner needs to see who there is
      // to ask before deciding to block the nights instead.
      (status.available ? day.available : day.unavailable).push(entry);
    });
  }

  jobs.forEach((j) => {
    const day = dayOf(ymd(j.cleaning_date));
    // Assigned is not the same as still willing. A cleaner can mark
    // themselves unavailable on a day they were already given, and
    // nothing anywhere pointed that out — the job simply sat there
    // looking covered.
    // Work that has been started or finished is settled. Whether that
    // cleaner is "available" on the day stopped mattering the moment they
    // turned up — a finished clean flagged as a problem because the person
    // who did it has since marked the day off is nonsense, and it is the
    // loudest kind, because it wears the same amber as a real gap.
    const settled = Boolean(j.started_at || j.completed_at);
    const stillFree = settled || (j.cleaner_id ?
    cleanerDayStatus(av, j.cleaner_id, ymd(j.cleaning_date)).available :
    false);
    day.jobs.push({
      id: j.id, property_id: j.property_id, property_name: j.property_name,
      cleaner_id: j.cleaner_id, cleaner_name: j.cleaner_name, status: j.status,
      cleaner_available: stillFree,
      done: Boolean(j.completed_at),
      started: Boolean(j.started_at),
      start_time: j.start_time, end_time: j.end_time,
      reason: j.reason, note: j.note,
    });
  });

  checkinRows.filter((b) => !isBlockedPlatform(b.platform)).forEach((b) => {
    dayOf(ymd(b.check_in)).checkins.push({
      booking_id: b.smoobu_id, property_id: b.property_id, property_name: b.property_name,
    });
  });

  checkouts.forEach((b) => {
    const key = ymd(b.check_out);
    const day = dayOf(key);
    day.checkouts.push({
      booking_id: b.smoobu_id, property_id: b.property_id, property_name: b.property_name,
    });
    const covered = day.jobs.some(
      (j) => j.property_id === b.property_id && j.status !== 'declined'
    );
    if (!covered) {
      day.unmet.push({ property_id: b.property_id, property_name: b.property_name, booking_id: b.smoobu_id });
    }
  });

  res.json({ from, to, days });
});

// Pay summary for a month
router.get('/pay-summary', async (req, res) => {
  const month = req.query.month; // YYYY-MM

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param required in YYYY-MM format' });
  }

  const startDate = `${month}-01`;
  const endDate = `${month}-31`; // BETWEEN is inclusive; 31 is safe for any month

  let paramIdx = 1;
  let sql = `SELECT cj.*, p.name AS property_name, p.cleaning_hours_required,
            c.name AS cleaner_name, c.hourly_rate, c.flat_rate, c.rate_type
     FROM cleaning_jobs cj
     JOIN properties p ON cj.property_id = p.id
     JOIN cleaners c ON cj.cleaner_id = c.id
     WHERE cj.status = 'completed'
       AND cj.cleaning_date BETWEEN $${paramIdx++} AND $${paramIdx++}`;
  const params = [startDate, endDate];

  if (req.query.property_id && req.query.property_id !== 'all') {
    const propIds = req.query.property_id.split(',').map(s => s.trim()).filter(Boolean);
    if (propIds.length > 0) {
      const placeholders = propIds.map(() => `$${paramIdx++}`).join(',');
      sql += ` AND cj.property_id IN (${placeholders})`;
      propIds.forEach(id => params.push(id));
    }
  }

  sql += ' ORDER BY c.name ASC, cj.cleaning_date ASC';
  const jobs = await getAll(sql, params);

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

// List cleaner payments (optionally filtered by month and cleaner_id)
router.get('/payments', async (req, res) => {
  let paramIdx = 1;
  let sql = 'SELECT cp.*, c.name AS cleaner_name, c.phone AS cleaner_phone FROM cleaner_payments cp JOIN cleaners c ON cp.cleaner_id = c.id WHERE 1=1';
  const params = [];

  if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
    sql += ` AND cp.month = $${paramIdx++}`;
    params.push(req.query.month);
  }
  if (req.query.cleaner_id) {
    sql += ` AND cp.cleaner_id = $${paramIdx++}`;
    params.push(req.query.cleaner_id);
  }

  sql += ' ORDER BY cp.month DESC, c.name ASC';
  const payments = await getAll(sql, params);
  res.json(payments);
});

// Create a cleaner payment
router.post('/payments', async (req, res) => {
  const { cleaner_id, month, amount, payment_method, notes } = req.body;

  if (!cleaner_id || !month || amount == null) {
    return res.status(400).json({ error: 'cleaner_id, month, and amount are required' });
  }

  const result = await run(
    'INSERT INTO cleaner_payments (cleaner_id, month, amount, payment_method, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [cleaner_id, month, amount, payment_method || '', notes || '']
  );

  const payment = await getOne('SELECT * FROM cleaner_payments WHERE id = $1', [result.rows[0].id]);
  res.status(201).json(payment);
});

// Mark a payment as paid
router.patch('/payments/:paymentId/mark-paid', async (req, res) => {
  const paidAt = new Date().toISOString();
  await run('UPDATE cleaner_payments SET paid_at = $1 WHERE id = $2', [paidAt, req.params.paymentId]);

  const payment = await getOne('SELECT * FROM cleaner_payments WHERE id = $1', [req.params.paymentId]);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

// Delete a payment
router.delete('/payments/:paymentId', async (req, res) => {
  const result = await run('DELETE FROM cleaner_payments WHERE id = $1', [req.params.paymentId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Payment not found' });
  res.json({ deleted: true });
});

// Available cleaners for a specific date and property
router.get('/available-for-date', async (req, res) => {
  const { date, property_id } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'date query param is required' });
  }

  const dow = new Date(date + 'T12:00:00').getDay(); // day of week 0-6

  // Get cleaners assigned to the property (or all if no property_id)
  let cleaners;
  if (property_id) {
    cleaners = await getAll(
      `SELECT c.* FROM cleaners c
       JOIN cleaner_properties cp ON c.id = cp.cleaner_id
       WHERE cp.property_id = $1
       ORDER BY c.name ASC`,
      [property_id]
    );
  } else {
    cleaners = await getAll('SELECT * FROM cleaners ORDER BY name ASC');
  }

  const available = [];

  for (const cleaner of cleaners) {
    // Check override first
    const override = await getOne(
      'SELECT available FROM cleaner_availability_overrides WHERE cleaner_id = $1 AND date = $2',
      [cleaner.id, date]
    );

    let isAvailable;
    if (override) {
      isAvailable = !!override.available;
    } else {
      // Check weekly schedule
      const weeklySlot = await getOne(
        'SELECT * FROM cleaner_availability WHERE cleaner_id = $1 AND day_of_week = $2',
        [cleaner.id, dow]
      );
      isAvailable = !!weeklySlot;
    }

    if (!isAvailable) continue;

    // Check if they already have a job on that date
    const existingJob = await getOne(
      'SELECT id FROM cleaning_jobs WHERE cleaner_id = $1 AND cleaning_date = $2',
      [cleaner.id, date]
    );

    if (existingJob) continue;

    available.push(cleaner);
  }

  res.json(available);
});

// Create a cleaner (one-step: profile + PIN + availability + properties)
router.post('/', async (req, res) => {
  const { name, phone, email, hourly_rate, flat_rate, rate_type, notes, pin, availability, property_ids } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  // Validate E.164 phone format
  if (!/^\+\d{10,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Phone must be in E.164 format (e.g. +27821234567)' });
  }

  // Validate PIN if provided
  let hashedPin = null;
  if (pin) {
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }
    const bcrypt = require('bcrypt');
    hashedPin = bcrypt.hashSync(pin, 10);
  }

  try {
    const result = await transaction(async (client) => {
      const ins = await client.query(
        'INSERT INTO cleaners (name, phone, email, hourly_rate, flat_rate, rate_type, notes, pin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [name, phone, email || '', hourly_rate || 0, flat_rate || 0, rate_type || 'hourly', notes || '', hashedPin]
      );
      const cleanerId = ins.rows[0].id;

      // Assign properties
      if (Array.isArray(property_ids)) {
        for (const pid of property_ids) {
          await client.query(
            'INSERT INTO cleaner_properties (cleaner_id, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [cleanerId, pid]
          );
        }
      }

      // Set availability
      if (Array.isArray(availability)) {
        for (const slot of availability) {
          if (slot.day_of_week == null || !slot.start_time || !slot.end_time) continue;
          await client.query(
            'INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
            [cleanerId, slot.day_of_week, slot.start_time, slot.end_time]
          );
        }
      }

      return cleanerId;
    });

    res.status(201).json({
      id: result,
      name,
      phone,
      email: email || '',
      hourly_rate: hourly_rate || 0,
      flat_rate: flat_rate || 0,
      rate_type: rate_type || 'hourly',
      notes: notes || '',
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A cleaner with this phone number already exists' });
    }
    throw err;
  }
});

// Assign a cleaning job
/**
 * Send somebody to a property on a day.
 *
 * A cleaning job used to mean one thing, because only assignment created
 * them and assignment runs off a checkout. So there was no way to send a
 * cleaner in to prepare for an arrival, or for a deep clean between
 * seasons — the work was attached to a booking, and without a booking
 * there was nothing to attach it to. It belongs to the property; the
 * booking, when there is one, is just what prompted it.
 *
 * Times follow the reason unless they are given, and they are worked out
 * here rather than in the browser: a turnover starts when the guests
 * leave, a preparation has to be finished before the next lot arrive, and
 * anything else is a working morning. Duplicating that arithmetic in the
 * client is how the two would drift.
 */
const REASONS = new Set(['checkout', 'checkin', 'other']);

router.post('/jobs/assign', async (req, res) => {
  const { cleaner_id, property_id, booking_id, cleaning_date, start_time, end_time, note } = req.body;
  const reason = REASONS.has(req.body.reason) ? req.body.reason : 'checkout';

  if (!cleaner_id || !property_id || !cleaning_date) {
    return res.status(400).json({ error: 'cleaner_id, property_id, and cleaning_date are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cleaning_date))) {
    return res.status(400).json({ error: 'cleaning_date must be YYYY-MM-DD' });
  }
  // The client hides past days, but the rule belongs here too: a job in
  // the past can never be started, because the window that governs
  // starting one closed before it was created.
  if (cleaning_date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'That day has already passed' });
  }

  const prop = await getOne(
    'SELECT name, address, check_in_time, check_out_time, cleaning_hours_required FROM properties WHERE id = $1',
    [property_id]
  );
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const hours = Number(prop.cleaning_hours_required) || 2.5;
  const mins = (t, fallback) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
    // Number('') is 0, so an unset column would otherwise read as midnight.
    return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
  };
  const clock = (m) => {
    const wrapped = Math.max(0, Math.min(23 * 60 + 59, m));
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  };

  let from;
  if (reason === 'checkin') {
    // Finished before they arrive, so it is the end that is fixed.
    from = mins(prop.check_in_time, 15 * 60) - hours * 60;
  } else if (reason === 'checkout') {
    from = mins(prop.check_out_time, 10 * 60);
  } else {
    from = 10 * 60;
  }

  const startsAt = start_time || clock(from);
  const endsAt = end_time || clock(mins(startsAt, from) + hours * 60);

  // What is already on that property that day, so this does not quietly
  // become the second copy of it.
  const existing = await getAll(
    `SELECT id, cleaner_id, status FROM cleaning_jobs
      WHERE property_id = $1 AND cleaning_date = $2
        AND status NOT IN ('declined', 'cancelled')`,
    [property_id, cleaning_date]
  );

  // Asking the same person for the same day twice is a mis-tap, not a
  // second job. It produced two identical rows, one confirmed and one
  // pending, and a cleaner with the same shift listed twice in their app.
  // Only work still waiting to happen counts as a clash. A clean they
  // already finished that morning does not stop them being asked back in
  // the afternoon.
  if (existing.some((j) =>
  String(j.cleaner_id) === String(cleaner_id) &&
  ['pending', 'confirmed', 'in_progress'].includes(j.status))) {
    return res.status(409).json({ error: 'They are already down for that property that day' });
  }

  // A job sitting there with nobody on it is the hole this is meant to
  // fill. Filling it beats creating a second row beside it and leaving
  // the empty one behind looking like more work than there is.
  const orphan = existing.find((j) => j.cleaner_id === null);

  const result = orphan ?
  await run(
    `UPDATE cleaning_jobs
        SET cleaner_id = $1, booking_id = COALESCE($2, booking_id),
            start_time = $3, end_time = $4, status = 'pending',
            reason = $5, note = COALESCE($6, note)
      WHERE id = $7 RETURNING id`,
    [cleaner_id, booking_id || null, startsAt, endsAt, reason, (note || '').trim() || null, orphan.id]
  ) :
  await run(
    `INSERT INTO cleaning_jobs (cleaner_id, property_id, booking_id, cleaning_date, start_time, end_time, status, reason, note)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8) RETURNING id`,
    [cleaner_id, property_id, booking_id || null, cleaning_date, startsAt, endsAt, reason, (note || '').trim() || null]
  );

  const job = await getOne('SELECT * FROM cleaning_jobs WHERE id = $1', [result.rows[0].id]);

  // Tell them. Assigning somebody by hand used to be silent — the job
  // appeared in their app only if they happened to look, which is not a
  // way to staff a turnover.
  // Asking somebody who is not free is a different message from telling
  // somebody who is. The job is pending either way and they answer it,
  // but a person who has said they cannot work that day should be asked,
  // not informed — and told plainly that no is an answer.
  const av = await loadAvailability([cleaner_id]);
  const free = cleanerDayStatus(av, Number(cleaner_id), cleaning_date).available;

  // Said the way somebody would say it. "You are going to Hill Top Lodge
  // on 2026-08-12" is a sentence assembled from columns; what a cleaner
  // wants to read is what the job is and which day it falls on.
  const when = prettyDate(job.cleaning_date);
  const what = reason === 'checkin' ?
  `Get ${prop.name} ready for guests` :
  reason === 'other' ?
  `${prop.name} needs you` :
  `Clean ${prop.name}`;

  await notify({
    event: 'job_assigned',
    title: free ?
    `${what} — ${when}` :
    `Can you cover ${prop.name} on ${when}?`,
    body: [
    free ? '' : 'You are marked as not available that day, so this is a request — decline it if you cannot.',
    `${job.start_time}–${job.end_time}.`,
    reason === 'checkin' ? 'Guests arrive that day, so it needs to be ready before they do.' : '',
    (note || '').trim(),
    prop.address || '',
    ].filter(Boolean).join(' '),
    propertyId: property_id, cleanerId: cleaner_id, jobId: job.id,
    link: '/',
  });

  res.status(201).json(job);
});

/**
 * Issue a one-time invitation so a cleaner can set their own PIN.
 *
 * The owner decides who gets access; the cleaner decides how they get in.
 * Previously the owner typed a PIN and read it out, which meant the owner
 * held the cleaner's credential — and since PINs are hashed, a forgotten
 * one could only be overwritten, never recovered.
 *
 * Restricted to admin and property_manager through requireRole, which
 * needs req.user. That matters here: requireAuth also admits cleaner PIN
 * sessions, so without this a logged-in cleaner could invite anybody.
 *
 * Issuing a new invitation voids any earlier unused one for the same
 * cleaner, so a link sent to the wrong number stops working the moment a
 * replacement is sent.
 */
router.post('/:id/invite', requireRole('admin', 'property_manager'), async (req, res) => {
  const full = await getOne('SELECT id, name, phone FROM cleaners WHERE id = $1', [req.params.id]);
  if (!full) return res.status(404).json({ error: 'Cleaner not found' });
  const cleaner = full;

  const token = crypto.randomBytes(32).toString('base64url');

  await transaction(async (client) => {
    await client.query(
      'DELETE FROM cleaner_invites WHERE cleaner_id = $1 AND used_at IS NULL',
      [cleaner.id]
    );
    await client.query(
      `INSERT INTO cleaner_invites (cleaner_id, token, expires_at, created_by)
       VALUES ($1, $2, NOW() + INTERVAL '${INVITE_VALID_DAYS} days', $3)`,
      [cleaner.id, token, req.user.id]
    );
  });

  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

  // WhatsApp is how cleaners are talked to, so the app sends it rather
  // than leaving the owner to copy a link. The outcome is reported
  // instead of swallowed: the assignment code caught send errors, logged
  // them and carried on as though the cleaner had been told, which is
  // why every job in production still reads notified = 0. The link comes
  // back either way, so a failed send costs the owner a paste, not the
  // invitation.
  const delivery = await sendInviteLink({ cleaner: full, token });

  res.status(201).json({
    url: `${base}/invite/${token}`,
    expires_in_days: INVITE_VALID_DAYS,
    cleaner_name: cleaner.name,
    sent: delivery.sent,
    reason: delivery.reason,
  });
});

// Update a cleaner
router.put('/:id', async (req, res) => {
  if (req.body.phone && !/^\+\d{10,15}$/.test(req.body.phone)) {
    return res.status(400).json({ error: 'Phone must be in E.164 format (e.g. +27821234567)' });
  }

  // Handle PIN update
  if (req.body.pin !== undefined && req.body.pin !== '') {
    if (!/^\d{4}$/.test(req.body.pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }
    const bcrypt = require('bcrypt');
    req.body.pin = bcrypt.hashSync(req.body.pin, 10);
  }

  const fields = ['name', 'phone', 'email', 'hourly_rate', 'flat_rate', 'rate_type', 'notes', 'pin'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined && req.body[f] !== '') {
      updates.push(`${f} = $${values.length + 1}`);
      values.push(req.body[f]);
    }
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    await run(`UPDATE cleaners SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  }

  const updated = await getOne('SELECT * FROM cleaners WHERE id = $1', [req.params.id]);
  if (!updated) return res.status(404).json({ error: 'Cleaner not found' });
  res.json(updated);
});

// Delete a cleaner
router.delete('/:id', async (req, res) => {
  const result = await run('DELETE FROM cleaners WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Cleaner not found' });
  res.json({ deleted: true });
});

// Assign a cleaner to a property
router.post('/:id/properties', async (req, res) => {
  const { property_id } = req.body;

  try {
    await run('INSERT INTO cleaner_properties (cleaner_id, property_id) VALUES ($1, $2)', [
      req.params.id,
      property_id
    ]);
    res.json({ assigned: true });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.code === '23505') {
      return res.status(409).json({ error: 'Already assigned' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Remove a cleaner from a property
router.delete('/:id/properties/:propertyId', async (req, res) => {
  await run('DELETE FROM cleaner_properties WHERE cleaner_id = $1 AND property_id = $2', [
    req.params.id,
    req.params.propertyId
  ]);
  res.json({ removed: true });
});

// Set weekly availability for a cleaner (replaces all existing)
router.put('/:id/availability', async (req, res) => {
  const { schedule } = req.body;
  // schedule: [{ day_of_week: 0-6, start_time: "09:00", end_time: "17:00" }, ...]

  if (!Array.isArray(schedule)) {
    return res.status(400).json({ error: 'Schedule must be an array' });
  }

  const cleanerId = req.params.id;

  await transaction(async (client) => {
    await client.query('DELETE FROM cleaner_availability WHERE cleaner_id = $1', [cleanerId]);
    for (const slot of schedule) {
      await client.query(
        'INSERT INTO cleaner_availability (cleaner_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [cleanerId, slot.day_of_week, slot.start_time, slot.end_time]
      );
    }
  });

  const availability = await getAll(
    'SELECT * FROM cleaner_availability WHERE cleaner_id = $1 ORDER BY day_of_week ASC',
    [req.params.id]
  );
  res.json(availability);
});

// Add/update a date-specific override
router.post('/:id/overrides', async (req, res) => {
  const { date, available } = req.body;

  if (!date) return res.status(400).json({ error: 'Date is required' });

  // Upsert override
  const existing = await getOne(
    'SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = $1 AND date = $2',
    [req.params.id, date]
  );

  if (existing) {
    await run('UPDATE cleaner_availability_overrides SET available = $1 WHERE id = $2', [
      available ? 1 : 0,
      existing.id
    ]);
  } else {
    await run(
      'INSERT INTO cleaner_availability_overrides (cleaner_id, date, available) VALUES ($1, $2, $3)',
      [req.params.id, date, available ? 1 : 0]
    );
  }

  res.json({ date, available: !!available });
});

// Delete a date override
router.delete('/:id/overrides/:overrideId', async (req, res) => {
  await run('DELETE FROM cleaner_availability_overrides WHERE id = $1 AND cleaner_id = $2', [
    req.params.overrideId,
    req.params.id
  ]);
  res.json({ deleted: true });
});

// Get cleaning jobs for a cleaner
router.get('/:id/jobs', async (req, res) => {
  const jobs = await getAll(
    `SELECT cj.*, p.name as property_name
     FROM cleaning_jobs cj
     JOIN properties p ON cj.property_id = p.id
     WHERE cj.cleaner_id = $1
     ORDER BY cj.cleaning_date ASC`,
    [req.params.id]
  );
  res.json(jobs);
});

// Update cleaning job status
router.put('/jobs/:jobId/status', async (req, res) => {
  const { status } = req.body;

  if (!['pending', 'confirmed', 'completed', 'ready'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  await run('UPDATE cleaning_jobs SET status = $1 WHERE id = $2', [status, req.params.jobId]);
  const job = await getOne('SELECT * FROM cleaning_jobs WHERE id = $1', [req.params.jobId]);
  res.json(job);
});

module.exports = router;
