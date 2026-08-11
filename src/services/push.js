/**
 * Web push.
 *
 * The reason this exists: on an iPhone a web app can only be notified
 * once it is on the Home Screen, and the WhatsApp path this replaces is
 * refusing to deliver — production logs show job assignments met with
 * "(#131030) Recipient phone number not in allowed list". Cleaners were
 * being given work and never told.
 *
 * A VAPID keypair identifies this server to Apple's and Google's push
 * services. One pair serves every subscriber, so the same keys reach the
 * owner and every cleaner; there is no per-person registration and no
 * allowed list to be kept off.
 *
 * Subscriptions rot. A phone reinstalls, a browser clears storage, and
 * the endpoint stays in the table pointing at nothing. The push service
 * says so with a 404 or 410, and the only correct response is to forget
 * it — kept, they would be retried forever.
 */

const webpush = require('web-push');
const { getAll, run } = require('../db/database');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || '';

let ready = false;
if (PUBLIC_KEY && PRIVATE_KEY && SUBJECT) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    ready = true;
  } catch (err) {
    console.error('Web push disabled — bad VAPID configuration:', err.message);
  }
}

/** Whether push can be sent at all. False locally, where no keys are set. */
function isConfigured() {
  return ready;
}

function publicKey() {
  return ready ? PUBLIC_KEY : null;
}

/**
 * Send to every device belonging to one person.
 *
 * `who` is { userId } or { cleanerId }. Returns how many devices took it,
 * so the caller can record whether anything actually left the building.
 */
async function sendTo(who, { title, body = '', link = '/', tag = null }) {
  if (!ready) return { sent: 0, gone: 0 };

  const rows = who.cleanerId ?
  await getAll('SELECT * FROM push_subscriptions WHERE cleaner_id = $1', [who.cleanerId]) :
  await getAll('SELECT * FROM push_subscriptions WHERE user_id = $1', [who.userId]);

  let sent = 0;
  let gone = 0;

  for (const row of rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({ title, body, link, tag })
      );
      sent += 1;
    } catch (err) {
      // 404 and 410 mean the subscription is dead — the app was deleted,
      // or the browser dropped it. Anything else is worth keeping.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await run('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
        gone += 1;
      } else {
        console.error('Push failed:', err.statusCode, err.message);
      }
    }
  }

  return { sent, gone };
}

module.exports = { isConfigured, publicKey, sendTo };
