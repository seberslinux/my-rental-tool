const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCleaningWindow } = require('../src/services/cleaning-window');

/**
 * When a cleaner may check in and out.
 *
 * The timestamps a cleaner writes are the record of when a property was
 * actually turned over — what the next check-in depends on, and what an
 * hourly rate is paid against. Without a rule, "Start cleaning" can be
 * pressed from the sofa a week later.
 *
 * The window opens two hours before check-out, because guests leave
 * early more often than late and a cleaner standing at the door should
 * not be locked out. It closes at the end of the cleaning day.
 *
 * Times below are constructed in SAST (+02:00), which is where the
 * properties are, so the assertions read as the wall clock a cleaner
 * would be looking at.
 */

const job = { cleaning_date: '2026-08-10' };
const property = { check_out_time: '10:00' };

/** A moment on a given local date, in SAST. */
const at = (date, time) => new Date(`${date}T${time}:00+02:00`);

// --- the day itself ------------------------------------------------------

test('the day before is refused', () => {
  const r = checkCleaningWindow(job, property, at('2026-08-09', '23:00'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /2026-08-10/);
});

test('the day after is refused, and points at the owner', () => {
  // Deliberate: a forgotten clean cannot be back-dated by the cleaner,
  // because the whole value of the timestamp is that it was recorded at
  // the time. The owner can still fix it.
  const r = checkCleaningWindow(job, property, at('2026-08-11', '09:00'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /owner/i);
});

// --- the two-hour opening ------------------------------------------------

test('two hours before check-out is allowed', () => {
  assert.equal(checkCleaningWindow(job, property, at('2026-08-10', '08:00')).ok, true);
});

test('a minute before that is refused, and says when they can start', () => {
  const r = checkCleaningWindow(job, property, at('2026-08-10', '07:59'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /08:00/);
  assert.match(r.reason, /10:00/, 'says when the guests actually leave');
});

test('at check-out time itself is allowed', () => {
  assert.equal(checkCleaningWindow(job, property, at('2026-08-10', '10:00')).ok, true);
});

test('late in the day is still allowed', () => {
  // A clean that runs into the evening is normal; only the day is fixed.
  assert.equal(checkCleaningWindow(job, property, at('2026-08-10', '21:30')).ok, true);
});

test('the opening follows the property, not a fixed hour', () => {
  const late = { check_out_time: '12:00' };
  assert.equal(checkCleaningWindow(job, late, at('2026-08-10', '09:59')).ok, false);
  assert.equal(checkCleaningWindow(job, late, at('2026-08-10', '10:00')).ok, true);
});

test('a property with no check-out time falls back to 10:00', () => {
  assert.equal(checkCleaningWindow(job, {}, at('2026-08-10', '07:59')).ok, false);
  assert.equal(checkCleaningWindow(job, {}, at('2026-08-10', '08:00')).ok, true);
  assert.equal(checkCleaningWindow(job, null, at('2026-08-10', '08:00')).ok, true);
});

// --- the timezone, which is the whole reason this is not a date compare --

test('late evening local time is still the same local day', () => {
  // 22:30 in Cape Town is 20:30 UTC — same day either way.
  assert.equal(checkCleaningWindow(job, property, at('2026-08-10', '22:30')).ok, true);
});

test('a UTC server must not call local evening "tomorrow"', () => {
  // 23:30 SAST on the 10th is 21:30 UTC on the 10th. Both agree here;
  // the case that bites is the reverse, below.
  assert.equal(checkCleaningWindow(job, property, at('2026-08-10', '23:30')).ok, true);
});

test('a UTC server must not call local early morning "yesterday"', () => {
  // 01:00 SAST on the 11th is 23:00 UTC on the 10th. Judged by UTC this
  // would still look like the cleaning day and wrongly pass.
  const r = checkCleaningWindow(job, property, at('2026-08-11', '01:00'));
  assert.equal(r.ok, false, 'it is already tomorrow where the property is');
});

test('just after midnight local on the cleaning day is refused for being too early', () => {
  // Right day, but hours before anyone has checked out.
  const r = checkCleaningWindow(job, property, at('2026-08-10', '00:30'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /08:00/);
});
