/**
 * What needs you this morning, and what is happening.
 *
 * The home screen used to answer both from four separate calculations —
 * a board, an attention list, a property card and a badge — each looking
 * at the data its own way. They disagreed. A cleaner who had accepted a
 * job showed as "No cleaner" on one line and "Cleaner: Francesca" would
 * have shown on another, depending which row the database returned last.
 *
 * So both answers are built here, once, from the same rows, and the
 * screen renders what it is given.
 *
 * ## What earns a place in "needs you"
 *
 * Something a person can do something about, today. A two-night gap in
 * January is a fact about January; it sat in the old attention list at
 * the same weight as a checkout this afternoon with nobody cleaning, and
 * pushed the things that mattered down the page.
 *
 * Everything here is ordered by when it bites rather than by kind,
 * because that is the order somebody would deal with them in.
 */

const { isBlockedPlatform } = require('./analytics-calc');
const { needsCleanBefore, ymd } = require('./cleaning-status');

/** Whole days from today, for ordering and for saying "tomorrow". */
function daysOut(date, today) {
  return Math.round(
    (new Date(`${ymd(date)}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000
  );
}

function whenLabel(n) {
  if (n < 0) return `${Math.abs(n)}d ago`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

/**
 * Everything the front page shows, from one pass over the same rows.
 *
 * `isFree(cleanerId, date)` answers whether somebody can work a day —
 * passed in rather than queried here so this stays testable without a
 * database, and so it is the same answer assignment uses.
 */
function buildToday({
  properties = [], stays = [], jobs = [], issues = [], blocks = [],
  isFree = () => true, today, horizonDays = 2,
}) {
  const day = ymd(today) || new Date().toISOString().slice(0, 10);
  const propertyName = (id) => (properties.find((p) => p.id === id) || {}).name || 'A property';

  const guestStays = stays.filter(
    (s) => s.status === 'confirmed' && !isBlockedPlatform(s.platform)
  );

  // A job counts as cover only if a real person is going. A declined one
  // is a refusal, and a row whose cleaner was deleted is nobody.
  const staffedOn = (propertyId, date) =>
  jobs.filter(
    (j) => j.property_id === propertyId && ymd(j.cleaning_date) === ymd(date) &&
    j.cleaner_id && j.cleaner_name && !['declined', 'cancelled'].includes(j.status)
  );

  const needs = [];
  const add = (n) => needs.push(n);

  // --- what is happening, and who is on it -------------------------------

  const board = [];
  guestStays.forEach((s) => {
    const outIn = daysOut(s.check_out, day);
    const inIn = daysOut(s.check_in, day);

    if (outIn >= 0 && outIn <= horizonDays) {
      const cover = staffedOn(s.property_id, s.check_out)[0] || null;
      board.push({
        key: `out:${s.smoobu_id}`,
        kind: 'out',
        date: ymd(s.check_out),
        when: whenLabel(outIn),
        sortAt: outIn,
        guest: s.guest_name || 'Guest',
        property: propertyName(s.property_id),
        property_id: s.property_id,
        cleaner: cover ? { name: cover.cleaner_name, status: cover.status } : null,
      });
    }
    if (inIn >= 0 && inIn <= horizonDays) {
      board.push({
        key: `in:${s.smoobu_id}`,
        kind: 'in',
        date: ymd(s.check_in),
        when: whenLabel(inIn),
        sortAt: inIn,
        guest: s.guest_name || 'Guest',
        property: propertyName(s.property_id),
        property_id: s.property_id,
        cleaner: null,
      });
    }
  });

  // --- what needs somebody ----------------------------------------------

  // A departure with nobody going. The one thing on this page that costs
  // money if it is missed.
  board.filter((b) => b.kind === 'out' && !b.cleaner).forEach((b) => {
    add({
      key: `unstaffed:${b.property_id}:${b.date}`,
      sortAt: b.sortAt,
      title: 'Nobody is cleaning this',
      subtitle: `${b.property} · checks out ${b.when}`,
      action: { label: 'Assign', kind: 'assign', property_id: b.property_id, date: b.date },
    });
  });

  // Asked, and no answer, with the day approaching.
  jobs.
  filter((j) => j.status === 'pending' && j.cleaner_name).
  filter((j) => {
    const n = daysOut(j.cleaning_date, day);
    return n >= 0 && n <= horizonDays;
  }).
  forEach((j) => {
    add({
      key: `unanswered:${j.id}`,
      sortAt: daysOut(j.cleaning_date, day),
      title: `${j.cleaner_name} has not answered`,
      subtitle: `${propertyName(j.property_id)} · ${whenLabel(daysOut(j.cleaning_date, day))}`,
      action: { label: 'Open', kind: 'assign', property_id: j.property_id, date: ymd(j.cleaning_date) },
    });
  });

  // Accepted, then marked themselves off. Looks covered; is not.
  jobs.
  filter((j) => j.cleaner_id && j.cleaner_name && !j.started_at && !j.completed_at).
  filter((j) => !['declined', 'cancelled'].includes(j.status)).
  filter((j) => {
    const n = daysOut(j.cleaning_date, day);
    return n >= 0 && n <= 14 && !isFree(j.cleaner_id, ymd(j.cleaning_date));
  }).
  forEach((j) => {
    add({
      key: `clash:${j.id}`,
      sortAt: daysOut(j.cleaning_date, day),
      title: `${j.cleaner_name} is no longer available`,
      subtitle: `${propertyName(j.property_id)} · ${whenLabel(daysOut(j.cleaning_date, day))}`,
      action: { label: 'Reassign', kind: 'assign', property_id: j.property_id, date: ymd(j.cleaning_date) },
    });
  });

  // Guests arriving to a property that will not be clean. The rule that
  // had nowhere to live before the planner existed.
  guestStays.
  filter((s) => {
    const n = daysOut(s.check_in, day);
    return n >= 0 && n <= 14;
  }).
  forEach((s) => {
    const property = properties.find((p) => p.id === s.property_id);
    if (!property) return;
    const mine = jobs.filter((j) => j.property_id === s.property_id);
    const verdict = needsCleanBefore({ property, stays, jobs: mine, arrival: s.check_in });
    if (!verdict.needed) return;
    // Only if nothing is already planned for it.
    if (staffedOn(s.property_id, s.check_in).length) return;
    add({
      key: `notclean:${s.smoobu_id}`,
      sortAt: daysOut(s.check_in, day),
      title: 'Guests arrive to a property that is not clean',
      subtitle: `${propertyName(s.property_id)} · ${whenLabel(daysOut(s.check_in, day))} · ${verdict.why}`,
      action: { label: 'Assign', kind: 'assign', property_id: s.property_id, date: ymd(s.check_in) },
    });
  });

  // Something broken.
  issues.forEach((i) => {
    add({
      key: `issue:${i.id}`,
      sortAt: 0,
      title: i.title,
      subtitle: `${propertyName(i.property_id)} · reported`,
      action: { label: 'View', kind: 'issue', property_id: i.property_id },
    });
  });

  // Nights off sale that could go back on, because somebody is free now.
  blocks.
  filter((b) => b.smoobu_reservation_id && !b.released_at).
  filter((b) => ymd(b.date) >= day).
  forEach((b) => {
    add({
      key: `block:${b.id}`,
      sortAt: daysOut(b.date, day),
      title: 'Nights are off sale',
      subtitle: `${propertyName(b.property_id)} · from ${ymd(b.date)}${b.reason ? ` · ${b.reason}` : ''}`,
      action: { label: 'Put back on sale', kind: 'unblock', property_id: b.property_id, block_id: b.id },
    });
  });

  return {
    needs: needs.sort((a, b) => a.sortAt - b.sortAt),
    board: board.sort((a, b) => a.sortAt - b.sortAt || (a.kind === 'out' ? -1 : 1)),
  };
}

module.exports = { buildToday, whenLabel, daysOut };
