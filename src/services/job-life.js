/**
 * Is this cleaning job still somebody's commitment?
 *
 * Four places asked that question and three of them asked it as
 * `status != 'completed'`, which quietly answers yes for a job the
 * cleaner has turned down. The consequences ran in both directions:
 * a declined job counted as cover on the calendar, and it also locked
 * the cleaner out of every other property that day, because the
 * assignment guard read it as "already booked". Saying no to one
 * morning's work removed you from the whole day.
 *
 * There are two questions here and they are not the same one:
 *
 *   stillOn    — is this a real commitment? Counts as cover, and uses
 *                up that cleaner's day. Everything except a refusal.
 *   stillToDo  — is this work outstanding? Earns a reminder. Not a
 *                refusal, and not something already finished.
 *
 * Both are defined once, in SQL and in JavaScript, so the database and
 * the code cannot drift apart on them.
 */

/** A job that is no longer anybody's: turned down, or called off. */
const REFUSED = ['declined', 'cancelled'];

/** Counts as cover, and occupies the cleaner's day. */
const stillOn = (job) => !REFUSED.includes(job && job.status);
const STILL_ON_SQL = "status NOT IN ('declined', 'cancelled')";

/** Work that has not happened yet, so it is worth a reminder. */
const stillToDo = (job) => ['pending', 'confirmed', 'in_progress'].includes(job && job.status);
const STILL_TO_DO_SQL = "status IN ('pending', 'confirmed', 'in_progress')";

module.exports = { stillOn, stillToDo, STILL_ON_SQL, STILL_TO_DO_SQL, REFUSED };
