const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { getAll, getOne, run } = require('../db/database');
const {
  assignCleanerForCheckout,
  unassignCleanerFromBooking,
  reassignCleanerForBooking,
} = require('../services/cleaner-assignment');
const smoobu = require('../services/smoobu');
// Shared with both sync paths so the three cannot drift apart again.
const { mapSmoobuBooking } = require('../services/smoobu-mapper');

// Smoobu has no HMAC/signature support in its webhook config — the only
// control we have is the URL itself. Require a long random secret as part
// of the path (configure Smoobu's webhook URL as /webhook/<WEBHOOK_SECRET>)
// so an attacker can't discover or guess it from the public repo.
function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyWebhookSecret(req, res, next) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) {
    console.error('WEBHOOK_SECRET is not set — rejecting all webhook requests');
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  const provided = req.params.secret || '';
  if (!timingSafeEqualStrings(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Smoobu webhook endpoint — mounted at /webhook, so this is /webhook/:secret
router.post('/:secret', verifyWebhookSecret, async (req, res) => {
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
      const row = mapSmoobuBooking(bookingData);
      // Upsert booking
      await run(
        `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out,
           platform, total_price, status, num_guests, commission, children,
           language, guest_country, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10, $11, $12, $13)
         ON CONFLICT(smoobu_id) DO UPDATE SET
           guest_name = CASE WHEN EXCLUDED.guest_name = '' THEN bookings.guest_name ELSE EXCLUDED.guest_name END,
           check_in = EXCLUDED.check_in,
           check_out = EXCLUDED.check_out, platform = EXCLUDED.platform,
           total_price = EXCLUDED.total_price, status = 'confirmed',
           num_guests = EXCLUDED.num_guests, commission = EXCLUDED.commission,
           children = EXCLUDED.children, language = EXCLUDED.language,
           guest_country = EXCLUDED.guest_country,
           raw_payload = EXCLUDED.raw_payload`,
        [
          row.smoobu_id, property.id, row.guest_name, row.check_in, row.check_out,
          row.platform, row.total_price, row.num_guests, row.commission,
          row.children, row.language, row.guest_country, row.raw_payload,
        ]
      );

      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);

      // Find next booking for this property
      const nextBooking = await getOne(
        `SELECT * FROM bookings
         WHERE property_id = $1 AND check_in >= $2 AND status = 'confirmed' AND smoobu_id != $3
         ORDER BY check_in ASC LIMIT 1`,
        [property.id, booking.check_out, smoobuId]
      );

      await assignCleanerForCheckout(booking, nextBooking);

    } else if (action === 'cancelReservation' || action === 'cancel') {
      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);

      if (booking) {
        await run("UPDATE bookings SET status = 'cancelled', modified_at = NOW() WHERE smoobu_id = $1", [smoobuId]);
        await unassignCleanerFromBooking(smoobuId);

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
      const row = mapSmoobuBooking(bookingData);
      await run(
        `UPDATE bookings SET
           guest_name = $1, check_in = $2, check_out = $3, total_price = $4,
           num_guests = $5, children = $6, commission = $7, language = $8,
           guest_country = $9, raw_payload = $10
         WHERE smoobu_id = $11`,
        [
          row.guest_name, row.check_in, row.check_out, row.total_price,
          row.num_guests, row.children, row.commission, row.language,
          row.guest_country, row.raw_payload, smoobuId,
        ]
      );

      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);
      if (booking) {
        await reassignCleanerForBooking(smoobuId);
      }
    }

    res.status(200).json({ received: true, action });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

module.exports = router;
