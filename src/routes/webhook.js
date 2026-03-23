const express = require('express');
const router = express.Router();
const { getAll, getOne, run } = require('../db/database');
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

    const smoobuId = bookingData.id || bookingData.reservationId;
    const apartmentId = bookingData['apartment']?.id || bookingData.apartmentId;

    // Find local property
    const property = await getOne('SELECT * FROM properties WHERE smoobu_id = $1', [apartmentId]);

    if (!property) {
      console.log(`Webhook: Property not found for apartment ${apartmentId}`);
      return res.status(200).json({ received: true, action: 'unknown property' });
    }

    if (action === 'newReservation' || action === 'new') {
      // Upsert booking
      await run(
        `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8)
         ON CONFLICT(smoobu_id) DO UPDATE SET
           guest_name = CASE WHEN EXCLUDED.guest_name = '' THEN bookings.guest_name ELSE EXCLUDED.guest_name END, check_in = EXCLUDED.check_in,
           check_out = EXCLUDED.check_out, platform = EXCLUDED.platform,
           total_price = EXCLUDED.total_price, status = 'confirmed',
           num_guests = EXCLUDED.num_guests`,
        [
          smoobuId,
          property.id,
          bookingData['guest-name'] || bookingData.guestName || '',
          bookingData.arrival || bookingData.arrivalDate,
          bookingData.departure || bookingData.departureDate,
          bookingData['channel']?.name || bookingData.channel || '',
          bookingData.price || 0,
          bookingData.adults || 1
        ]
      );

      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);

      // Find next booking for this property
      const nextBooking = await getOne(
        `SELECT * FROM bookings
         WHERE property_id = $1 AND check_in >= $2 AND status = 'confirmed' AND id != $3
         ORDER BY check_in ASC LIMIT 1`,
        [property.id, booking.check_out, booking.id]
      );

      await assignCleanerForCheckout(booking, nextBooking);

    } else if (action === 'cancelReservation' || action === 'cancel') {
      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);

      if (booking) {
        await run("UPDATE bookings SET status = 'cancelled', modified_at = NOW() WHERE id = $1", [booking.id]);
        await unassignCleanerFromBooking(booking.id);

        // Unblock any dates that were blocked due to this booking's checkout
        const blockedDates = await getAll(
          'SELECT * FROM blocked_dates WHERE property_id = $1 AND date = $2',
          [property.id, booking.check_out]
        );

        for (const blocked of blockedDates) {
          await run('DELETE FROM blocked_dates WHERE id = $1', [blocked.id]);
        }
      }

    } else if (action === 'modifyReservation' || action === 'modify') {
      // Update booking data
      await run(
        `UPDATE bookings SET
           guest_name = $1, check_in = $2, check_out = $3, total_price = $4, num_guests = $5
         WHERE smoobu_id = $6`,
        [
          bookingData['guest-name'] || bookingData.guestName || '',
          bookingData.arrival || bookingData.arrivalDate,
          bookingData.departure || bookingData.departureDate,
          bookingData.price || 0,
          bookingData.adults || 1,
          smoobuId
        ]
      );

      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);
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
