const cron = require('node-cron');
const { runPricingEngine } = require('../services/pricing');
const { sendCheckinMessages, sendCheckoutMessages } = require('../services/messaging');
const { runAssignmentForAllCheckouts } = require('../services/cleaner-assignment');
const { getAll, getOne, run } = require('../db/database');
const whatsapp = require('../services/whatsapp');

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

// Every 30 minutes — send cleaning job reminders (2 hours before start)
cron.schedule('*/30 * * * *', async () => {
  try {
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    const jobs = await getAll(
      `SELECT cj.*, c.name as cleaner_name, c.phone as cleaner_phone, c.id as cid,
              p.name as property_name, p.address as property_address
       FROM cleaning_jobs cj
       JOIN cleaners c ON cj.cleaner_id = c.id
       JOIN properties p ON cj.property_id = p.id
       WHERE cj.cleaning_date = $1 AND cj.reminder_sent = 0 AND cj.status != 'completed'`,
      [today]
    );

    for (const job of jobs) {
      // Check notification prefs
      const prefs = await getOne('SELECT * FROM cleaner_notification_prefs WHERE cleaner_id = $1', [job.cid]);
      if (prefs && (!prefs.whatsapp_enabled || !prefs.notify_2_hours)) continue;

      const [h, m] = job.start_time.split(':').map(Number);
      const jobStart = new Date(today + 'T00:00:00');
      jobStart.setHours(h, m);

      if (jobStart <= twoHoursFromNow && jobStart > now) {
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
          `Reminder: Cleaning job in 2 hours\n` +
          `Property: ${job.property_name}\n` +
          `Address: ${job.property_address}\n` +
          `Time: ${job.start_time} - ${job.end_time}\n` +
          guestInfo;

        try {
          await whatsapp.sendMessage(job.cleaner_phone, message);
          await run('UPDATE cleaning_jobs SET reminder_sent = 1 WHERE id = $1', [job.id]);
        } catch (err) {
          console.error(`Failed to send reminder to ${job.cleaner_name}:`, err.message);
        }
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
         LEFT JOIN bookings b ON cj.booking_id = b.id
         WHERE cj.cleaning_date = $1 AND cj.status != 'completed'`,
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

        try {
          await whatsapp.sendMessage(job.cleaner_phone, message.trim());
        } catch (err) {
          console.error(`Failed to send ${label} notice to ${job.cleaner_name}:`, err.message);
        }
      }
    };

    await sendAdvanceNotice(tomorrow, 'Tomorrow:', 'notify_1_day');
    await sendAdvanceNotice(in7Days, 'Upcoming (7 days):', 'notify_7_days');
  } catch (err) {
    console.error('Advance notification cron error:', err.message);
  }
});

console.log('Cron jobs scheduled (SAST/UTC+2).');
