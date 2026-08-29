/**
 * One place that decides who gets told what.
 *
 * Before this, four call sites reached for `whatsapp.sendMessage`
 * directly, each with its own message text, its own idea of who to send
 * to, and a `catch` that logged and moved on. That is why every cleaning
 * job in production read `notified = 0` while the app reported it
 * assigned: the sends had been failing since March, and nothing anywhere
 * said so.
 *
 * ## The rule
 *
 * Everything is recorded. Only exceptions are sent.
 *
 * Two properties produce roughly four check-in and check-out events a
 * day. On WhatsApp that is noise an owner mutes within a week, and a
 * muted channel is worse than no channel — the one message that mattered
 * arrives in a thread nobody opens any more. So routine events land in
 * the activity feed, and WhatsApp is kept for the things that need
 * somebody to act: a cleaner said no, nobody is assigned, a clean has
 * not started when it should have, something is broken.
 *
 * ## Why a template rather than plain text
 *
 * WhatsApp only delivers free-form messages inside a 24-hour window that
 * opens when the recipient messages you. Outside it Meta accepts the
 * call, hands back a message id, and delivers nothing. That is worse
 * than an error: every signal says it worked. Set
 * WHATSAPP_ALERT_TEMPLATE to an approved template with a single body
 * variable and alerts arrive whether or not a window is open; without
 * it, sends still go out and the row says plainly that they may not
 * land.
 *
 * ## Delivery is reported, never swallowed
 *
 * A notification row is written whether or not a send is attempted, and
 * carries what happened to it. `skipped` means we chose not to send.
 * `failed` carries the provider's own message, which is far more use
 * than anything invented here — "Session has expired" told us more than
 * a week of guessing would have.
 */

const { getAll, getOne, run } = require('../db/database');
const whatsapp = require('./whatsapp');
const push = require('./push');
const { normalizePhone } = require('./phone');

/**
 * What each event is, whether it interrupts anybody, and who it is for.
 *
 * Adding an event means adding a line here rather than a send call
 * somewhere in a route — which is how the old ones drifted apart.
 *
 * Most of these are the owner's: they report on the property and the
 * people working on it. A few are the cleaner's own — their job, their
 * shift, their reminder — and those have `audience: 'cleaner'`.
 *
 * The distinction decides three things at once: whose phone it goes to,
 * whose feed it appears in, and whether it interrupts. For the owner,
 * WhatsApp is the exception channel and the feed is the record. For the
 * cleaner it is the other way round: they are not sitting in front of
 * this app, so a job they have been given has to reach their phone
 * whatever its severity. A cleaner who is not told is a property that is
 * not cleaned.
 */
const EVENTS = {
  // Money arriving, money leaving, money moving. The webhook has been
  // writing these to the database without telling anybody since it was
  // written — a booking could arrive overnight and the first you knew
  // was noticing it on the calendar the next day.
  booking_created: { severity: 'attention' },
  booking_cancelled: { severity: 'attention' },
  booking_changed: { severity: 'info' },

  cleaning_started: { severity: 'info' },
  cleaning_finished: { severity: 'info' },
  checklist_saved: { severity: 'info' },
  job_accepted: { severity: 'info' },
  // Worth knowing — it is what stops you assigning somebody who cannot
  // come — but it is not a request, so it does not interrupt.
  availability_changed: { severity: 'info' },

  job_declined: { severity: 'attention' },
  job_unassigned: { severity: 'attention' },
  cleaning_overdue: { severity: 'attention' },
  issue_reported: { severity: 'attention' },
  supplies_needed: { severity: 'attention' },
  // Nobody has answered a request that is nearly due. The owner has to
  // know while there is still time to ask somebody else.
  job_unanswered: { severity: 'attention' },
  // Nobody can clean it, so nobody has been sent. The manager decides
  // whether to take the nights off sale; this app no longer decides for
  // them.
  job_unstaffed: { severity: 'attention' },
  property_blocked: { severity: 'info' },
  // Half a sync is not a sync. Rates failed silently for months behind a
  // "Synced 1d ago" that was telling the truth about bookings only.
  sync_incomplete: { severity: 'attention' },

  // The cleaner's own. Each of these replaces a bare whatsapp.sendMessage
  // that reported nothing and was recorded nowhere — which is how every
  // job in production came to read notified = 0 while the app said it had
  // been assigned.
  job_assigned: { severity: 'attention', audience: 'cleaner' },
  job_cancelled: { severity: 'attention', audience: 'cleaner' },
  // A clean that moved day. Nothing told the cleaner at all before: the
  // date simply changed underneath them.
  job_rescheduled: { severity: 'attention', audience: 'cleaner' },
  job_reminder: { severity: 'attention', audience: 'cleaner' },
  job_upcoming: { severity: 'info', audience: 'cleaner' },
};

/**
 * Which events actually go out, as a setting rather than a constant.
 *
 * The split between "record it" and "send it" is a judgement about noise,
 * and judgements about noise are only testable by living with them. It is
 * stored in app_settings so it can be turned up or down without a deploy:
 * a comma-separated list of event names, or the word "all".
 *
 * Default is the attention events. Two properties produce roughly four
 * check-in and check-out events a day, and a channel that pings four
 * times a day gets muted — after which the one message that mattered
 * arrives in a thread nobody opens.
 */
async function sendableEvents() {
  const row = await getOne("SELECT value FROM app_settings WHERE key = 'notify_whatsapp_events'");
  const raw = (row && row.value || '').trim();
  if (!raw) return null; // null means "use the severity default"
  if (raw === 'all') return Object.keys(EVENTS);
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The cleaner's own number.
 *
 * Deliberately not routed through the opt-in that governs owners. That
 * setting is somebody choosing whether to hear about their business; this
 * is the only way a cleaner learns they have been given a shift, and a
 * cleaner who is not told is a property that is not cleaned. If they
 * should stop receiving work, the answer is to unassign them, not to
 * leave them assigned and silent.
 */
async function cleanerRecipients(cleanerId) {
  if (!cleanerId) return [];
  const row = await getOne('SELECT phone FROM cleaners WHERE id = $1', [cleanerId]);
  const n = normalizePhone(row && row.phone || '');
  // A local number with no country code cannot be dialled by the API, and
  // guessing a country from a leading zero is how you message a stranger.
  return n && !n.startsWith('0') ? [n] : [];
}

/**
 * Everyone who should hear about a property.
 *
 * The owner and any property manager, by phone. Users mostly have no
 * phone number on file, so ADMIN_WHATSAPP remains the backstop — without
 * it an "attention" event would be recorded and delivered to nobody.
 */
/**
 * Who to push to, as user ids.
 *
 * Deliberately not gated on notify_whatsapp. That flag is consent to be
 * messaged on WhatsApp, and reusing it here would mean somebody who
 * turned WhatsApp off could never be told anything. Subscribing a device
 * is the consent for push, and it is revocable from the same switch that
 * granted it.
 */
async function pushRecipientsFor(propertyId) {
  const rows = propertyId ?
  await getAll(
    `SELECT DISTINCT u.id FROM users u
       LEFT JOIN user_properties up ON up.user_id = u.id
      WHERE COALESCE(u.active, 1) <> 0
        AND (u.role = 'admin' OR up.property_id = $1)`,
    [propertyId]
  ) :
  await getAll(
    `SELECT id FROM users WHERE COALESCE(active, 1) <> 0 AND role = 'admin'`
  );
  return rows.map((r) => r.id);
}

async function recipientsFor(propertyId) {
  const numbers = new Set();

  // Only people who asked for it. The feed reaches everybody; WhatsApp
  // reaches whoever turned it on. A channel nobody opted into is the
  // fastest way to have it muted, after which the one message that
  // mattered lands in a thread nobody opens.
  const rows = propertyId
    ? await getAll(
        `SELECT DISTINCT u.phone FROM users u
          WHERE u.phone IS NOT NULL AND u.phone <> ''
            AND COALESCE(u.active, 1) <> 0
            AND COALESCE(u.notify_whatsapp, 0) <> 0
            AND (u.role = 'admin'
                 OR u.id = (SELECT owner_user_id FROM properties WHERE id = $1)
                 OR EXISTS (SELECT 1 FROM user_property_access a
                             WHERE a.user_id = u.id AND a.property_id = $1))`,
        [propertyId]
      )
    : await getAll(
        `SELECT DISTINCT phone FROM users
          WHERE phone IS NOT NULL AND phone <> '' AND COALESCE(active, 1) <> 0
            AND COALESCE(notify_whatsapp, 0) <> 0 AND role = 'admin'`
      );

  rows.forEach((r) => {
    const n = normalizePhone(r.phone);
    if (n && !n.startsWith('0')) numbers.add(n);
  });

  // A configured admin number still counts as somebody having asked.
  const fallback = normalizePhone(process.env.ADMIN_WHATSAPP || '');
  if (fallback && !fallback.startsWith('0')) numbers.add(fallback);

  return [...numbers];
}

/**
 * Record something that happened, and tell somebody if it matters.
 *
 * Never throws. A notification failing must not roll back the thing it
 * was describing — a cleaner who has finished has finished, whether or
 * not the owner's phone was reachable.
 */
async function notify({
  event, title, body = '', propertyId = null, cleanerId = null, jobId = null,
  /**
   * Where the message should take them, relative to the app root.
   *
   * This is the reason a notification beats an alert: the owner does not
   * want to be told the shower is broken, they want to be one tap from
   * the screen where they can do something about it.
   */
  link = null,
  /**
   * The facts behind the sentence, for a message that can be acted on.
   *
   * The prose already contains them — which property, which nights — but
   * not in a shape a button can use. Anything here is rendered as an
   * action rather than read.
   */
  meta = null,
}) {
  const spec = EVENTS[event];
  if (!spec) {
    console.error(`notify: unknown event "${event}" — recording it as info`);
  }
  const severity = spec ? spec.severity : 'info';
  const audience = spec && spec.audience === 'cleaner' ? 'cleaner' : 'owner';

  // The owner's events are filtered for noise; the cleaner's are not.
  // Two properties produce roughly four check-in and check-out events a
  // day and an owner mutes that within a week, so their WhatsApp is kept
  // for exceptions. A cleaner only ever hears about their own shifts, and
  // every one of them is something they have to act on.
  const configured = await sendableEvents();
  let shouldSend = audience === 'cleaner' ?
  true :
  configured ? configured.includes(event) : severity === 'attention';

  let delivery = 'skipped';
  let deliveryError = null;
  let channel = 'in_app';

  /**
   * Push, to whoever this is for.
   *
   * Independent of the WhatsApp decision below on purpose. WhatsApp is
   * opt-in per person and gated by an allowed list we do not control —
   * production has been refusing job assignments with "Recipient phone
   * number not in allowed list" while the cleaner heard nothing. A
   * device that has asked to be told is told, whatever WhatsApp is doing.
   *
   * Never allowed to throw: a notification that cannot be delivered must
   * still be recorded, because the feed is the record.
   */
  let pushed = 0;
  if (push.isConfigured()) {
    try {
      const base = (process.env.APP_URL || '').replace(/\/$/, '');
      const targets = audience === 'cleaner' ?
      [{ cleanerId }] :
      (await pushRecipientsFor(propertyId)).map((id) => ({ userId: id }));

      for (const who of targets) {
        if (!who.cleanerId && !who.userId) continue;
        const result = await push.sendTo(who, {
          title,
          body,
          link: base && link ? `${base}${link}` : link || '/',
          tag: jobId ? `job-${jobId}` : event,
        });
        pushed += result.sent;
      }
    } catch (err) {
      console.error('Push delivery failed:', err.message);
    }
  }

  // Switched off is not the same as broken.
  //
  // With no token and no phone number id every send is three doomed HTTP
  // attempts two seconds apart, and the row lands as `failed` carrying
  // "Invalid OAuth access token" — which then shows up in the cleaner's
  // app as "not delivered to your phone" on every message they have. The
  // app is the channel while WhatsApp is off, and saying so is honest;
  // crying failure on every row is not, and it trains people to ignore
  // the warning that means something.
  if (shouldSend && !whatsapp.isConfigured()) {
    shouldSend = false;
    deliveryError = 'WhatsApp is off — this is in the app only';
  }

  if (shouldSend) {
    const numbers = audience === 'cleaner' ?
    await cleanerRecipients(cleanerId) :
    await recipientsFor(propertyId);
    if (numbers.length === 0) {
      // Not a failure. The notification is in the feed, which is the
      // record; nobody has simply asked to be messaged as well.
      delivery = 'skipped';
      deliveryError = audience === 'cleaner' ?
      'No usable phone number for this cleaner' :
      'Nobody has turned on WhatsApp alerts';
    } else {
      channel = 'whatsapp';
      const base = (process.env.APP_URL || '').replace(/\/$/, '');
      const url = link && base ? `${base}${link}` : null;
      const text = [title, body, url].filter(Boolean).join('\n');

      // Template, not free text.
      //
      // WhatsApp only delivers free-form messages inside a 24-hour window
      // that opens when the recipient messages you. Outside it, Meta
      // accepts the call, returns a message id, and delivers nothing —
      // the worst possible failure, because every signal says it worked.
      // We watched two "successful" sends go nowhere before a template
      // arrived first time.
      //
      // Variables cannot contain newlines, so the pieces are joined with
      // a separator rather than laid out in lines.
      const templateName = process.env.WHATSAPP_ALERT_TEMPLATE;
      const failures = [];
      for (const to of numbers) {
        try {
          if (templateName) {
            await whatsapp.sendTemplateMessage(to, templateName, [
              { type: 'body', parameters: [{ type: 'text', text: [title, body, url].filter(Boolean).join(' · ') }] },
            ]);
          } else {
            await whatsapp.sendMessage(to, text);
          }
        } catch (err) {
          failures.push(err.response?.data?.error?.message || err.message);
        }
      }
      if (failures.length === numbers.length) {
        delivery = 'failed';
        deliveryError = failures[0];
      } else {
        delivery = 'sent';
        if (failures.length) {
          deliveryError = `${failures.length} of ${numbers.length} failed: ${failures[0]}`;
        } else if (!templateName) {
          // Recorded as sent because Meta accepted it, with the caveat
          // attached. Claiming a clean success here would repeat exactly
          // the blindness this module exists to end.
          deliveryError = 'Sent as free-form text — WhatsApp drops these outside a 24h window. Set WHATSAPP_ALERT_TEMPLATE.';
        }
      }
    }
    if (delivery === 'failed') {
      console.error(`notify: ${event} not delivered — ${deliveryError}`);
    }
  }

  try {
    await run(
      `INSERT INTO notifications
         (event, property_id, cleaner_id, job_id, title, body, link, severity, audience, channel, delivery, delivery_error, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [event, propertyId, cleanerId, jobId, title, body, link, severity, audience, channel, delivery, deliveryError,
       meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    // The last resort. If even recording fails, say so loudly rather
    // than letting the caller believe somebody was told.
    console.error(`notify: could not record ${event} — ${err.message}`);
  }

  return { severity, audience, delivery, deliveryError };
}

/** The activity feed, newest first. */
async function recent({ limit = 50, propertyIds = null } = {}) {
  if (propertyIds && propertyIds.length === 0) return [];
  const params = [Math.min(Number(limit) || 50, 200)];
  let scope = '';
  if (propertyIds) {
    scope = ` AND (n.property_id IS NULL OR n.property_id = ANY($2))`;
    params.push(propertyIds);
  }
  return getAll(
    `SELECT n.*, p.name AS property_name, c.name AS cleaner_name
       FROM notifications n
       LEFT JOIN properties p ON p.id = n.property_id
       LEFT JOIN cleaners c ON c.id = n.cleaner_id
      WHERE n.audience = 'owner' AND n.dismissed_at IS NULL${scope}
      ORDER BY n.created_at DESC
      LIMIT $1`,
    params
  );
}

/**
 * One cleaner's own feed.
 *
 * Scoped by audience as well as by id, because cleaner_id is also set on
 * the owner's rows — "Jane declined Friday" is about Jane and for the
 * owner. Matching on the id alone would show her the commentary on her
 * own work.
 */
async function recentForCleaner(cleanerId, { limit = 50 } = {}) {
  if (!cleanerId) return [];
  return getAll(
    `SELECT n.id, n.event, n.title, n.body, n.link, n.severity,
            n.delivery, n.created_at, n.read_at, p.name AS property_name
       FROM notifications n
       LEFT JOIN properties p ON p.id = n.property_id
      WHERE n.audience = 'cleaner' AND n.cleaner_id = $1 AND n.dismissed_at IS NULL
      ORDER BY n.created_at DESC
      LIMIT $2`,
    [cleanerId, Math.min(Number(limit) || 50, 200)]
  );
}

module.exports = { notify, recent, recentForCleaner, recipientsFor, pushRecipientsFor, EVENTS };
