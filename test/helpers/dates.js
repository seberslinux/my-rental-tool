/**
 * Dates for tests, named after what they mean.
 *
 * A date that reaches the server is measured against the real clock. The
 * assign route refuses a day that has gone; a completed clean that has
 * not happened yet is a contradiction. So a test that types '2026-08-19'
 * is not saying "a day" — it is saying "the 19th of August 2026", which
 * was a Wednesday in the future when it was written and is a Wednesday in
 * the past now. Twice this has turned a working app into six red tests.
 *
 * These say the thing the test actually depends on. `inDays(3)` is a day
 * that has not arrived; `daysAgo(30)` is one that has been and gone. Read
 * back in a year they still mean that.
 *
 * Fixed dates remain correct where no clock is involved — a pure function
 * handed an explicit `today` is a calculation, and pinning its inputs is
 * what makes it reproducible. This is only for dates the running system
 * will judge against the present.
 */

const DAY = 86400000;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Today, as the server will see it. */
function todayISO() {
  return iso(Date.now());
}

/** A day that has not arrived yet — for anything being scheduled. */
function inDays(n = 1) {
  if (n < 1) throw new Error('inDays is for the future; use daysAgo or todayISO');
  return iso(Date.now() + n * DAY);
}

/** A day that has been and gone — for anything already done. */
function daysAgo(n = 1) {
  if (n < 1) throw new Error('daysAgo is for the past; use inDays or todayISO');
  return iso(Date.now() - n * DAY);
}

/**
 * Which weekday a date falls on, 0–6.
 *
 * For the tests that need a cleaner to be free on the day in question.
 * Pinning those to a particular Saturday hid the requirement: any future
 * date made them pass while testing nothing.
 */
function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

module.exports = { todayISO, inDays, daysAgo, weekdayOf };
