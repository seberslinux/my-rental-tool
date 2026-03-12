const { getDb } = require('../db/database');
const smoobu = require('./smoobu');
const whatsapp = require('./whatsapp');

// Run cleaner assignment for a specific property and checkout date
// booking: { id, smoobu_id, property_id, check_out, check_in_next, num_guests_next, guest_name_next }
async function assignCleanerForCheckout(booking, nextBooking = null) {
  const db = getDb();

  const property = db
    .prepare('SELECT * FROM properties WHERE id = ?')
    .get(booking.property_id);
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

  // Check which day of week the checkout falls on (0=Sun, 6=Sat)
  const date = new Date(checkoutDate + 'T00:00:00');
  const dayOfWeek = date.getDay();

  // Find eligible cleaners: assigned to this property
  const assignedCleaners = db
    .prepare(
      `SELECT c.* FROM cleaners c
       JOIN cleaner_properties cp ON c.id = cp.cleaner_id
       WHERE cp.property_id = ?`
    )
    .all(property.id);

  for (const cleaner of assignedCleaners) {
    // Check for date-specific override
    const override = db
      .prepare(
        'SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = ? AND date = ?'
      )
      .get(cleaner.id, checkoutDate);

    if (override && !override.available) {
      continue; // Cleaner is explicitly unavailable on this date
    }

    // If no override marking available, check weekly schedule
    if (!override) {
      const availability = db
        .prepare(
          'SELECT * FROM cleaner_availability WHERE cleaner_id = ? AND day_of_week = ?'
        )
        .get(cleaner.id, dayOfWeek);

      if (!availability) {
        continue; // No availability set for this day
      }

      // Check if cleaning window fits within their availability
      const availStart = parseTime(availability.start_time);
      const availEnd = parseTime(availability.end_time);
      if (windowStart < availStart || windowEnd > availEnd) {
        continue; // Window doesn't fit
      }
    }

    // Check if cleaner already has a job at the same time
    const existingJob = db
      .prepare(
        `SELECT * FROM cleaning_jobs
         WHERE cleaner_id = ? AND cleaning_date = ? AND status != 'completed'`
      )
      .get(cleaner.id, checkoutDate);

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

    // Assign this cleaner
    const result = db
      .prepare(
        `INSERT INTO cleaning_jobs (property_id, cleaner_id, booking_id, cleaning_date, start_time, end_time, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        property.id,
        cleaner.id,
        booking.id,
        checkoutDate,
        checkoutTime,
        actualEndTime
      );

    // Send WhatsApp notification
    try {
      const nextGuestInfo = nextBooking
        ? `\nNext guest check-in: ${nextBooking.check_in} at 15:00\nNumber of guests arriving: ${nextBooking.num_guests || 'unknown'}`
        : '\nNo guest checking in today.';

      const message =
        `Cleaning job assigned:\n` +
        `Property: ${property.name}\n` +
        `Address: ${property.address}\n` +
        `Date: ${checkoutDate}\n` +
        `Start time: ${checkoutTime}\n` +
        `Expected duration: ${property.cleaning_hours_required} hours` +
        nextGuestInfo;

      await whatsapp.sendMessage(cleaner.phone, message);
      db.prepare('UPDATE cleaning_jobs SET notified = 1 WHERE id = ?').run(
        result.lastInsertRowid
      );
    } catch (err) {
      console.error(`Failed to notify cleaner ${cleaner.name}:`, err.message);
    }

    console.log(
      `Assigned cleaner ${cleaner.name} to ${property.name} on ${checkoutDate}`
    );
    return result.lastInsertRowid;
  }

  // No cleaner available — block dates in Smoobu
  console.log(
    `No cleaner available for ${property.name} on ${checkoutDate}. Blocking dates.`
  );

  try {
    const blockEnd = nextBooking ? nextBooking.check_in : checkoutDate;
    await smoobu.blockDates(
      property.smoobu_id,
      checkoutDate,
      blockEnd,
      'No cleaner available'
    );

    db.prepare(
      'INSERT INTO blocked_dates (property_id, date, reason) VALUES (?, ?, ?)'
    ).run(property.id, checkoutDate, 'No cleaner available');
  } catch (err) {
    console.error(`Failed to block dates in Smoobu:`, err.message);
  }

  return null;
}

// Run assignment for all upcoming checkouts
async function runAssignmentForAllCheckouts() {
  const db = getDb();

  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Get all bookings with upcoming checkouts that don't have a cleaning job yet
  const bookings = db
    .prepare(
      `SELECT b.* FROM bookings b
       WHERE b.check_out >= ? AND b.check_out <= ? AND b.status = 'confirmed'
       AND NOT EXISTS (
         SELECT 1 FROM cleaning_jobs cj WHERE cj.booking_id = b.id
       )
       ORDER BY b.check_out ASC`
    )
    .all(today, futureDate);

  for (const booking of bookings) {
    // Find the next booking for the same property after this checkout
    const nextBooking = db
      .prepare(
        `SELECT * FROM bookings
         WHERE property_id = ? AND check_in >= ? AND status = 'confirmed'
         ORDER BY check_in ASC LIMIT 1`
      )
      .get(booking.property_id, booking.check_out);

    await assignCleanerForCheckout(booking, nextBooking);
  }
}

// Unassign a cleaner from a job and notify them
async function unassignCleanerFromBooking(bookingId) {
  const db = getDb();

  const jobs = db
    .prepare(
      `SELECT cj.*, c.phone, c.name as cleaner_name, p.name as property_name
       FROM cleaning_jobs cj
       JOIN cleaners c ON cj.cleaner_id = c.id
       JOIN properties p ON cj.property_id = p.id
       WHERE cj.booking_id = ? AND cj.status != 'completed'`
    )
    .all(bookingId);

  for (const job of jobs) {
    db.prepare('DELETE FROM cleaning_jobs WHERE id = ?').run(job.id);

    try {
      const message =
        `Cleaning job cancelled:\n` +
        `Property: ${job.property_name}\n` +
        `Date: ${job.cleaning_date}\n` +
        `This booking has been cancelled.`;
      await whatsapp.sendMessage(job.phone, message);
    } catch (err) {
      console.error(
        `Failed to notify cleaner ${job.cleaner_name} of cancellation:`,
        err.message
      );
    }
  }
}

// Re-run assignment for a modified booking
async function reassignCleanerForBooking(bookingId) {
  await unassignCleanerFromBooking(bookingId);

  const db = getDb();
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return;

  const nextBooking = db
    .prepare(
      `SELECT * FROM bookings
       WHERE property_id = ? AND check_in >= ? AND status = 'confirmed' AND id != ?
       ORDER BY check_in ASC LIMIT 1`
    )
    .get(booking.property_id, booking.check_out, booking.id);

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
  assignCleanerForCheckout,
  runAssignmentForAllCheckouts,
  unassignCleanerFromBooking,
  reassignCleanerForBooking,
};
