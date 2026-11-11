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
// One statement writes a booking, whichever path got there first.
const { upsertBooking } = require('../services/booking-store');
// One statement writes a day's rate, shared with the periodic sync.
const { upsertDailyRates } = require('../services/rate-sync');
// Who wrote, and whether anybody here has read it.
const { conversation, recordGuestMessage, markRead } = require('../services/guest-messages');
const { getApiKeyForProperty } = require('../services/api-key-resolver');
const { notify } = require('../services/notify');
const { isBlockedPlatform } = require('../services/analytics-calc');

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
/**
 * A booking, in the words somebody would use about it.
 *
 * "Nightingale, 3 nights from Fri, 12 Sep" says more on a lock screen
 * than a reservation id, and the lock screen is where this now goes.
 */
function describe(booking, propertyName) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(booking.check_out) - new Date(booking.check_in)) / 86400000
    )
  );
  const arrives = new Date(`${booking.check_in}T00:00:00`).toLocaleDateString('en-ZA', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const who = booking.guest_name || 'A guest';
  return {
    who,
    line: `${nights} night${nights === 1 ? '' : 's'} from ${arrives}`,
    where: propertyName || 'a property',
  };
}

/**
 * A stay that is no longer happening, whether cancelled or deleted.
 *
 * The row is kept and marked cancelled rather than removed: analytics
 * and finances read cancelled history. The cleaner comes off the job and
 * the turnover block on the checkout day is released.
 */
async function takeOffCalendar(booking, property, { removed }) {
  await run("UPDATE bookings SET status = 'cancelled', modified_at = NOW() WHERE smoobu_id = $1", [booking.smoobu_id]);
  await unassignCleanerFromBooking(booking.smoobu_id);

  const blockedDates = await getAll(
    'SELECT * FROM blocked_dates WHERE property_id = $1 AND date = $2',
    [property.id, booking.check_out]
  );
  for (const blocked of blockedDates) {
    await run('DELETE FROM blocked_dates WHERE id = $1', [blocked.id]);
  }

  // A removed block is somebody's own edit, not news. A removed or
  // cancelled stay is nights back on sale, worth knowing early enough
  // to reprice them.
  if (isBlockedPlatform(booking.platform)) return;

  const d = describe(booking, property.name);
  await notify({
    event: 'booking_cancelled',
    title: `${removed ? 'Booking removed' : 'Booking cancelled'} — ${d.where}`,
    body: `${d.who}, ${d.line}. Those nights are free again.`,
    propertyId: property.id,
    // Home, not the booking: a cancelled stay is filtered out of the
    // calendar, so a link to it would open the app on a sheet that
    // cannot be drawn.
    link: '/',
  });
}

/** What Smoobu calls a changed booking, plus the names this once guessed. */
const UPDATED = new Set(['updateReservation', 'modifyReservation', 'modify', 'update']);

router.post('/:secret', verifyWebhookSecret, async (req, res) => {
  const event = req.body;
  console.log('Webhook received:', JSON.stringify(event).substring(0, 200));

  try {
    const action = event.action || event.type;
    const bookingData = event.data || event;

    if (!bookingData) {
      return res.status(200).json({ received: true, action: 'no data' });
    }

    /**
     * Not every event is about a booking.
     *
     * The property was looked up here, from `data.apartment.id`, before
     * anything branched on the action. Smoobu's rate and message events
     * carry no apartment on the payload, so every one of them ended at
     * "Property not found for apartment undefined" and returned 200 —
     * telling Smoobu it had been handled. Production had thirteen
     * messages and four rate changes dropped that way.
     */
    if (action === 'updateRates') {
      // `{ "2297844": { "2026-11-28": { price, min_length_of_stay,
      // available } } }` — keyed by apartment, which is the shape
      // `daily_rates` wants and the reason a rate change can be applied
      // here rather than waited for.
      let written = 0;
      for (const [smoobuApartmentId, byDate] of Object.entries(bookingData)) {
        const prop = await getOne('SELECT id, name FROM properties WHERE smoobu_id = $1', [smoobuApartmentId]);
        if (!prop) {
          console.log(`Webhook: rates for unknown apartment ${smoobuApartmentId}`);
          continue;
        }
        const n = await upsertDailyRates(run, prop.id, byDate);
        written += n;
        console.log(`Webhook: ${n} night(s) repriced at ${prop.name}`);
      }
      return res.status(200).json({ received: true, action, nights: written });
    }

    if (action === 'newMessage') {
      // `{ id, sender: 'guest'|'host', booking: { id } }` — no text and no
      // apartment, so the booking is how this finds its property.
      const messageId = Number(bookingData.id) || null;
      const bookingSmoobuId = Number(bookingData.booking && bookingData.booking.id) || null;
      if (!bookingSmoobuId) return res.status(200).json({ received: true, action, handled: false });

      const booking = await getOne(
        `SELECT b.smoobu_id, b.guest_name, b.property_id, p.name AS property
           FROM bookings b JOIN properties p ON p.id = b.property_id WHERE b.smoobu_id = $1`,
        [bookingSmoobuId]
      );

      if (bookingData.sender === 'host') {
        // Answered — from here, from Smoobu, or from the channel's own app.
        // A conversation somebody has replied to is not waiting on them.
        await markRead(bookingSmoobuId, messageId, booking && booking.property_id);
        return res.status(200).json({ received: true, action });
      }

      await recordGuestMessage(bookingSmoobuId, messageId, booking && booking.property_id);

      /**
       * The words, on the lock screen.
       *
       * The webhook carries none, so the conversation is read once to
       * find them. Best effort: a push saying who wrote is still worth
       * sending when Smoobu cannot be reached for what they said.
       */
      let said = '';
      try {
        const apiKey = booking ? await getApiKeyForProperty(booking.property_id) : null;
        const all = await conversation(bookingSmoobuId, apiKey);
        const mine = all.filter((m) => m.from === 'guest');
        said = mine.length ? mine[mine.length - 1].text.slice(0, 180) : '';
      } catch (err) {
        console.log(`Webhook: could not read message ${messageId} — ${err.message}`);
      }

      await notify({
        event: 'guest_message',
        title: `${(booking && booking.guest_name) || 'A guest'} sent a message`,
        body: [booking && booking.property, said].filter(Boolean).join(' · '),
        propertyId: booking ? booking.property_id : null,
        link: `/messages/${bookingSmoobuId}`,
      });
      return res.status(200).json({ received: true, action });
    }

    const smoobuId = bookingData.id || bookingData.reservationId;
    const apartmentId = bookingData['apartment']?.id || bookingData.apartmentId;

    /**
     * A reservation deleted in Smoobu.
     *
     * Nothing listened for this, so a deleted stay — most often a block
     * somebody removed — stayed on the calendar, kept its cleaner and
     * held its nights off sale until the next full sync happened to
     * sweep it away. Handled before the property lookup: the booking we
     * already hold knows its property, so this does not depend on the
     * payload carrying an apartment.
     */
    if (action === 'deleteReservation' || action === 'delete') {
      const booking = smoobuId
        ? await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId])
        : null;
      if (!booking) {
        console.log(`Webhook: deleted reservation ${smoobuId} was never stored here`);
        return res.status(200).json({ received: true, action });
      }
      const owner = await getOne('SELECT * FROM properties WHERE id = $1', [booking.property_id]);
      // An apartment on the payload that disagrees with the stored one
      // is not ours to act on.
      if (!owner || (apartmentId && String(owner.smoobu_id) !== String(apartmentId))) {
        console.log(`Webhook: deleted reservation ${smoobuId} does not match apartment ${apartmentId}`);
        return res.status(200).json({ received: true, action: 'unknown property' });
      }
      if (booking.status !== 'cancelled') {
        await takeOffCalendar(booking, owner, { removed: true });
      }
      return res.status(200).json({ received: true, action });
    }

    // Find local property
    const property = await getOne('SELECT * FROM properties WHERE smoobu_id = $1', [apartmentId]);

    if (!property) {
      console.log(`Webhook: Property not found for apartment ${apartmentId} (action ${action})`);
      return res.status(200).json({ received: true, action: 'unknown property' });
    }

    if (action === 'newReservation' || action === 'new') {
      const row = mapSmoobuBooking(bookingData);
      // Every column the mapper fills. This used to list fourteen of
      // them, so length_of_stay and price_per_night fell to their
      // defaults of 1 and 0 and a ten-night stay was stored as one
      // night. `length_of_stay || 1` is the night count in seven places
      // across analytics and in revenue's pro-rata split.
      await upsertBooking(run, row, { propertyId: property.id, status: 'confirmed' });

      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);

      // Find next booking for this property
      const nextBooking = await getOne(
        `SELECT * FROM bookings
         WHERE property_id = $1 AND check_in >= $2 AND status = 'confirmed' AND smoobu_id != $3
         ORDER BY check_in ASC LIMIT 1`,
        [property.id, booking.check_out, smoobuId]
      );

      await assignCleanerForCheckout(booking, nextBooking);

      // Tell somebody. This is the event the owner most wants to hear
      // about and the one thing the webhook never did — it wrote the
      // row and went quiet.
      const d = describe(booking, property.name);
      await notify({
        event: 'booking_created',
        title: `New booking — ${d.where}`,
        body: `${d.who}, ${d.line}.`,
        propertyId: property.id,
        // Straight to the stay it is about. This was '/', so tapping
        // "New booking" opened the app at Home and left you to go and
        // find the thing it had just told you about. Smoobu's id,
        // because the local row id is not stable across a resync.
        link: `/booking/${booking.smoobu_id}`,
      });

    } else if (action === 'cancelReservation' || action === 'cancel') {
      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);
      if (booking) await takeOffCalendar(booking, property, { removed: false });

    } else if (UPDATED.has(action)) {
      /**
       * `updateReservation` is the one Smoobu sends.
       *
       * This branch matched `modifyReservation` and `modify`, neither
       * of which Smoobu has ever sent — every other action it sends is
       * verb+Noun (`newReservation`, `cancelReservation`, `updateRates`,
       * `newMessage`). So a changed booking fell through to nothing and
       * waited for the periodic sync, which is what "the webhook does
       * not pick up changes instantly" was. The old names are kept as
       * aliases: accepting a name Smoobu does not send costs nothing,
       * and guessing wrong cost this.
       */
      const row = mapSmoobuBooking(bookingData);
      // The same write as every other path. This was an UPDATE of ten
      // columns, so a stay whose dates moved kept its old night count
      // and its old nightly price — the bug above, in the branch next
      // to it. An upsert also means a modification for a booking we
      // never saw creates it rather than silently doing nothing.
      await upsertBooking(run, row, { propertyId: property.id });

      const booking = await getOne('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);
      if (booking) {
        await reassignCleanerForBooking(smoobuId);

        // Quieter than the other two: a changed booking is usually a
        // detail, and the cleaner is told separately when their day
        // actually moves.
        const d = describe(booking, property.name);
        await notify({
          event: 'booking_changed',
          title: `Booking changed — ${d.where}`,
          body: `${d.who}, now ${d.line}.`,
          propertyId: property.id,
          link: `/booking/${smoobuId}`,
        });
      }
    } else {
      // Said out loud. An action nobody handles used to look exactly
      // like one that worked, which is how four rate changes and
      // thirteen messages went by unnoticed.
      console.log(`Webhook: nothing handles action "${action}"`);
      return res.status(200).json({ received: true, action, handled: false });
    }

    res.status(200).json({ received: true, action });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

module.exports = router;
