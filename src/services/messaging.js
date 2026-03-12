const { getDb } = require('../db/database');
const smoobu = require('./smoobu');

// Send check-in instructions 24 hours before check-in
async function sendCheckinMessages() {
  const db = getDb();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const bookings = db
    .prepare(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.check_in = ? AND b.status = 'confirmed'`
    )
    .all(tomorrow);

  const template =
    process.env.CHECKIN_MESSAGE_TEMPLATE ||
    'Dear guest, we look forward to welcoming you tomorrow.';

  for (const booking of bookings) {
    try {
      const message = template
        .replace('{guest_name}', booking.guest_name || 'Guest')
        .replace('{property_name}', booking.property_name)
        .replace('{check_in}', booking.check_in);

      await smoobu.sendGuestMessage(
        booking.smoobu_id,
        'Check-in Instructions',
        message
      );
      console.log(
        `Sent check-in message for booking ${booking.smoobu_id} at ${booking.property_name}`
      );
    } catch (err) {
      console.error(
        `Failed to send check-in message for booking ${booking.smoobu_id}:`,
        err.message
      );
    }
  }
}

// Send checkout reminders on the morning of checkout
async function sendCheckoutMessages() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const bookings = db
    .prepare(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.check_out = ? AND b.status = 'confirmed'`
    )
    .all(today);

  const template =
    process.env.CHECKOUT_MESSAGE_TEMPLATE ||
    'Dear guest, just a reminder that checkout is at 10am today. Thank you for staying with us!';

  for (const booking of bookings) {
    try {
      const message = template
        .replace('{guest_name}', booking.guest_name || 'Guest')
        .replace('{property_name}', booking.property_name)
        .replace('{check_out}', booking.check_out);

      await smoobu.sendGuestMessage(
        booking.smoobu_id,
        'Checkout Reminder',
        message
      );
      console.log(
        `Sent checkout message for booking ${booking.smoobu_id} at ${booking.property_name}`
      );
    } catch (err) {
      console.error(
        `Failed to send checkout message for booking ${booking.smoobu_id}:`,
        err.message
      );
    }
  }
}

module.exports = { sendCheckinMessages, sendCheckoutMessages };
