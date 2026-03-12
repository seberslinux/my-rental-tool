const cron = require('node-cron');
const { runPricingEngine } = require('../services/pricing');
const { sendCheckinMessages, sendCheckoutMessages } = require('../services/messaging');
const { runAssignmentForAllCheckouts } = require('../services/cleaner-assignment');
const { getDb } = require('../db/database');
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
    const db = getDb();
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];

    // Find jobs starting in the next 2 hours that haven't been reminded
    const jobs = db
      .prepare(
        `SELECT cj.*, c.name as cleaner_name, c.phone as cleaner_phone,
                p.name as property_name, p.address as property_address
         FROM cleaning_jobs cj
         JOIN cleaners c ON cj.cleaner_id = c.id
         JOIN properties p ON cj.property_id = p.id
         WHERE cj.cleaning_date = ? AND cj.reminder_sent = 0 AND cj.status != 'completed'`
      )
      .all(today);

    for (const job of jobs) {
      const [h, m] = job.start_time.split(':').map(Number);
      const jobStart = new Date(today + 'T00:00:00');
      jobStart.setHours(h, m);

      // Send reminder if job starts within 2 hours
      if (jobStart <= twoHoursFromNow && jobStart > now) {
        // Get next booking info
        const nextBooking = db
          .prepare(
            `SELECT * FROM bookings
             WHERE property_id = ? AND check_in = ? AND status = 'confirmed'
             ORDER BY check_in ASC LIMIT 1`
          )
          .get(job.property_id, today);

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
          db.prepare('UPDATE cleaning_jobs SET reminder_sent = 1 WHERE id = ?').run(job.id);
        } catch (err) {
          console.error(`Failed to send reminder to ${job.cleaner_name}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('Reminder cron error:', err.message);
  }
});

console.log('Cron jobs scheduled (SAST/UTC+2).');
