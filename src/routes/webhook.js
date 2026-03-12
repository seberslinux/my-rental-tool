const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const {
  assignCleanerForCheckout,
  unassignCleanerFromBooking,
  reassignCleanerForBooking,
} = require('../services/cleaner-assignment');
const smoobu = require('../services/smoobu');

// Smoobu webhook endpoint
router.post('/', async (req, res) => {
  const event = req.body;
  console.log('Webhook received:', JSON.stringify(event).substring(0, 200));

  try {
    const action = event.action || event.type;
    const bookingData = event.data || event;

    if (!bookingData) {
      return res.status(200).json({ received: true, action: 'no data' });
    }

    const db = getDb();
    const smoobuId = bookingData.id || bookingData.reservationId;
    const apartmentId = bookingData['apartment']?.id || bookingData.apartmentId;

    // Find local property
    const property = db
      .prepare('SELECT * FROM properties WHERE smoobu_id = ?')
      .get(apartmentId);

    if (!property) {
      console.log(`Webhook: Property not found for apartment ${apartmentId}`);
      return res.status(200).json({ received: true, action: 'unknown property' });
    }

    if (action === 'newReservation' || action === 'new') {
      // Upsert booking
      db.prepare(
        `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
         ON CONFLICT(smoobu_id) DO UPDATE SET
           guest_name = excluded.guest_name, check_in = excluded.check_in,
           check_out = excluded.check_out, platform = excluded.platform,
           total_price = excluded.total_price, status = 'confirmed',
           num_guests = excluded.num_guests`
      ).run(
        smoobuId,
        property.id,
        bookingData['guest-name'] || bookingData.guestName || '',
        bookingData.arrival || bookingData.arrivalDate,
        bookingData.departure || bookingData.departureDate,
        bookingData['channel']?.name || bookingData.channel || '',
        bookingData.price || 0,
        bookingData.adults || 1
      );

      const booking = db.prepare('SELECT * FROM bookings WHERE smoobu_id = ?').get(smoobuId);

      // Find next booking for this property
      const nextBooking = db
        .prepare(
          `SELECT * FROM bookings
           WHERE property_id = ? AND check_in >= ? AND status = 'confirmed' AND id != ?
           ORDER BY check_in ASC LIMIT 1`
        )
        .get(property.id, booking.check_out, booking.id);

      await assignCleanerForCheckout(booking, nextBooking);

    } else if (action === 'cancelReservation' || action === 'cancel') {
      const booking = db.prepare('SELECT * FROM bookings WHERE smoobu_id = ?').get(smoobuId);

      if (booking) {
        db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
        await unassignCleanerFromBooking(booking.id);

        // Unblock any dates that were blocked due to this booking's checkout
        const blockedDates = db
          .prepare('SELECT * FROM blocked_dates WHERE property_id = ? AND date = ?')
          .all(property.id, booking.check_out);

        for (const blocked of blockedDates) {
          db.prepare('DELETE FROM blocked_dates WHERE id = ?').run(blocked.id);
        }
      }

    } else if (action === 'modifyReservation' || action === 'modify') {
      // Update booking data
      db.prepare(
        `UPDATE bookings SET
           guest_name = ?, check_in = ?, check_out = ?, total_price = ?, num_guests = ?
         WHERE smoobu_id = ?`
      ).run(
        bookingData['guest-name'] || bookingData.guestName || '',
        bookingData.arrival || bookingData.arrivalDate,
        bookingData.departure || bookingData.departureDate,
        bookingData.price || 0,
        bookingData.adults || 1,
        smoobuId
      );

      const booking = db.prepare('SELECT * FROM bookings WHERE smoobu_id = ?').get(smoobuId);
      if (booking) {
        await reassignCleanerForBooking(booking.id);
      }
    }

    res.status(200).json({ received: true, action });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

module.exports = router;
