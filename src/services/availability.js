/**
 * One answer to "can this cleaner work that day?".
 *
 * The rule lived inside assignCleanerForCheckout, halfway down a loop
 * that also picked a cleaner, checked for clashes and sent a message. The
 * calendar needs the same answer for a hundred days at once and for
 * people it is not about to assign, and writing it a second time there is
 * how two screens start disagreeing about who is free.
 *
 * ## The rule
 *
 * A weekly schedule is the standing answer — every Sunday, say — and a
 * date override is the exception to it. The override wins outright,
 * including its hours: marking yourself available on the calendar is a
 * blanket yes, because there is nowhere on a calendar day to say "but
 * only until noon". That was already how assignment behaved; it is
 * written down here rather than left to be inferred from control flow.
 *
 * ## Why a loader
 *
 * Answering per cleaner per date with two queries each is fine for one
 * checkout and hopeless for a three-month grid — two cleaners over ninety
 * days is 360 round trips. Everything is read once, and the answers come
 * out of memory.
 */

const { getAll } = require('../db/database');

/** Minutes since midnight, or null if the time is unusable. */
function parseTime(value) {
  // Number('') is 0, not NaN, so an empty column would otherwise read as
  // midnight and silently widen everybody's day.
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** A date as YYYY-MM-DD, whatever the driver handed back. */
function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Read every cleaner's standing schedule and their exceptions, once.
 *
 * Pass cleanerIds to narrow it; omit for all of them.
 */
async function loadAvailability(cleanerIds = null) {
  const narrow = Array.isArray(cleanerIds) && cleanerIds.length > 0;
  if (Array.isArray(cleanerIds) && cleanerIds.length === 0) {
    return { schedule: new Map(), overrides: new Map() };
  }

  const weekly = narrow ?
  await getAll('SELECT * FROM cleaner_availability WHERE cleaner_id = ANY($1)', [cleanerIds]) :
  await getAll('SELECT * FROM cleaner_availability');

  const exceptions = narrow ?
  await getAll('SELECT * FROM cleaner_availability_overrides WHERE cleaner_id = ANY($1)', [cleanerIds]) :
  await getAll('SELECT * FROM cleaner_availability_overrides');

  const schedule = new Map();
  weekly.forEach((r) => {
    if (!schedule.has(r.cleaner_id)) schedule.set(r.cleaner_id, new Map());
    schedule.get(r.cleaner_id).set(Number(r.day_of_week), {
      start: parseTime(r.start_time),
      end: parseTime(r.end_time),
    });
  });

  const overrides = new Map();
  exceptions.forEach((r) => {
    if (!overrides.has(r.cleaner_id)) overrides.set(r.cleaner_id, new Map());
    overrides.get(r.cleaner_id).set(ymd(r.date), Boolean(r.available));
  });

  return { schedule, overrides };
}

/**
 * Can this cleaner work on this date?
 *
 * `window` is optional. Given one, the cleaner's hours must cover it —
 * that is what stops a 09:00–13:00 person being sent to a turnover that
 * runs to 15:00. Without one the question is simply whether the day is
 * theirs, which is what a calendar wants to show.
 *
 * Returns why, not just whether, because the calendar has to explain
 * itself: "not working Tuesdays" and "said no to that date" look the
 * same on a grid and mean different things to whoever is deciding.
 */
function cleanerDayStatus(av, cleanerId, date, window = null) {
  const key = ymd(date);
  const override = av.overrides.get(cleanerId)?.get(key);

  if (override === false) return { available: false, reason: 'unavailable that day' };
  // A date they said yes to beats the pattern, hours included: there is
  // nowhere on a calendar day to record "but only until noon".
  if (override === true) return { available: true, reason: 'available that day' };

  const dow = new Date(`${key}T00:00:00`).getDay();
  const shift = av.schedule.get(cleanerId)?.get(dow);
  if (!shift) return { available: false, reason: 'does not work that weekday' };

  if (window && shift.start !== null && shift.end !== null) {
    if (window.start < shift.start || window.end > shift.end) {
      return { available: false, reason: 'outside their hours' };
    }
  }
  return { available: true, reason: 'works that weekday' };
}

module.exports = { loadAvailability, cleanerDayStatus, parseTime, ymd };
