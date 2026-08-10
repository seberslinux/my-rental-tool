/**
 * Is this property clean?
 *
 * One question, asked in three places: the home screen shows the answer,
 * the planner decides whether a booking needs a clean before it, and the
 * cleaner's job is what changes it. Computed, never stored — a status
 * column drifts from the jobs and stays that produced it, and then there
 * are two answers to a question that has one.
 *
 * ## Ready has a shelf life
 *
 * A property cleaned on Monday and untouched since is still clean on
 * Tuesday. Ten days later it is dusty. That is the whole of the
 * "still clean" rule: `ready` expires after so many nights, and past that
 * the property wants a freshen before the next arrival rather than a full
 * turnover.
 *
 * Blocked nights do not count as anybody staying. Smoobu writes those for
 * maintenance and for its own turnaround padding, and nobody sleeps in
 * them — treating one as a guest would send a cleaner to a property that
 * was never dirtied.
 *
 * ## Two ways to say "it is clean"
 *
 * A cleaner tapping Finished, and a manager saying so. They are the same
 * kind of fact — the property was clean at a moment in time — so they are
 * one input here, not a status and an override fighting each other. A
 * manager marking it clean resets the shelf life exactly as a real clean
 * would, because that is what they are asserting.
 */

const { isBlockedPlatform } = require('./analytics-calc');

/** How long `ready` lasts, unless a property says otherwise. */
const DEFAULT_FRESH_NIGHTS = 3;

/** A date as YYYY-MM-DD, whatever the driver handed back. */
function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

/** Whole nights between two YYYY-MM-DD dates. */
function nightsBetween(from, to) {
  return Math.round(
    (new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000
  );
}

/**
 * The state of one property on a given day.
 *
 * `stays` and `jobs` are that property's own, unfiltered — the caller
 * loads once for a whole portfolio rather than querying per property.
 *
 * Returns the status, when it was last known clean, and the day `ready`
 * runs out. The planner needs that expiry; a person needs the status.
 */
function propertyStatus({ property, stays = [], jobs = [], today }) {
  const day = ymd(today) || new Date().toISOString().slice(0, 10);
  const freshNights = Number(property.clean_fresh_nights) > 0 ?
  Number(property.clean_fresh_nights) :
  DEFAULT_FRESH_NIGHTS;

  const guestStays = stays.filter(
    (s) => s.status === 'confirmed' && !isBlockedPlatform(s.platform)
  );

  // Somebody in the property right now beats everything else: it is not
  // clean, not dirty, it is occupied, and no cleaner is going in.
  const occupying = guestStays.find(
    (s) => ymd(s.check_in) <= day && day < ymd(s.check_out)
  );
  if (occupying) {
    return {
      status: 'occupied',
      cleanSince: null,
      readyUntil: null,
      detail: `Guests until ${ymd(occupying.check_out)}`,
    };
  }

  const working = jobs.find((j) => j.started_at && !j.completed_at);
  if (working) {
    return { status: 'cleaning', cleanSince: null, readyUntil: null, detail: 'A cleaner is there now' };
  }

  // The last moment anybody asserted this property was clean, from either
  // source. A manager saying so counts exactly as much as a finished job,
  // because it is the same claim.
  const finished = jobs.
  filter((j) => j.completed_at).
  map((j) => new Date(j.completed_at));
  if (property.marked_clean_at) finished.push(new Date(property.marked_clean_at));
  const cleanAt = finished.length ? new Date(Math.max(...finished)) : null;

  // "Actually, it needs doing" — a manager overruling a clean that
  // happened but did not stick.
  const dirtyAt = property.marked_dirty_at ? new Date(property.marked_dirty_at) : null;
  if (cleanAt && dirtyAt && dirtyAt > cleanAt) {
    return { status: 'dirty', cleanSince: null, readyUntil: null, detail: 'Marked as needing a clean' };
  }
  if (!cleanAt) {
    return { status: 'dirty', cleanSince: null, readyUntil: null, detail: 'No clean on record' };
  }

  const cleanDay = ymd(cleanAt);

  // Anybody stayed since it was cleaned? Then it is dirty again,
  // whatever the clock says.
  const stayedSince = guestStays.some(
    (s) => ymd(s.check_out) > cleanDay && ymd(s.check_in) <= day
  );
  if (stayedSince) {
    return { status: 'dirty', cleanSince: cleanDay, readyUntil: null, detail: 'Guests have been in since' };
  }

  const readyUntil = ymd(new Date(new Date(`${cleanDay}T00:00:00`).getTime() + freshNights * 86400000));
  if (nightsBetween(cleanDay, day) > freshNights) {
    return {
      status: 'stale',
      cleanSince: cleanDay,
      readyUntil,
      detail: `Cleaned ${nightsBetween(cleanDay, day)} nights ago`,
    };
  }

  return { status: 'ready', cleanSince: cleanDay, readyUntil, detail: `Ready until ${readyUntil}` };
}

/**
 * Will the property be clean when these guests arrive?
 *
 * The planner's question, and deliberately not the same as "is it clean
 * today" — it is asked about a date in the future, so what matters is
 * whether a clean is already going to happen in between, not whether one
 * has happened yet.
 */
function needsCleanBefore({ property, stays = [], jobs = [], arrival }) {
  const day = ymd(arrival);
  const freshNights = Number(property.clean_fresh_nights) > 0 ?
  Number(property.clean_fresh_nights) :
  DEFAULT_FRESH_NIGHTS;

  const guestStays = stays.filter(
    (s) => s.status === 'confirmed' && !isBlockedPlatform(s.platform)
  );

  // The clean that will most recently have happened by then — scheduled
  // counts, since the point is to avoid asking for a second one.
  const before = jobs.
  filter((j) => ymd(j.cleaning_date) <= day && j.status !== 'declined' && j.status !== 'cancelled').
  map((j) => ymd(j.cleaning_date)).
  sort();
  const lastCleanDay = before.length ? before[before.length - 1] : ymd(property.marked_clean_at);

  if (!lastCleanDay) return { needed: true, why: 'no clean before they arrive' };

  // Somebody leaving between that clean and the arrival dirties it again.
  const dirtiedSince = guestStays.some(
    (s) => ymd(s.check_out) > lastCleanDay && ymd(s.check_out) <= day
  );
  if (dirtiedSince) return { needed: true, why: 'guests leave after the last clean' };

  const gap = nightsBetween(lastCleanDay, day);
  if (gap > freshNights) {
    return { needed: true, why: `${gap} nights since the last clean` };
  }
  return { needed: false, why: `cleaned ${gap} night${gap === 1 ? '' : 's'} before they arrive` };
}

module.exports = { propertyStatus, needsCleanBefore, ymd, nightsBetween, DEFAULT_FRESH_NIGHTS };
