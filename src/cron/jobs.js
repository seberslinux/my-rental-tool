const cron = require('node-cron');
const { runPricingEngine } = require('../services/pricing');
const { sendCheckinMessages, sendCheckoutMessages } = require('../services/messaging');
const { runAssignmentForAllCheckouts } = require('../services/cleaner-assignment');
const { getAll, getOne, run } = require('../db/database');
const { notify } = require('../services/notify');
// Dates as somebody would say them, and one definition of YYYY-MM-DD.
const { prettyDate, ymd } = require('../services/availability');
const { STILL_TO_DO_SQL } = require('../services/job-life');

// Daily at 6:00 AM SAST (UTC+2) = 4:00 AM UTC — run pricing engine
cron.schedule('0 4 * * *', async () => {
  console.log('Running daily pricing engine...');
  try {
    await runPricingEngine();
    console.log('Pricing engine completed.');
  } catch (err) {
    console.error('Pricing engine cron error:', err.message);
  }
});

// Daily at 7:00 AM SAST = 5:00 AM UTC — send checkout reminders
cron.schedule('0 5 * * *', async () => {
  console.log('Sending checkout reminders...');
  try {
    await sendCheckoutMessages();
  } catch (err) {
    console.error('Checkout messaging cron error:', err.message);
  }
});

// Daily at 10:00 AM SAST = 8:00 AM UTC — send check-in instructions (for tomorrow)
cron.schedule('0 8 * * *', async () => {
  console.log('Sending check-in instructions...');
  try {
    await sendCheckinMessages();
  } catch (err) {
    console.error('Checkin messaging cron error:', err.message);
  }
});

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

console.log('Cron jobs scheduled (SAST/UTC+2).');
