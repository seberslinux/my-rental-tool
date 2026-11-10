/**
 * Guest conversations, read from Smoobu and answered through it.
 *
 * Smoobu already brings every channel's messages into one place — an
 * Airbnb guest and a Booking.com guest land in the same inbox — so this
 * does not store conversations. It reads them when asked, and keeps only
 * what Smoobu cannot tell it: which conversation has a message nobody
 * here has read yet.
 *
 * ## Plain text only
 *
 * Messages arrive as text and as HTML, and sometimes the text is empty
 * and only the HTML is filled. The HTML is the guest's, or the channel's,
 * and it is never rendered: it is reduced to text here, so nothing a
 * guest typed can run in the app.
 */

const smoobu = require('./smoobu');
const { getAll, getOne, run } = require('../db/database');

/** HTML to readable text: line breaks kept, tags and entities gone. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The words of a message, from whichever field has them.
 *
 * The docs name the HTML field `htmlMessage` in one place and
 * `messageHtml` in the example beside it, so both are read.
 */
function textOf(m = {}) {
  const plain = String(m.message || m.text_content || '').trim();
  if (plain) return plain;
  return stripHtml(m.messageHtml || m.htmlMessage || m.html_content || '');
}

/** One message as the screen wants it. */
function normaliseMessage(m) {
  return {
    id: Number(m.id),
    // 1 is the inbox — written by the guest. 2 is the outbox — by you.
    from: Number(m.type) === 1 ? 'guest' : 'you',
    subject: m.subject || '',
    text: textOf(m),
  };
}

/**
 * The whole conversation for one booking, oldest first.
 *
 * Paged by Smoobu; read to the end, with a ceiling so a runaway thread
 * cannot hold a request open.
 */
async function conversation(bookingSmoobuId, apiKey, { maxPages = 10 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await smoobu.getMessages(bookingSmoobuId, { page }, apiKey);
    const rows = (data && data.messages) || [];
    out.push(...rows.map(normaliseMessage));
    const pages = Number(data && data.page_count) || 1;
    if (page >= pages || rows.length === 0) break;
  }
  // Ids increase as messages are written, and Smoobu gives no per-message
  // time, so the id is the order.
  return out.filter((m) => m.text).sort((a, b) => a.id - b.id);
}

/**
 * Every conversation for these properties, newest activity first.
 *
 * `properties` are local rows; Smoobu filters by its own apartment ids,
 * and a thread for an apartment this account cannot see is dropped
 * rather than shown.
 */
async function threads(properties, apiKey, { maxPages = 5 } = {}) {
  const bySmoobu = new Map(properties.map((p) => [String(p.smoobu_id), p]));
  if (bySmoobu.size === 0) return [];

  const raw = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await smoobu.getThreads(
      { page, pageSize: 50, apartments: [...bySmoobu.keys()].map(Number) }, apiKey
    );
    const rows = (data && data.threads) || [];
    raw.push(...rows);
    const pages = Number(data && data.page_count) || 1;
    if (page >= pages || rows.length === 0) break;
  }

  const state = await getAll('SELECT * FROM guest_message_state');
  const unreadFor = new Map(state.map((s) => [String(s.booking_smoobu_id), s]));

  return raw
    .map((t) => {
      const property = bySmoobu.get(String(t.apartment && t.apartment.id));
      if (!property || !t.booking) return null;
      const latest = t.latest_message || {};
      const st = unreadFor.get(String(t.booking.id));
      return {
        booking_id: Number(t.booking.id),
        guest_name: t.booking.guest_name || 'Guest',
        property_id: property.id,
        property: property.name,
        latest: {
          id: Number(latest.id) || null,
          text: textOf(latest).slice(0, 160),
          // "YYYY-MM-DD HH:MM:SS", Smoobu's own clock.
          at: latest.created_at || null,
        },
        unread: isUnread(st),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.latest.at || '').localeCompare(String(a.latest.at || '')));
}

/** A guest message has arrived that nobody here has opened since. */
function isUnread(st) {
  if (!st || !st.last_guest_message_id) return false;
  return Number(st.last_guest_message_id) > Number(st.read_through_id || 0);
}

/** The webhook saw a guest write. */
async function recordGuestMessage(bookingSmoobuId, messageId, propertyId) {
  await run(
    `INSERT INTO guest_message_state (booking_smoobu_id, property_id, last_guest_message_id, last_guest_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (booking_smoobu_id) DO UPDATE SET
       last_guest_message_id = GREATEST(COALESCE(guest_message_state.last_guest_message_id, 0), EXCLUDED.last_guest_message_id),
       last_guest_at = NOW(),
       property_id = COALESCE(EXCLUDED.property_id, guest_message_state.property_id)`,
    [bookingSmoobuId, propertyId, messageId]
  );
}

/**
 * Read up to here — by opening it, or by answering from anywhere.
 *
 * A reply sent from Airbnb or Smoobu directly arrives as a host message,
 * and a conversation somebody has answered is not waiting on them.
 */
async function markRead(bookingSmoobuId, throughId, propertyId = null) {
  if (!throughId) return;
  await run(
    `INSERT INTO guest_message_state (booking_smoobu_id, property_id, read_through_id, read_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (booking_smoobu_id) DO UPDATE SET
       read_through_id = GREATEST(COALESCE(guest_message_state.read_through_id, 0), EXCLUDED.read_through_id),
       read_at = NOW()`,
    [bookingSmoobuId, propertyId, throughId]
  );
}

/** How many conversations are waiting, for the tab badge. */
async function unreadCount(propertyIds = null) {
  const rows = await getAll(
    propertyIds === null ?
      'SELECT * FROM guest_message_state' :
      'SELECT * FROM guest_message_state WHERE property_id = ANY($1)',
    propertyIds === null ? [] : [propertyIds]
  );
  return rows.filter(isUnread).length;
}

module.exports = {
  conversation, threads, recordGuestMessage, markRead, unreadCount,
  normaliseMessage, textOf, stripHtml, isUnread,
};
