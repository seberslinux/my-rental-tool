/**
 * Messages to cleaners go over WhatsApp.
 *
 * ## Why a template, and not just text
 *
 * WhatsApp only allows free-form messages inside a 24-hour window that
 * opens when the *cleaner* messages *you*. Everything this app sends is
 * app-initiated — a job assigned at 04:00, an invitation sent while the
 * cleaner is asleep — so it falls outside that window and must be an
 * approved template.
 *
 * The existing job notifications call the free-form sender, which is why
 * all fourteen cleaning jobs in production still read `notified = 0`
 * even before the access token expired. They would have been rejected
 * anyway.
 *
 * ## Why failures are returned rather than thrown
 *
 * The assignment code caught send errors, logged them, and carried on
 * reporting the job as assigned. Nobody was told, and nothing on any
 * screen said so. A caller here gets `{ sent: false, reason }` and is
 * expected to surface it: a message that silently did not arrive is
 * worse than one that visibly did not.
 *
 * ## Setup this needs
 *
 *   WHATSAPP_TOKEN            a permanent System User token. The one in
 *                             production expired on 16 March 2026 —
 *                             temporary tokens always do.
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number.
 *   WHATSAPP_INVITE_TEMPLATE  name of an approved template whose button
 *                             URL ends in a dynamic segment, so the
 *                             token can be appended per message.
 */

const whatsapp = require('./whatsapp');
const { normalizePhone } = require('./phone');

/**
 * WhatsApp addresses a recipient by digits with no leading +.
 *
 * A number kept in national form ("082…") cannot be addressed at all:
 * nothing in it says which country, and guessing is how a German
 * cleaner's number would acquire a South African prefix. Refused with a
 * reason rather than sent somewhere arbitrary.
 */
function toWhatsAppNumber(raw) {
  const digits = normalizePhone(raw);
  if (!digits) return { error: 'No phone number on this profile' };
  if (digits.startsWith('0')) {
    return { error: 'Phone number needs a country code, e.g. +27 82 123 4567' };
  }
  return { number: digits };
}

/** True when the environment can actually send anything. */
function invitesConfigured() {
  return Boolean(
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_INVITE_TEMPLATE
  );
}

/**
 * Send a cleaner their invitation link.
 *
 * The template carries the cleaner's name in the body and the invite
 * token as the dynamic tail of its URL button, so Meta renders a real
 * button rather than a bare link in the text — which is also what stops
 * it looking like the phishing it would otherwise resemble.
 *
 * Never throws. The caller always has the link to fall back on.
 */
async function sendInviteLink({ cleaner, token }) {
  if (!invitesConfigured()) {
    return { sent: false, reason: 'WhatsApp is not configured for invitations' };
  }

  const { number, error } = toWhatsAppNumber(cleaner.phone);
  if (error) return { sent: false, reason: error };

  try {
    await whatsapp.sendTemplateMessage(number, process.env.WHATSAPP_INVITE_TEMPLATE, [
      {
        type: 'body',
        parameters: [{ type: 'text', text: cleaner.name || 'there' }],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: token }],
      },
    ]);
    return { sent: true };
  } catch (err) {
    // Meta's own message is far more useful than anything invented here
    // — "Session has expired", "template not found", "not opted in".
    const reason = err.response?.data?.error?.message || err.message;
    console.error(`WhatsApp invite to ${cleaner.name} failed: ${reason}`);
    return { sent: false, reason };
  }
}

module.exports = { sendInviteLink, toWhatsAppNumber, invitesConfigured };
