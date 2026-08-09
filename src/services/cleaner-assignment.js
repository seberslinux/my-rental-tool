const { getAll, getOne, run } = require('../db/database');
const smoobu = require('./smoobu');
const { getApiKeyForProperty } = require('./api-key-resolver');
// One definition of "blocked" for the whole app — the revenue and
// analytics paths call the same function.
const { isBlockedPlatform } = require('./analytics-calc');
// One place decides who gets told what — see that module for why four
// bare sendMessage calls left every job reading notified = 0.
const { notify } = require('./notify');
// Who can work when — one definition, shared with the calendar.
const { loadAvailability, cleanerDayStatus } = require('./availability');

// Run cleaner assignment for a specific property and checkout date
// booking: { id, smoobu_id, property_id, check_out, check_in_next, num_guests_next, guest_name_next }
async function assignCleanerForCheckout(booking, nextBooking = null) {
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [booking.property_id]);
  if (!property) {
    console.error(`Property ${booking.property_id} not found`);
    return null;
  }

  const checkoutDate = booking.check_out; // YYYY-MM-DD
  const checkoutTime = '10:00'; // Default checkout time

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
  const assignedCleaners = await getAll(
    `SELECT c.* FROM cleaners c
     JOIN cleaner_properties cp ON c.id = cp.cleaner_id
     WHERE cp.property_id = $1`,
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

    // Check if cleaner already has a job at the same time
    const existingJob = await getOne(
      `SELECT * FROM cleaning_jobs
       WHERE cleaner_id = $1 AND cleaning_date = $2 AND status != 'completed'`,
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
      `INSERT INTO cleaning_jobs (property_id, cleaner_id, booking_id, cleaning_date, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
      [
        property.id,
        cleaner.id,
        booking.smoobu_id,
        checkoutDate,
        checkoutTime,
        actualEndTime,
      ]
    );

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
      title: `You are cleaning ${property.name} on ${checkoutDate}`,
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

  // No cleaner available — block dates in Smoobu
  console.log(
    `No cleaner available for ${property.name} on ${checkoutDate}. Blocking dates.`
  );

  try {
    const blockEnd = nextBooking ? nextBooking.check_in : checkoutDate;
    const apiKey = await getApiKeyForProperty(property.id);
    await smoobu.blockDates(
      property.smoobu_id,
      checkoutDate,
      blockEnd,
      'No cleaner available',
      apiKey
    );

    await run(
      'INSERT INTO blocked_dates (property_id, date, reason) VALUES ($1, $2, $3)',
      [property.id, checkoutDate, 'No cleaner available']
    );
  } catch (err) {
    console.error(`Failed to block dates in Smoobu:`, err.message);
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
        AND cj.booking_id IS NOT NULL
        AND (cj.cleaning_date >= $1 OR b.check_out >= $1)`,
    [today]
  );

  const moved = [];
  const removed = [];

  for (const row of rows) {
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
          title: `${row.property_name || 'A property'} on ${ymd(row.cleaning_date)} is off`,
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
          title: `${row.property_name || 'A property'} has moved to ${should}`,
          body: `It was ${was}. The booking changed, so your clean moved with it.`,
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
async function runAssignmentForAllCheckouts() {
  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Existing jobs are brought back in line first, because the query below
  // treats "this booking already has a job" as "nothing to do" — see
  // reconcileCleaningJobs for why that is not the same thing.
  await reconcileCleaningJobs();

  // Get all bookings with upcoming checkouts that don't have a cleaning job yet
  const rows = await getAll(
    `SELECT b.* FROM bookings b
     WHERE b.check_out >= $1 AND b.check_out <= $2 AND b.status = 'confirmed'
     AND NOT EXISTS (
       SELECT 1 FROM cleaning_jobs cj WHERE cj.booking_id = b.smoobu_id
     )
     ORDER BY b.check_out ASC`,
    [today, futureDate]
  );

  // Blocks are not stays, so their end is not a check-out.
  //
  // Smoobu writes "Blocked channel auto" rows for nights taken off sale —
  // maintenance, renovation, or its own turnaround padding — and those were
  // being scheduled like departures. Five of fourteen jobs in production
  // were cleans for nights nobody slept in. Worse, they double up: a guest
  // leaves on the 10th and Smoobu blocks the 10th to the 11th, so the
  // property earns a correct job on the 10th and a phantom one on the 11th,
  // and the cleaner is sent twice for one turnover.
  //
  // Filtered in JS through isBlockedPlatform rather than with a LIKE in the
  // SQL, so this shares the single definition of what "blocked" means with
  // the revenue and analytics paths instead of growing a second one.
  const bookings = rows.filter((b) => !isBlockedPlatform(b.platform));

  for (const booking of bookings) {
    // The next arrival at the same property — what decides how much time
    // the cleaner has. Blocks are skipped here too: a blocked night is not
    // a guest, and counting one told the cleaner someone was arriving when
    // the property was simply off sale.
    const following = await getAll(
      `SELECT * FROM bookings
       WHERE property_id = $1 AND check_in >= $2 AND status = 'confirmed'
       ORDER BY check_in ASC LIMIT 5`,
      [booking.property_id, booking.check_out]
    );
    const nextBooking = following.find((b) => !isBlockedPlatform(b.platform)) || null;

    await assignCleanerForCheckout(booking, nextBooking);
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
     WHERE cj.booking_id = $1 AND cj.status != 'completed'`,
    [smoobuId]
  );

  for (const job of jobs) {
    await run('DELETE FROM cleaning_jobs WHERE id = $1', [job.id]);

    await notify({
      event: 'job_cancelled',
      title: `${job.property_name} on ${ymd(job.cleaning_date)} is off`,
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
  assignCleanerForCheckout,
  runAssignmentForAllCheckouts,
  unassignCleanerFromBooking,
  reassignCleanerForBooking,
};
