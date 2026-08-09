const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getAll, getOne, run, transaction, inParams } = require('../db/database');
// When a clean may be started and finished — see that module for why the
// window opens before check-out and why "today" is the property's today.
const { checkCleaningWindow } = require('../services/cleaning-window');
// One place decides who hears about what — see the module header for why
// four separate send calls is how the old ones drifted apart.
const { notify, recentForCleaner } = require('../services/notify');

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
             LEFT JOIN bookings b ON cj.booking_id = b.smoobu_id
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

  // The property's standing list, plus anything asked for this stay
  // alone. One list to the cleaner: they do not care which table a line
  // came from, only what to count.
  const items = await getAll(
    `SELECT * FROM inventory_checklists
      WHERE property_id = $1 AND (booking_id IS NULL OR booking_id = $2)
      ORDER BY booking_id NULLS FIRST, category, sort_order, item_name`,
    [job.property_id, job.booking_id]
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

/**
 * What a job's status may be.
 *
 * Defined here rather than inline because both this route and the finish
 * path reason about it. It was lost when the dead /ready route was cut
 * out — it happened to sit between that route and the next one — and
 * three tests said so immediately.
 */
const JOB_STATUSES = ['pending', 'confirmed', 'declined', 'in_progress', 'completed', 'ready'];

/**
 * Finishing is the only way a clean ends.
 *
 * There used to be a second one: POST /jobs/:jobId/ready, which checked
 * the inventory had been counted and set status = 'ready'. Nothing in the
 * app ever called it, nothing ever read the status it wrote, and two
 * endpoints for "this property is done" is one too many. Its one good
 * idea — refusing while the count is outstanding — now lives in /finish,
 * where it actually runs.
 */

router.put('/jobs/:jobId/status', requireCleaner, async (req, res) => {
  const { status } = req.body;
  if (!JOB_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const job = await getOne('SELECT * FROM cleaning_jobs WHERE id = $1 AND cleaner_id = $2', [req.params.jobId, req.cleaner.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  await run('UPDATE cleaning_jobs SET status = $1 WHERE id = $2', [status, job.id]);

  if (status === 'declined' || status === 'confirmed') {
    const property = await getOne('SELECT name FROM properties WHERE id = $1', [job.property_id]);
    const where = property ? property.name : 'a property';
    await notify({
      event: status === 'declined' ? 'job_declined' : 'job_accepted',
      title: status === 'declined' ?
      `${req.cleaner.name} cannot clean ${where} on ${job.cleaning_date}` :
      `${req.cleaner.name} accepted ${where} on ${job.cleaning_date}`,
      body: status === 'declined' ? 'Somebody else will need to cover it.' : '',
      propertyId: job.property_id, cleanerId: req.cleaner.id, jobId: job.id,
      link: '/cleaners',
    });
  }

  res.json({ updated: true });
});

/**
 * Check in: the cleaner is at the property and starting.
 *
 * The time is taken from the server, not the request. A phone with a
 * wrong clock — or a cleaner filling in yesterday's jobs from the sofa —
 * would otherwise decide when the property was turned over, which is the
 * fact the next check-in depends on.
 *
 * Repeating it does not move the start time. Someone tapping twice on a
 * slow connection should not lose the minutes they have worked.
 */
router.post('/jobs/:jobId/start', requireCleaner, async (req, res) => {
  const job = await getOne(
    'SELECT * FROM cleaning_jobs WHERE id = $1 AND cleaner_id = $2',
    [req.params.jobId, req.cleaner.id]
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.started_at) {
    return res.json({ started_at: job.started_at, already: true });
  }

  // Only on the day, and not while the guest is still in the room. The
  // check is after the already-started branch on purpose: a job begun
  // legitimately must stay reportable even if the window has since shut.
  const property = await getOne('SELECT name, check_out_time FROM properties WHERE id = $1', [job.property_id]);
  const window = checkCleaningWindow(job, property);
  if (!window.ok) return res.status(409).json({ error: window.reason });
  const updated = await getOne(
    `UPDATE cleaning_jobs SET started_at = NOW(), status = 'in_progress'
      WHERE id = $1 AND started_at IS NULL
      RETURNING started_at`,
    [job.id]
  );
  await notify({
    event: 'cleaning_started',
    title: `${req.cleaner.name} started cleaning ${property ? property.name : ''}`.trim(),
    body: `Scheduled ${job.start_time}–${job.end_time}.`,
    propertyId: job.property_id, cleanerId: req.cleaner.id, jobId: job.id,
    link: '/activity',
  });

  res.json({ started_at: updated ? updated.started_at : job.started_at });
});

/**
 * Check out: the clean is finished.
 *
 * Finishing without having started is allowed and back-fills the start
 * from the scheduled time — a cleaner who forgot to tap on arrival should
 * still be able to record that the property is done, and losing the
 * finish time to enforce an order would help nobody.
 */
router.post('/jobs/:jobId/finish', requireCleaner, async (req, res) => {
  const job = await getOne(
    'SELECT * FROM cleaning_jobs WHERE id = $1 AND cleaner_id = $2',
    [req.params.jobId, req.cleaner.id]
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.completed_at) {
    return res.json({ completed_at: job.completed_at, already: true });
  }

  // A clean already under way can always be closed. The window governs
  // when work may begin; once it legitimately has, a cleaner running past
  // midnight must not lose their finish to a rule about start times.
  if (!job.started_at) {
    const property = await getOne('SELECT check_out_time FROM properties WHERE id = $1', [job.property_id]);
    const window = checkCleaningWindow(job, property);
    if (!window.ok) return res.status(409).json({ error: window.reason });
  }

  // The count comes before the sign-off.
  //
  // A checklist filled in after the fact is a guess, and one never filled
  // in at all is how towels walk out for months unnoticed. If the property
  // has a list, it has to be answered before the job can close — which is
  // also the only thing that makes the list worth a manager's time.
  const expected = await getAll(
    `SELECT id FROM inventory_checklists
      WHERE property_id = $1 AND (booking_id IS NULL OR booking_id = $2)`,
    [job.property_id, job.booking_id]
  );
  if (expected.length > 0) {
    const done = await getAll(
      'SELECT checklist_item_id FROM inventory_checks WHERE cleaning_job_id = $1', [job.id]
    );
    const counted = new Set(done.map((c) => c.checklist_item_id));
    const outstanding = expected.filter((i) => !counted.has(i.id)).length;
    if (outstanding > 0) {
      return res.status(409).json({
        error: `Count the ${outstanding} item${outstanding === 1 ? '' : 's'} on the checklist first`,
        checklist_outstanding: outstanding,
      });
    }
  }

  const updated = await getOne(
    `UPDATE cleaning_jobs
        SET completed_at = NOW(),
            started_at = COALESCE(started_at, (cleaning_date || ' ' || start_time)::timestamptz),
            status = 'completed'
      WHERE id = $1 AND completed_at IS NULL
      RETURNING started_at, completed_at`,
    [job.id]
  );
  const finishedAt = updated ? updated.completed_at : job.completed_at;
  const propertyRow = await getOne('SELECT name FROM properties WHERE id = $1', [job.property_id]);
  await notify({
    event: 'cleaning_finished',
    title: `${req.cleaner.name} finished ${propertyRow ? propertyRow.name : ''}`.trim(),
    body: 'The property is ready.',
    propertyId: job.property_id, cleanerId: req.cleaner.id, jobId: job.id,
    link: '/activity',
  });

  res.json(updated || { completed_at: finishedAt });
});

/**
 * Who is staying at the cleaner's properties, and when.
 *
 * A clean is scheduled against a check-out, but the calendar has to show
 * the stays themselves — a cleaner walking in wants to know the place is
 * occupied until Thursday, how many people are in it, and anything they
 * have been told about it.
 *
 * Every money column is left out. Not filtered in the client: the
 * cleaner has no business receiving what the guest paid, and a field not
 * selected cannot leak through a future change to the front end.
 * Cancellations and blocks are dropped too — neither is somebody
 * staying.
 */
router.get('/bookings', requireCleaner, async (req, res) => {
  const propRows = await getAll(
    'SELECT property_id FROM cleaner_properties WHERE cleaner_id = $1',
    [req.cleaner.id]
  );
  const propIds = propRows.map((r) => r.property_id);
  if (propIds.length === 0) return res.json([]);

  const params = [...propIds];
  const ph = inParams(propIds, 1);
  let sql = `SELECT b.id, b.property_id, p.name AS property_name,
                    b.guest_name, b.platform, b.check_in, b.check_out,
                    b.num_guests, b.children, b.special_requirements
               FROM bookings b
               JOIN properties p ON p.id = b.property_id
              WHERE b.property_id IN (${ph})
                AND b.status = 'confirmed'
                AND LOWER(COALESCE(b.platform, '')) NOT LIKE 'blocked%'`;

  if (req.query.from) { params.push(req.query.from); sql += ` AND b.check_out >= $${params.length}`; }
  if (req.query.to) { params.push(req.query.to); sql += ` AND b.check_in <= $${params.length}`; }
  sql += ' ORDER BY b.check_in ASC';

  res.json(await getAll(sql, params));
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

/**
 * Change one day of your own schedule.
 *
 * The weekly pattern is the standing answer — every Sunday, say — and an
 * override is the exception to it on one date. Both are statements of
 * when this person can work, nothing more: whether a cleaner is actually
 * wanted that day is the manager's call, and it is made by assigning a
 * job, which the cleaner then accepts or declines.
 *
 * So nothing here waits for approval. Saying you are free on Tuesday
 * does not put you to work on Tuesday.
 */
router.post('/overrides', requireCleaner, async (req, res) => {
  const { date, available } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  const existing = await getOne(
    'SELECT id FROM cleaner_availability_overrides WHERE cleaner_id = $1 AND date = $2',
    [req.cleaner.id, date]
  );
  if (existing) {
    await run('UPDATE cleaner_availability_overrides SET available = $1 WHERE id = $2',
      [available ? 1 : 0, existing.id]);
  } else {
    await run('INSERT INTO cleaner_availability_overrides (cleaner_id, date, available) VALUES ($1, $2, $3)',
      [req.cleaner.id, date, available ? 1 : 0]);
  }

  // The manager is told, because a day going dark is what stops them
  // assigning somebody who cannot come. It is information, not a request.
  await notify({
    event: 'availability_changed',
    title: available ?
    `${req.cleaner.name} is now available on ${date}` :
    `${req.cleaner.name} is not available on ${date}`,
    cleanerId: req.cleaner.id,
    link: '/cleaners',
  });

  res.json({ date, available: !!available });
});

/**
 * The cleaner's own feed.
 *
 * Everything they have been told, whether or not the message reached
 * their phone. That second half is the point: WhatsApp accepts text it
 * then drops outside a 24-hour window, so "we sent it" has never meant
 * "they saw it". A cleaner who opens the app can now see the shift they
 * were never told about.
 */
router.get('/notifications', requireCleaner, async (req, res) => {
  res.json(await recentForCleaner(req.cleaner.id));
});

/**
 * Clear one message.
 *
 * A feed that only ever grows is a feed people stop opening. These are
 * the cleaner's own messages about their own shifts, and once a shift has
 * been read there is nothing to preserve — the job itself is the record,
 * and it lives in cleaning_jobs whatever happens here.
 *
 * Scoped to their own rows by both id and audience, so this cannot reach
 * the owner's feed.
 */
router.delete('/notifications/:id', requireCleaner, async (req, res) => {
  await run(
    `DELETE FROM notifications
      WHERE id = $1 AND cleaner_id = $2 AND audience = 'cleaner'`,
    [req.params.id, req.cleaner.id]
  );
  res.json({ ok: true });
});

router.post('/notifications/read-all', requireCleaner, async (req, res) => {
  await run(
    `UPDATE notifications SET read_at = NOW()
      WHERE cleaner_id = $1 AND audience = 'cleaner' AND read_at IS NULL`,
    [req.cleaner.id]
  );
  res.json({ ok: true });
});

router.delete('/overrides/:id', requireCleaner, async (req, res) => {
  await run('DELETE FROM cleaner_availability_overrides WHERE id = $1 AND cleaner_id = $2', [req.params.id, req.cleaner.id]);
  res.json({ deleted: true });
});

/**
 * Put the calendar back to the weekly pattern.
 *
 * Changing "I work Sundays" on the schedule does nothing to a date the
 * cleaner has already overridden — the override is more specific and wins.
 * So a schedule edit silently fails to take on exactly the days somebody
 * has touched, which is the confusing half of having two screens.
 *
 * This is the way out, and it is narrow on purpose. Two things are never
 * cleared:
 *
 * - Anything in the past. Those dates are the record of what happened;
 *   a tidy-up button must not rewrite them.
 * - Any date with a live job. Reverting an "I can come on Tuesday" that
 *   somebody has since scheduled a clean against would quietly withdraw a
 *   day the owner is relying on. Those stay, and are reported back so the
 *   cleaner can see what was left alone and deal with each properly by
 *   declining.
 */
router.post('/overrides/reset', requireCleaner, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const kept = await getAll(
    `SELECT o.date FROM cleaner_availability_overrides o
      WHERE o.cleaner_id = $1 AND o.date >= $2
        AND EXISTS (SELECT 1 FROM cleaning_jobs j
                     WHERE j.cleaner_id = o.cleaner_id
                       AND j.cleaning_date = o.date
                       AND j.status NOT IN ('declined', 'cancelled'))
      ORDER BY o.date`,
    [req.cleaner.id, today]
  );

  const cleared = await getAll(
    `DELETE FROM cleaner_availability_overrides o
      WHERE o.cleaner_id = $1 AND o.date >= $2
        AND NOT EXISTS (SELECT 1 FROM cleaning_jobs j
                         WHERE j.cleaner_id = o.cleaner_id
                           AND j.cleaning_date = o.date
                           AND j.status NOT IN ('declined', 'cancelled'))
      RETURNING date`,
    [req.cleaner.id, today]
  );

  // One line, not one per day. A cleaner tidying up their calendar in the
  // morning should not fill the owner's feed with twenty rows.
  if (cleared.length) {
    await notify({
      event: 'availability_changed',
      title: `${req.cleaner.name} put ${cleared.length} day${cleared.length === 1 ? '' : 's'} back to their usual schedule`,
      cleanerId: req.cleaner.id,
      link: '/cleaners',
    });
  }

  res.json({ cleared: cleared.length, kept: kept.map((r) => r.date) });
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
  const property = await getOne('SELECT name FROM properties WHERE id = $1', [property_id]);
  await notify({
    event: 'issue_reported',
    title: `${req.cleaner.name} reported: ${title}`,
    body: [property && property.name, description].filter(Boolean).join(' · '),
    propertyId: property_id, cleanerId: req.cleaner.id,
    link: '/more',
  });

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
  const short = items.filter((i) => (i.status && i.status !== 'ok'));
  const property = await getOne('SELECT p.name FROM properties p JOIN cleaning_jobs c ON c.property_id = p.id WHERE c.id = $1', [cleaning_job_id]);
  await notify({
    event: 'checklist_saved',
    title: `${req.cleaner.name} completed the checklist at ${property ? property.name : ''}`.trim(),
    // A count, not a list: the message has to hold its shape whether one
    // thing is missing or twenty, and the detail is one tap away.
    body: short.length ? `${short.length} item(s) marked missing.` : 'Everything present.',
    cleanerId: req.cleaner.id, jobId: cleaning_job_id,
    link: '/cleaners',
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
    // Both joins are outer. An inner join on users silently dropped every
    // row a cleaner added, since added_by is null for them — the request
    // would have been saved and then never shown to anybody.
    `SELECT s.*, p.name as property_name,
            COALESCE(u.name, c.name) as added_by_name
     FROM shopping_list s
     LEFT JOIN properties p ON s.property_id = p.id
     LEFT JOIN users u ON s.added_by = u.id
     LEFT JOIN cleaners c ON s.added_by_cleaner_id = c.id
     ORDER BY s.status ASC, s.created_at DESC`
  );
  res.json(items);
});

/**
 * Ask for something the property has run out of.
 *
 * This used to refuse a PIN cleaner outright — "Shopping list not
 * available for PIN-auth cleaners" — because added_by is a foreign key
 * to users and they have no user row. The person who runs out of bin
 * liners is precisely the person standing in the kitchen, so the request
 * is now recorded against whichever of the two the requester is.
 */
router.post('/shopping-list', async (req, res) => {
  const cleaner = await getMyCleanerRecord(req);
  if (!req.user && !cleaner) return res.status(403).json({ error: 'Not signed in' });

  const { property_id, item_name, quantity, unit, notes } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name required' });

  // A cleaner may only ask for a property they actually work at.
  if (!req.user && property_id) {
    const access = await getOne(
      'SELECT 1 FROM cleaner_properties WHERE cleaner_id = $1 AND property_id = $2',
      [cleaner.id, property_id]
    );
    if (!access) return res.status(403).json({ error: 'No access to this property' });
  }

  const result = await run(
    `INSERT INTO shopping_list (property_id, item_name, quantity, unit, added_by, added_by_cleaner_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      property_id || null, item_name, quantity || 1, unit || '',
      req.user ? req.user.id : null,
      req.user ? null : cleaner.id,
      notes || '',
    ]
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
