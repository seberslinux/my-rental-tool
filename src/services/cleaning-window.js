/**
 * When a cleaner may check in and out of a job.
 *
 * A clean happens on its own day, after the guest has gone. Without a
 * rule, "Start cleaning" is a button that can be pressed from the sofa a
 * week later, and the timestamps it writes are the record of when a
 * property was actually turned over — the thing the next check-in
 * depends on and, where the rate is hourly, the thing that gets paid.
 *
 * The window opens two hours before the property's check-out time.
 * Guests often leave early and a cleaner who is standing there should
 * not be locked out; two hours is enough for that without letting the
 * clean begin while the room is still occupied. It closes at the end of
 * the cleaning day.
 *
 * ## Timezone
 *
 * "Today" is the property's today, not the server's. Railway runs UTC
 * and the properties are in Cape Town, two hours ahead — so between
 * 22:00 and midnight local, a UTC server would still call it yesterday
 * and refuse a legitimate start. The zone is configurable for the day
 * this runs somewhere else.
 */

const TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Johannesburg';

// Guests leave early more often than they leave late, and a cleaner who
// has arrived should not be told to wait outside.
const EARLY_START_HOURS = 2;

const DEFAULT_CHECK_OUT_TIME = '10:00';

/** The local wall-clock date and time where the properties are. */
function localNow(now = new Date()) {
  // en-CA gives YYYY-MM-DD, which sorts and compares as a string.
  const date = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const time = now.toLocaleTimeString('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return { date, time };
}

/**
 * "HH:MM" as minutes past midnight, or null if it is not a time.
 *
 * The shape is matched before parsing because Number('') is 0, not NaN:
 * a property with no check-out time was read as midnight, which opened
 * the window at 22:00 the previous day and amounted to no guard at all.
 */
function minutesOf(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function formatMinutes(total) {
  const clamped = Math.max(0, total);
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * May this job be started or finished right now?
 *
 * Returns `{ ok: true }`, or `{ ok: false, reason }` phrased for the
 * cleaner rather than for a log — they are the one who has to act on it.
 */
function checkCleaningWindow(job, property, now = new Date()) {
  const { date, time } = localNow(now);

  if (date < job.cleaning_date) {
    return { ok: false, reason: `This clean is booked for ${job.cleaning_date}. You can start it on the day.` };
  }
  if (date > job.cleaning_date) {
    return {
      ok: false,
      reason: `This clean was booked for ${job.cleaning_date}. Ask the owner to record it for you.`,
    };
  }

  const checkOut = minutesOf(property && property.check_out_time) ?? minutesOf(DEFAULT_CHECK_OUT_TIME);
  const opens = checkOut - EARLY_START_HOURS * 60;
  const nowMins = minutesOf(time);

  if (nowMins < opens) {
    return {
      ok: false,
      reason: `Guests check out at ${formatMinutes(checkOut)}. You can start from ${formatMinutes(opens)}.`,
    };
  }

  return { ok: true };
}

module.exports = {
  checkCleaningWindow,
  localNow,
  TIMEZONE,
  EARLY_START_HOURS,
  DEFAULT_CHECK_OUT_TIME,
};
