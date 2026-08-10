const { getAll, getOne, run } = require('../db/database');
// One definition of "blocked" for the whole app — the revenue and
// analytics paths call the same function.
const { isBlockedPlatform } = require('./analytics-calc');
// One place decides who gets told what — see that module for why four
// bare sendMessage calls left every job reading notified = 0.
const { notify } = require('./notify');
// Who can work when — one definition, shared with the calendar.
const { loadAvailability, cleanerDayStatus, prettyDate } = require('./availability');
// What cleaning a property needs, decided apart from who does it.
const { planCleans, missingFrom } = require('./cleaning-plan');
const { STILL_ON_SQL } = require('./job-life');

// Run cleaner assignment for a specific property and checkout date
// booking: { id, smoobu_id, property_id, check_out, check_in_next, num_guests_next, guest_name_next }
/**
 * Send somebody to a property on a day, whatever the reason.
 *
 * assignCleanerForCheckout used to be the only way a job was created, and
 * it took a booking — so a clean could only ever be attached to a
 * departure. An arrival that needed the property freshened had nowhere to
 * express itself. This takes a date and a reason instead; the booking is
 * a detail, and often there isn't one.
 */
async function assignCleanForDate({ property, date, reason = 'checkout', bookingId = null, nextBooking = null }) {
  return assignInternal(property, date, reason, bookingId, nextBooking);
}

/** The original entry point, kept: a checkout is one kind of clean. */
async function assignCleanerForCheckout(booking, nextBooking = null) {
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [booking.property_id]);
  if (!property) {
    console.error(`Property ${booking.property_id} not found`);
    return null;
  }
  return assignInternal(property, ymd(booking.check_out), 'checkout', booking.smoobu_id, nextBooking);
}

async function assignInternal(property, cleaningDate, reason, bookingId, nextBooking = null) {
  const checkoutDate = cleaningDate;

  // When the cleaner starts depends on why they are going. A turnover
  // begins when the guests are out; a freshen before an arrival has to be
  // finished before the next lot walk in.
  const checkoutTime = reason === 'checkin' ?
  formatTime(Math.max(0, parseTime(property.check_in_time || '15:00') - (Number(property.cleaning_hours_required) || 2.5) * 60)) :
  (property.check_out_time || '10:00');

  // Determine cleaning window end
  let cleaningEndTime;
  if (nextBooking) {
    cleaningEndTime = '15:00'; // Default check-in time
  } else {
    // No next booking: checkout time + 4 hours
    cleaningEndTime = '14:00';
  }

  // Calculate available window in hours
  const windowStart = parseTime(checkoutTime);
  const windowEnd = parseTime(cleaningEndTime);
  const windowHours = (windowEnd - windowStart) / 60;

  if (windowHours < property.cleaning_hours_required) {
    console.log(
      `Cleaning window (${windowHours}h) is less than required (${property.cleaning_hours_required}h) for property ${property.name}`
    );
  }

  // Find eligible cleaners: assigned to this property
  // In the manager's order, not the database's. Whoever they would
  // rather send comes first; everybody sits at 0 until somebody says
  // otherwise, which is the arbitrary order this had before.
  const assignedCleaners = await getAll(
    `SELECT c.* FROM cleaners c
     JOIN cleaner_properties cp ON c.id = cp.cleaner_id
     WHERE cp.property_id = $1
     ORDER BY cp.priority ASC, c.name ASC`,
    [property.id]
  );

  // One definition of who is free, shared with the calendar. This used
  // to be inlined here; the calendar needs the same answer for a hundred
  // days at once, and a second copy is how two screens start disagreeing
  // about which cleaner can come.
  const av = await loadAvailability(assignedCleaners.map((c) => c.id));

  for (const cleaner of assignedCleaners) {
    const status = cleanerDayStatus(av, cleaner.id, checkoutDate, {
      start: windowStart, end: windowEnd,
    });
    if (!status.available) continue;

    // Somebody already committed elsewhere that day cannot take this.
    // This used to read `status != 'completed'`, which counts a job they
    // turned down — so declining one morning's work took them out of
    // every other property for the rest of the day.
    const existingJob = await getOne(
      `SELECT * FROM cleaning_jobs
       WHERE cleaner_id = $1 AND cleaning_date = $2 AND ${STILL_ON_SQL}`,
      [cleaner.id, checkoutDate]
    );

    if (existingJob) {
      continue; // Already booked
    }

    // Check if window >= cleaning_hours_required
    if (windowHours < property.cleaning_hours_required) {
      continue;
    }

    // Calculate actual end time based on cleaning hours required
    const actualEndMinutes = windowStart + property.cleaning_hours_required * 60;
    const actualEndTime = formatTime(actualEndMinutes);

    // Assign this cleaner (link via smoobu_id so delete+reinsert sync doesn't break the link)
    const result = await run(
      // Idempotent on purpose. The guard above should make a collision
      // impossible, and it did not — so the sync must survive one rather
      // than abort with everything after it unprocessed.
      `INSERT INTO cleaning_jobs (property_id, cleaner_id, booking_id, cleaning_date, start_time, end_time, status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        property.id,
        cleaner.id,
        bookingId,
        checkoutDate,
        checkoutTime,
        actualEndTime,
        reason,
      ]
    );

    // Nothing came back means the row was already there. Somebody is
    // cleaning it, which is the outcome we wanted; carry on to the next
    // property rather than crash on an absent row.
    if (!result.rows || result.rows.length === 0) continue;
    const jobId = result.rows[0].id;

    // Through notify(), not a bare send.
    //
    // This call used to be whatsapp.sendMessage in a try/catch that logged
    // and carried on, and it set notified = 1 only when the send threw
    // nothing. Meta returns a message id for text it then silently drops
    // outside the 24-hour window, so notified = 1 never meant delivered.
    // The flag now follows what notify() actually reports.
    const nextGuestInfo = nextBooking ?
    `Next guest arrives ${nextBooking.check_in} at 15:00 (${nextBooking.num_guests || 'unknown'} guests).` :
    'Nobody is checking in that day.';

    const sent = await notify({
      event: 'job_assigned',
      title: reason === 'checkin' ?
      `Get ${property.name} ready for guests — ${prettyDate(checkoutDate)}` :
      `Clean ${property.name} — ${prettyDate(checkoutDate)}`,
      body: `From ${checkoutTime}, about ${property.cleaning_hours_required} hours. ` +
      `${property.address ? property.address + '. ' : ''}${nextGuestInfo}`,
      propertyId: property.id, cleanerId: cleaner.id, jobId,
      link: '/',
    });
    await run('UPDATE cleaning_jobs SET notified = $1 WHERE id = $2',
      [sent.delivery === 'sent' ? 1 : 0, jobId]);

    console.log(
      `Assigned cleaner ${cleaner.name} to ${property.name} on ${checkoutDate}`
    );
    return jobId;
  }

  // Nobody can go. Say so; do not act.
  //
  // This used to take the nights off sale in Smoobu on the manager's
  // behalf, silently, with no message and no way to put them back —
  // unblockDates() has existed since the beginning and nothing recorded
  // what to cancel. It never actually fired in production, which is the
  // only reason it was not a problem: one cleaner covering two properties
  // was almost always free. The first week she took off, revenue would
  // have quietly disappeared.
  //
  // Blocking is a decision about selling nights. That belongs to whoever
  // owns the revenue, not to a cron.
  const freeFrom = await nextDaySomebodyIsFree(property.id, checkoutDate);
  await notify({
    event: 'job_unstaffed',
    title: `Nobody can clean ${property.name} on ${prettyDate(checkoutDate)}`,
    body: freeFrom ?
    `The first day somebody is free is ${prettyDate(freeFrom)}. Block the nights until then, or ask somebody who is not available.` :
    'Nobody assigned to this property is free in the next month. Block the nights, or add a cleaner.',
    propertyId: property.id,
    link: '/calendar',
    // Everything the manager would otherwise retype to block these
    // nights: which property, from when, until somebody can come.
    meta: freeFrom ?
    { action: 'block', property_id: property.id, from: ymd(checkoutDate), to: freeFrom } :
    { action: 'block', property_id: property.id, from: ymd(checkoutDate) },
  });

  console.log(`No cleaner available for ${property.name} on ${checkoutDate}. Manager notified.`);
  return null;
}

/**
 * The next day anybody who cleans this property could actually come.
 *
 * What the manager needs to decide how far to block. Without it the
 * message is a problem with no shape — "nobody is free" leaves them
 * opening the calendar and counting days by hand.
 */
async function nextDaySomebodyIsFree(propertyId, fromDate, withinDays = 30) {
  const cleaners = await getAll(
    `SELECT c.id FROM cleaners c
      JOIN cleaner_properties cp ON c.id = cp.cleaner_id
      WHERE cp.property_id = $1`,
    [propertyId]
  );
  if (cleaners.length === 0) return null;

  const av = await loadAvailability(cleaners.map((c) => c.id));
  // Days they are already working somewhere else are not days they are
  // free, so a "first free day" that names one would send the manager to
  // block the wrong nights.
  const busy = await getAll(
    `SELECT cleaner_id, cleaning_date FROM cleaning_jobs
      WHERE cleaner_id = ANY($1) AND status NOT IN ('declined','cancelled')`,
    [cleaners.map((c) => c.id)]
  );
  const taken = new Set(busy.map((b) => `${b.cleaner_id}|${ymd(b.cleaning_date)}`));

  const start = new Date(`${ymd(fromDate)}T00:00:00`);
  for (let i = 1; i <= withinDays; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = ymd(d);
    if (cleaners.some((c) =>
    cleanerDayStatus(av, c.id, key).available && !taken.has(`${c.id}|${key}`))) return key;
  }
  return null;
}

/**
 * A date as YYYY-MM-DD, whatever the driver handed back.
 *
 * node-pg returns DATE columns as JS Date objects, so comparing a job's
 * cleaning_date to a booking's check_out with === compares two object
 * references and is always false. That would have made every job look
 * mis-dated and moved the lot.
 */
function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Bring existing cleaning jobs back in line with their bookings.
 *
 * Assignment only ever created. The query it runs treats "this booking
 * already has a job" as "nothing to do", so once a job existed it was
 * never looked at again — and a booking that moved left its clean behind
 * on the old date forever. Production had a stay running 22 Apr to 31 Jul
 * whose clean sat on 30 June, a date nothing checked out on. The webhook
 * path handles this by deleting and re-creating the job, but a change
 * that arrives by sync instead — a missed webhook, the app restarting,
 * webhooks never configured — never reached that code.
 *
 * Three things can be wrong with a job, and all three are the same
 * question: does the booking still justify a clean on that date?
 *
 *   - the booking moved      -> move the job with it
 *   - the booking is gone or cancelled -> the clean is not happening
 *   - the booking is a block -> nobody slept there, so nobody cleans
 *
 * Two rules bound it. Work that has been started or finished is never
 * touched: those timestamps are the record of what somebody actually did,
 * and no reconciliation is worth rewriting them. And only today onwards
 * is considered — a job in the past is history, right or wrong, and
 * quietly editing last month's schedule helps nobody.
 */
async function reconcileCleaningJobs() {
  const today = new Date().toISOString().split('T')[0];

  const rows = await getAll(
    `SELECT cj.id, cj.cleaning_date, cj.booking_id, cj.cleaner_id, cj.property_id,
            p.name AS property_name,
            b.smoobu_id, b.check_out, b.platform, b.status AS booking_status
       FROM cleaning_jobs cj
       LEFT JOIN bookings b ON b.smoobu_id = cj.booking_id
       LEFT JOIN properties p ON p.id = cj.property_id
      WHERE cj.started_at IS NULL
        AND cj.completed_at IS NULL
        -- A job with nobody on it is worth looking at whether or not it
        -- came from a booking: a deleted cleaner leaves those behind with
        -- no booking at all, and they were invisible here.
        AND (cj.booking_id IS NOT NULL OR cj.cleaner_id IS NULL)
        AND (cj.cleaning_date >= $1 OR b.check_out >= $1)`,
    [today]
  );

  const moved = [];
  const removed = [];

  for (const row of rows) {
    // A row with nobody on it is not scheduled work — nobody is going —
    // but it reads as scheduled everywhere. Clearing it lets the planner
    // ask for the clean again and find somebody.
    if (!row.cleaner_id) {
      const gone = await getAll(
        `DELETE FROM cleaning_jobs
          WHERE id = $1 AND cleaner_id IS NULL
            AND started_at IS NULL AND completed_at IS NULL
          RETURNING id`,
        [row.id]
      );
      if (gone.length) removed.push({ id: row.id, why: 'nobody on it' });
      continue;
    }

    // A visit with no booking behind it is somebody being sent
    // deliberately — a deep clean, a preparation. Nothing about a booking
    // can condemn it.
    if (!row.booking_id) continue;

    const orphaned = !row.smoobu_id;
    const cancelled = !orphaned && row.booking_status !== 'confirmed';
    const blocked = !orphaned && isBlockedPlatform(row.platform);

    if (orphaned || cancelled || blocked) {
      // Guarded again rather than trusting the row we read: a cleaner may
      // have tapped "Start cleaning" between the select and here, and a
      // clean in progress is not ours to delete.
      const gone = await getAll(
        `DELETE FROM cleaning_jobs
          WHERE id = $1 AND started_at IS NULL AND completed_at IS NULL
          RETURNING id`,
        [row.id]
      );
      if (gone.length) {
        const why = orphaned ? 'booking gone' : cancelled ? 'cancelled' : 'blocked';
        removed.push({ id: row.id, why });
        await notify({
          event: 'job_cancelled',
          title: `${row.property_name || 'A property'} on ${prettyDate(row.cleaning_date)} is off`,
          body: why === 'blocked' ?
          'Those nights were taken off sale, so there is no turnover to clean.' :
          'That booking is no longer going ahead.',
          propertyId: row.property_id, cleanerId: row.cleaner_id, jobId: row.id,
          link: '/',
        });
      }
      continue;
    }

    const was = ymd(row.cleaning_date);
    const should = ymd(row.check_out);
    if (was !== should) {
      /**
       * Moving a clean onto a day that cleaner already has.
       *
       * A booking moves, its clean follows, and the new date can be one
       * the same cleaner is already booked for at the same property.
       * There is a unique index on (property, date, cleaner) for live
       * jobs, so the database refused the move — and the exception went
       * all the way out through runAssignmentForAllCheckouts and killed
       * the whole Smoobu sync. Every sync in production was dying on it,
       * and because the timestamp never moved either, nothing said so.
       *
       * The duplicate is the point: the other job is already the clean
       * this booking needs. So drop the one that would have moved, and
       * leave the one already sitting on the right day.
       */
      const clash = await getOne(
        `SELECT id FROM cleaning_jobs
          WHERE property_id = $1 AND cleaning_date = $2 AND cleaner_id = $3
            AND id != $4 AND status IN ('pending', 'confirmed')`,
        [row.property_id, should, row.cleaner_id, row.id]
      );
      if (clash) {
        await run(
          `DELETE FROM cleaning_jobs
            WHERE id = $1 AND started_at IS NULL AND completed_at IS NULL`,
          [row.id]
        );
        continue;
      }

      const changed = await getAll(
        `UPDATE cleaning_jobs SET cleaning_date = $1
          WHERE id = $2 AND started_at IS NULL AND completed_at IS NULL
          RETURNING id`,
        [should, row.id]
      );
      if (changed.length) {
        moved.push({ id: row.id, from: was, to: should });
        // The whole point of moving it. Before this the date changed
        // underneath the cleaner and nothing said a word, so they would
        // have turned up on the old day — or not at all on the new one.
        await notify({
          event: 'job_rescheduled',
          title: `${row.property_name || 'A property'} has moved to ${prettyDate(should)}`,
          body: `It was ${prettyDate(was)}. The booking changed, so your clean moved with it.`,
          propertyId: row.property_id, cleanerId: row.cleaner_id, jobId: row.id,
          link: '/',
        });
      }
    }
  }

  if (moved.length || removed.length) {
    console.log(
      `Cleaning jobs reconciled: ${moved.length} moved, ${removed.length} removed` +
      (moved.length ? ` (${moved.map((m) => `#${m.id} ${m.from}->${m.to}`).join(', ')})` : '')
    );
  }

  return { moved, removed };
}

// Run assignment for all upcoming checkouts
/**
 * Bring every property's cleaning in line with what it needs.
 *
 * This used to walk checkouts: any confirmed booking leaving in the next
 * month without a job got one. That is half the question. It never asked
 * whether a property would be clean when guests *arrived* — so a flat
 * standing empty for three weeks got a guest and no cleaner, and one
 * turned over yesterday could earn a second clean it did not need.
 *
 * The plan says what should exist; this makes it so. A property nobody
 * can clean is reported, not quietly taken off sale.
 */
async function runAssignmentForAllCheckouts() {
  const today = new Date().toISOString().split('T')[0];
  const horizon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  // Wider on the near side, because "was it cleaned recently" is a
  // question about the past.
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Existing jobs first: a booking that moved takes its clean with it,
  // and a plan drawn over stale jobs would ask for duplicates.
  await reconcileCleaningJobs();

  const properties = await getAll('SELECT * FROM properties');

  for (const property of properties) {
    const stays = await getAll(
      `SELECT * FROM bookings
        WHERE property_id = $1 AND check_out >= $2 AND check_in <= $3`,
      [property.id, since, horizon]
    );
    const jobs = await getAll(
      `SELECT * FROM cleaning_jobs
        WHERE property_id = $1 AND cleaning_date >= $2 AND cleaning_date <= $3`,
      [property.id, since, horizon]
    );

    const planned = planCleans({ property, stays, jobs, from: today, to: horizon });

    for (const need of missingFrom(planned, jobs)) {
      // Who arrives next decides how long the cleaner has. Blocks are not
      // guests: counting one told a cleaner somebody was arriving when the
      // property was simply off sale.
      const nextBooking = stays.
      filter((b) => b.status === 'confirmed' && !isBlockedPlatform(b.platform)).
      filter((b) => ymd(b.check_in) >= need.date).
      sort((a, b) => ymd(a.check_in).localeCompare(ymd(b.check_in)))[0] || null;

      await assignCleanForDate({
        property, date: need.date, reason: need.reason,
        bookingId: need.booking_id, nextBooking,
      });
    }
  }
}


// Unassign a cleaner from a job and notify them
// smoobuId: the Smoobu booking ID (cleaning_jobs.booking_id stores smoobu_id)
async function unassignCleanerFromBooking(smoobuId) {
  const jobs = await getAll(
    `SELECT cj.*, c.phone, c.name as cleaner_name, p.name as property_name
     FROM cleaning_jobs cj
     JOIN cleaners c ON cj.cleaner_id = c.id
     JOIN properties p ON cj.property_id = p.id
     WHERE cj.booking_id = $1 AND cj.${STILL_ON_SQL}`,
    [smoobuId]
  );

  for (const job of jobs) {
    await run('DELETE FROM cleaning_jobs WHERE id = $1', [job.id]);

    await notify({
      event: 'job_cancelled',
      title: `${job.property_name} on ${prettyDate(job.cleaning_date)} is off`,
      body: 'That booking was cancelled, so the clean is no longer needed.',
      propertyId: job.property_id, cleanerId: job.cleaner_id, jobId: job.id,
      link: '/',
    });
  }
}

// Re-run assignment for a modified booking
// smoobuId: the Smoobu booking ID
async function reassignCleanerForBooking(smoobuId) {
  await unassignCleanerFromBooking(smoobuId);

  const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);
  if (!booking) return;

  const nextBooking = await getOne(
    `SELECT * FROM bookings
     WHERE property_id = $1 AND check_in >= $2 AND status = 'confirmed' AND smoobu_id != $3
     ORDER BY check_in ASC LIMIT 1`,
    [booking.property_id, booking.check_out, smoobuId]
  );

  await assignCleanerForCheckout(booking, nextBooking);
}

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = {
  reconcileCleaningJobs,
  assignCleanForDate,
  assignCleanerForCheckout,
  runAssignmentForAllCheckouts,
  unassignCleanerFromBooking,
  reassignCleanerForBooking,
};
