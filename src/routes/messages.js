/**
 * Guest messages: the inbox, one conversation, and a reply.
 *
 * Everything is scoped by property, through the booking. A conversation
 * belongs to whoever may see the property it is about; a booking this
 * app has never seen cannot be opened, because there is nothing to prove
 * it is yours.
 */

const express = require('express');
const router = express.Router();
const { getAll, getOne } = require('../db/database');
const { scopeProperties, denyIfOutOfScope } = require('../middleware/auth');
const { getApiKeyForUser } = require('../services/api-key-resolver');
const smoobu = require('../services/smoobu');
const { conversation, threads, markRead, unreadCount } = require('../services/guest-messages');

/** Long enough for directions to the key box; short enough to be a message. */
const MAX_LENGTH = 2000;

router.use(scopeProperties);

/** Smoobu's failure, said as something a person can act on. */
function unreachable(res, err) {
  console.error('Guest messages: Smoobu failed —', err.response?.status || '', err.message);
  return res.status(502).json({ error: 'Could not reach Smoobu. Try again in a moment.' });
}

async function scopedProperties(req) {
  const scoped = req.accessiblePropertyIds;
  return getAll(
    scoped === null ? 'SELECT id, name, smoobu_id FROM properties ORDER BY name' :
      'SELECT id, name, smoobu_id FROM properties WHERE id = ANY($1) ORDER BY name',
    scoped === null ? [] : [scoped]
  );
}

/** Every conversation, newest activity first. */
router.get('/threads', async (req, res) => {
  try {
    const properties = await scopedProperties(req);
    const only = Number(req.query.property_id) || 0;
    const list = await threads(only ? properties.filter((p) => p.id === only) : properties,
      await getApiKeyForUser(req.user.id));
    res.json({ threads: list, unread: list.filter((t) => t.unread).length });
  } catch (err) {
    unreachable(res, err);
  }
});

/** How many conversations are waiting — from this app's own record, no Smoobu call. */
router.get('/unread', async (req, res) => {
  res.json({ unread: await unreadCount(req.accessiblePropertyIds) });
});

/** The booking a conversation is about, if this account may see it. */
async function bookingFor(req, res) {
  const id = Number(req.params.bookingId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'That is not a booking' });
    return null;
  }
  const row = await getOne(
    `SELECT b.smoobu_id, b.guest_name, b.check_in, b.check_out, b.platform, b.property_id,
            b.raw_payload, p.name AS property
       FROM bookings b JOIN properties p ON p.id = b.property_id
      WHERE b.smoobu_id = $1`,
    [id]
  );
  if (!row) {
    res.status(404).json({ error: 'No booking like that here' });
    return null;
  }
  if (denyIfOutOfScope(req, res, row.property_id)) return null;
  const { raw_payload: raw, ...booking } = row;
  booking.channel_link = channelLink(booking.platform, raw);
  return booking;
}

/**
 * The conversation on the channel's own site, where what Smoobu cannot
 * carry still is.
 *
 * Airbnb passes Smoobu a guest's message without its photo — Smoobu
 * stores it with empty text and no attachment, and neither it nor this
 * app can show it. Airbnb resolves a reservation by its confirmation
 * code, and from the stay Messages is one tap; on a phone the link
 * opens the Airbnb app. Only Airbnb: Booking.com's extranet links need a
 * session token this app does not hold.
 */
function channelLink(platform, raw) {
  const payload = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  const ref = payload && (payload['reference-id'] || payload.referenceId);
  if (!/airbnb/i.test(String(platform || '')) || !/^[A-Z0-9]{6,12}$/.test(String(ref || ''))) return null;
  return { label: 'Airbnb', url: `https://www.airbnb.com/hosting/reservations/details/${ref}` };
}

/** One conversation. Opening it is reading it. */
router.get('/:bookingId', async (req, res) => {
  const booking = await bookingFor(req, res);
  if (!booking) return;
  try {
    const messages = await conversation(booking.smoobu_id, await getApiKeyForUser(req.user.id));
    const latest = messages.length ? messages[messages.length - 1].id : null;
    await markRead(booking.smoobu_id, latest, booking.property_id);
    res.json({ booking, messages });
  } catch (err) {
    unreachable(res, err);
  }
});

/**
 * Reply. Goes to the guest through the channel they booked on.
 *
 * Sent, then the conversation re-read, so what comes back is what
 * Smoobu now holds rather than what this hoped it sent.
 */
router.post('/:bookingId', async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'Write something first' });
  if (text.length > MAX_LENGTH) {
    return res.status(400).json({ error: `Keep it under ${MAX_LENGTH} characters` });
  }

  const booking = await bookingFor(req, res);
  if (!booking) return;

  const apiKey = await getApiKeyForUser(req.user.id);
  try {
    await smoobu.sendMessageToGuest(booking.smoobu_id, { messageBody: text }, apiKey);
  } catch (err) {
    console.error('Guest messages: send failed —', err.response?.status || '', err.message);
    return res.status(502).json({ error: 'Smoobu did not take that message. It has not been sent.' });
  }

  try {
    const messages = await conversation(booking.smoobu_id, apiKey);
    const latest = messages.length ? messages[messages.length - 1].id : null;
    await markRead(booking.smoobu_id, latest, booking.property_id);
    res.json({ sent: true, booking, messages });
  } catch (err) {
    // Sent, and the re-read failed. Say both, so nobody sends it twice.
    res.json({ sent: true, booking, messages: null, warning: 'Sent. Could not reload the conversation.' });
  }
});

module.exports = router;
