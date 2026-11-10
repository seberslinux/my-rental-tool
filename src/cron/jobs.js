const cron = require('node-cron');
const { runAssignmentForAllCheckouts } = require('../services/cleaner-assignment');
const { getAll, getOne, run } = require('../db/database');
const { notify } = require('../services/notify');
// Whether the listings are still priced and still on sale — see that
// module for why this runs before anybody is awake.
const { runHealthCheck } = require('../services/health-check');
// Dates as somebody would say them, and one definition of YYYY-MM-DD.
const { prettyDate, ymd } = require('../services/availability');
const { STILL_TO_DO_SQL } = require('../services/job-life');

// The pricing engine does not run.
//
// It prices from `properties.base_price`, which is not a nightly rate:
// it is Smoobu's minimum-price floor. The loft's is R80 while the flat
// actually sells for around R3,300 a night. So the engine has been
// computing R80 — R68 inside five days — for every night of the next
// month, every morning, since the first commit.
//
// None of it ever landed. Smoobu rejected every write with 422 because
// the request body had the wrong shape, and that accident is the only
// reason the listings were not repriced into the ground. Fixing the body
// without fixing the number would have armed it.
//
// It stays off until a price is something the owner can see and set, and
// until turning it on is a decision somebody makes per property rather
// than a schedule that was always there. runPricingEngine and
// POST /api/pricing/run are untouched, so it can still be run
// deliberately against a property whose numbers have been checked.

// The app sends guests nothing on a schedule.
//
// There were two: a checkout reminder at 07:00 and check-in
// instructions at 10:00, both through Smoobu. Neither ever reached a
// guest. They posted to /reservations/{id}/messages, which is the path
// for reading a conversation, and failed quietly every morning — none
// of the last five finished stays, on Airbnb or Booking.com, has either
// message in it. Smoobu's own templates are what guests have been
// getting, and Smoobu stays the one sender.
//
// They were not fixed rather than removed because fixing them would
// have started sending built-in text alongside those templates — and the
// checkout one did not skip blocked periods, so it would have told the
// owner's own blocks that checkout was at ten.
//
// sendCheckinMessages and sendCheckoutMessages are still in
// services/messaging, tested, and unscheduled. The time to bring
// messages from this app back is when WhatsApp delivers and guests'
// phone numbers are on file — a different channel, not these.

// Daily at 5:00 AM SAST = 3:00 AM UTC — run cleaner assignment
cron.schedule('0 3 * * *', async () => {
  console.log('Running cleaner assignment...');
  try {
    await runAssignmentForAllCheckouts();
  } catch (err) {
    console.error('Cleaner assignment cron error:', err.message);
  }
});

// Every 15 minutes — remind a cleaner an hour before they are due.
//
// Was two hours on a 30-minute tick, which is a wide aim: a job at 10:00
// could be reminded at 08:00 or at 08:30. An hour is the useful warning —
// long enough to travel, close enough to act on — and a 15-minute tick
// keeps the message within a quarter of an hour of the intended time.
//
// reminder_sent is the guard against the tick sending it four times.
cron.schedule('*/15 * * * *', async () => {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    const jobs = await getAll(
      `SELECT cj.*, c.name as cleaner_name, c.phone as cleaner_phone, c.id as cid,
              p.name as property_name, p.address as property_address
       FROM cleaning_jobs cj
       JOIN cleaners c ON cj.cleaner_id = c.id
       JOIN properties p ON cj.property_id = p.id
       WHERE cj.cleaning_date = $1 AND cj.reminder_sent = 0 AND cj.${STILL_TO_DO_SQL}`,
      [today]
    );

    for (const job of jobs) {
      // Check notification prefs
      const prefs = await getOne('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = $1', [job.cid]);
      if (prefs && (!prefs.whatsapp_enabled || !prefs.notify_2_hours)) continue;

      const [h, m] = job.start_time.split(':').map(Number);
      const jobStart = new Date(today + 'T00:00:00');
      jobStart.setHours(h, m);

      if (jobStart <= oneHourFromNow && jobStart > now) {
        const nextBooking = await getOne(
          `SELECT * FROM bookings
           WHERE property_id = $1 AND check_in = $2 AND status = 'confirmed'
           ORDER BY check_in ASC LIMIT 1`,
          [job.property_id, today]
        );

        const guestInfo = nextBooking
          ? `Next guest: ${nextBooking.guest_name || 'Guest'} checking in at 15:00 (${nextBooking.num_guests || '?'} guests)`
          : 'No guest checking in today.';

        const message =
          `Reminder: cleaning in 1 hour\n` +
          `Property: ${job.property_name}\n` +
          `Address: ${job.property_address}\n` +
          `Time: ${job.start_time} - ${job.end_time}\n` +
          guestInfo;

        const toCleaner = await notify({
          event: 'job_reminder',
          title: `${job.property_name} in an hour`,
          body: message,
          propertyId: job.property_id, cleanerId: job.cid, jobId: job.id,
          link: '/',
        });
        const delivered = toCleaner.delivery === 'sent';

        // Marked either way. Retrying every fifteen minutes against a
        // channel that is down would bury the cleaner in duplicates the
        // moment it came back, and the failure is on record below.
        await run('UPDATE cleaning_jobs SET reminder_sent = 1 WHERE id = $1', [job.id]);

        await notify({
          event: delivered ? 'cleaning_started' : 'cleaning_overdue',
          title: delivered ?
          `Reminded ${job.cleaner_name}: ${job.property_name} in 1 hour` :
          `Could not remind ${job.cleaner_name} about ${job.property_name}`,
          body: delivered ? '' : 'Their reminder did not go out. They may not know.',
          propertyId: job.property_id, cleanerId: job.cid, jobId: job.id,
          link: '/cleaners',
        });
      }
    }
  } catch (err) {
    console.error('Reminder cron error:', err.message);
  }
});

// Daily at 8:00 AM SAST = 6:00 AM UTC — send 1-day and 7-day advance WhatsApp notifications
cron.schedule('0 6 * * *', async () => {
  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const sendAdvanceNotice = async (targetDate, label, prefField) => {
      const jobs = await getAll(
        `SELECT cj.*, c.name as cleaner_name, c.phone as cleaner_phone, c.id as cid,
                p.name as property_name, p.address as property_address,
                b.guest_name, b.num_guests, b.special_requirements
         FROM cleaning_jobs cj
         JOIN cleaners c ON cj.cleaner_id = c.id
         JOIN properties p ON cj.property_id = p.id
         LEFT JOIN bookings b ON cj.booking_id = b.smoobu_id
         WHERE cj.cleaning_date = $1 AND cj.${STILL_TO_DO_SQL}`,
        [targetDate]
      );

      for (const job of jobs) {
        const prefs = await getOne('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = $1', [job.cid]);
        if (prefs && (!prefs.whatsapp_enabled || !prefs[prefField])) continue;

        const guestInfo = job.guest_name
          ? `Guest: ${job.guest_name} (${job.num_guests || '?'} guests)`
          : '';
        const specialReq = job.special_requirements
          ? `Special requirements: ${job.special_requirements}`
          : '';

        const message =
          `${label} Cleaning Job\n` +
          `Property: ${job.property_name}\n` +
          `Address: ${job.property_address || 'N/A'}\n` +
          `Date: ${job.cleaning_date}\n` +
          `Time: ${job.start_time} - ${job.end_time}\n` +
          (guestInfo ? guestInfo + '\n' : '') +
          (specialReq ? specialReq + '\n' : '');

        await notify({
          event: 'job_upcoming',
          title: `${label} ${job.property_name}`,
          body: message.trim(),
          propertyId: job.property_id, cleanerId: job.cleaner_id, jobId: job.id,
          link: '/',
        });
      }
    };

    await sendAdvanceNotice(tomorrow, 'Tomorrow:', 'notify_1_day');
    await sendAdvanceNotice(in7Days, 'Upcoming (7 days):', 'notify_7_days');
  } catch (err) {
    console.error('Advance notification cron error:', err.message);
  }
});

/**
 * Chase requests nobody has answered.
 *
 * A job is created pending and stays that way until the cleaner accepts
 * or declines. Nothing chased it. Four of Jane's five upcoming jobs sat
 * unanswered, and the only way to notice was to go and look — by which
 * time the day may have arrived with nobody committed to turning up.
 *
 * Twice: once to the cleaner while there is still time for them to
 * answer, and once to the owner if the day is nearly here and they still
 * have not — because at that point it stops being the cleaner's problem
 * to solve and becomes a property with nobody coming.
 *
 * answer_chased_at is what stops this becoming a daily nag. One reminder
 * per job; if that does not produce an answer, chasing harder is the
 * owner's job, not a cron's.
 */
cron.schedule('0 7 * * *', async () => {
  try {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const waiting = await getAll(
      `SELECT cj.*, c.name AS cleaner_name, p.name AS property_name
         FROM cleaning_jobs cj
         JOIN cleaners c ON c.id = cj.cleaner_id
         JOIN properties p ON p.id = cj.property_id
        WHERE cj.status = 'pending'
          AND cj.cleaning_date >= $1 AND cj.cleaning_date <= $2
          AND cj.answer_chased_at IS NULL`,
      [today, soon]
    );

    for (const job of waiting) {
      const when = prettyDate(job.cleaning_date);
      await notify({
        event: 'job_reminder',
        title: `Can you still do ${job.property_name} on ${when}?`,
        body: `${job.start_time}–${job.end_time}. Accept it or decline it so the owner knows where they stand.`,
        propertyId: job.property_id, cleanerId: job.cleaner_id, jobId: job.id,
        link: '/',
      });

      // One day out and still no answer is the owner's problem now.
      const daysOut = Math.round(
        (new Date(`${ymd(job.cleaning_date)}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000
      );
      if (daysOut <= 1) {
        await notify({
          event: 'job_unanswered',
          title: `${job.cleaner_name} has not answered about ${job.property_name} on ${when}`,
          body: 'Nobody is committed to that clean yet.',
          propertyId: job.property_id, cleanerId: job.cleaner_id, jobId: job.id,
          link: '/cleaners',
        });
      }

      await run('UPDATE cleaning_jobs SET answer_chased_at = NOW() WHERE id = $1', [job.id]);
    }

    if (waiting.length) console.log(`Chased ${waiting.length} unanswered request(s).`);
  } catch (err) {
    console.error('Unanswered-request cron error:', err.message);
  }
});

/**
 * Ask every morning whether the settings are still right.
 *
 * 06:00 SAST, before anybody looks at the dashboard, so the card is
 * already answered when they open it. Only red is sent — see
 * `health-check` for why an amber alert every day is how the channel
 * gets muted before the red one arrives.
 *
 * Reads only. It never writes a rate.
 */
cron.schedule('0 4 * * *', async () => {
  try {
    const { status, results } = await runHealthCheck();
    console.log(`Channel health: ${status} across ${results.length} propert${results.length === 1 ? 'y' : 'ies'}.`);
  } catch (err) {
    console.error(`Channel health cron error: ${err.message}`);
  }
});

console.log('Cron jobs scheduled (SAST/UTC+2).');
