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
const { occupancyByProperty, addDays } = require('./dashboard-calc');
const { needsCleanBefore, propertyStatus, ymd } = require('./cleaning-status');

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
  // What the cleaners have asked for and nobody has bought yet. Passed
  // in already filtered to outstanding rows — this decides how it reads,
  // not what counts.
  supplies = [],
  isFree = () => true, today, now = null, holidays = [],
  // How far the forward list looks. Seven days is a planning window.
  horizonDays = 7,
  // How far "needs you" looks. Two, because that list is about what is
  // about to go wrong, and a checkout a week out is not that. Widening
  // the forward list to seven quietly widened this one too, and put
  // "guests leave in 7 days" beside a property that was dirty already.
  needsHorizonDays = 2,
}) {
  const day = ymd(today) || new Date().toISOString().slice(0, 10);
  const properties_ = properties;

  /**
   * Has the guest actually gone?
   *
   * "Checks out today" was still on the screen in the afternoon, hours
   * after the guest had left — future tense for something already done,
   * and it made the one urgent row on the page read like a plan. If the
   * property's checkout time has passed, say so, because a dirty
   * property now is a different problem from one that will be dirty by
   * ten tomorrow.
   */
  const departed = (propertyId, date) => {
    if (!now || ymd(date) !== day) return false;
    const p = properties_.find((x) => x.id === propertyId);
    return now >= ((p && p.check_out_time) || '10:00');
  };
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
        // Same reason as the row above it: by the afternoon "today" is
        // the wrong tense for something that happened at ten.
        when: departed(s.property_id, s.check_out) ? 'already left' : whenLabel(outIn),
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
  board.
  filter((b) => b.kind === 'out' && !b.cleaner && b.sortAt <= needsHorizonDays).
  forEach((b) => {
    const gone = departed(b.property_id, b.date);
    add({
      key: `unstaffed:${b.property_id}:${b.date}`,
      // Already dirty beats about to be dirty.
      sortAt: gone ? b.sortAt - 0.5 : b.sortAt,
      title: `${b.property} has no cleaner`,
      subtitle: gone ?
      'Guests have left — it is dirty now' :
      `Guests leave ${b.when}`,
      action: { label: 'Assign', kind: 'assign', property_id: b.property_id, date: b.date },
    });
  });

  // Asked, and no answer, with the day approaching.
  jobs.
  filter((j) => j.status === 'pending' && j.cleaner_name).
  filter((j) => {
    const n = daysOut(j.cleaning_date, day);
    return n >= 0 && n <= needsHorizonDays;
  }).
  forEach((j) => {
    add({
      key: `unanswered:${j.id}`,
      sortAt: daysOut(j.cleaning_date, day),
      title: `${j.cleaner_name} has not answered about ${propertyName(j.property_id)}`,
      subtitle: `Cleaning ${whenLabel(daysOut(j.cleaning_date, day))}`,
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
      title: `${j.cleaner_name} can no longer clean ${propertyName(j.property_id)}`,
      subtitle: `Was booked for ${whenLabel(daysOut(j.cleaning_date, day))}`,
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
      title: `${propertyName(s.property_id)} will not be clean in time`,
      subtitle: `Guests arrive ${whenLabel(daysOut(s.check_in, day))} · ${verdict.why}`,
      action: { label: 'Assign', kind: 'assign', property_id: s.property_id, date: ymd(s.check_in) },
    });
  });

  // Something broken.
  issues.forEach((i) => {
    add({
      key: `issue:${i.id}`,
      sortAt: 0,
      title: `${i.title} at ${propertyName(i.property_id)}`,
      subtitle: 'Reported by the cleaner',
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
      title: `${propertyName(b.property_id)} has nights off sale`,
      subtitle: `From ${ymd(b.date)}${b.reason ? ` · ${b.reason}` : ''}`,
      action: { label: 'Put back on sale', kind: 'unblock', property_id: b.property_id, block_id: b.id },
    });
  });

  /**
   * One row per property, replacing three sections that each answered
   * a slice of the same question.
   *
   * "Today and tomorrow" gave arrivals and departures, "Properties" gave
   * clean or dirty, and "Currently staying" gave the guest and the
   * platform — so who is in a property, whether it is clean and who is
   * cleaning it were three separate readings a page apart, and you had
   * to hold them together yourself. They are one fact about one
   * property, so they are one row.
   */
  const propertyRows = properties.map((property) => {
    const mine = (rows) => rows.filter((r) => r.property_id === property.id);
    const myStays = mine(guestStays);
    const state = propertyStatus({
      property, stays: mine(stays), jobs: mine(jobs), today: day,
    });

    // Who is in it now, and until when.
    const inHouse = myStays.find(
      (v) => ymd(v.check_in) <= day && day < ymd(v.check_out)
    ) || null;
    // Leaving today counts as still theirs until they have gone.
    const leavingToday = myStays.find(
      (v) => ymd(v.check_out) === day && !departed(property.id, v.check_out)
    ) || null;
    const guest = inHouse || leavingToday;

    const nextArrival = myStays.
    filter((v) => ymd(v.check_in) > day).
    sort((a, b) => ymd(a.check_in).localeCompare(ymd(b.check_in)))[0] || null;

    // The next real clean, and who is on it.
    const nextJob = mine(jobs).
    filter((j) => !j.completed_at && ymd(j.cleaning_date) >= day).
    filter((j) => !['declined', 'cancelled'].includes(j.status)).
    sort((a, b) => ymd(a.cleaning_date).localeCompare(ymd(b.cleaning_date)))[0] || null;

    return {
      id: property.id,
      name: property.name,
      status: state.status,
      detail: state.detail,
      guest: guest ?
      { name: guest.guest_name || 'Guest', until: ymd(guest.check_out),
        leaving_today: ymd(guest.check_out) === day } :
      null,
      cleaner: nextJob ?
      { name: nextJob.cleaner_name || null, date: ymd(nextJob.cleaning_date),
        status: nextJob.status } :
      null,
      next_arrival: nextArrival ?
      { name: nextArrival.guest_name || 'Guest', date: ymd(nextArrival.check_in) } :
      null,
      blocks: blocks.
      filter((b) => b.property_id === property.id && !b.released_at).
      map((b) => ({
        id: b.id, from: ymd(b.date), to: ymd(b.end_date), reason: b.reason,
        can_release: Boolean(b.smoobu_reservation_id),
      })),
    };
  });

  /**
   * What is still left to sell.
   *
   * The old home screen carried a row of report numbers — gross revenue,
   * average nightly rate, average stay — which say how the last quarter
   * went. Those belong on Analytics, and they are already there. The
   * question this page is for is what to do next, and the answer to that
   * is the nights nobody has bought yet.
   *
   * Occupancy is counted by the same function the analytics tab uses, so
   * the two cannot disagree about a booked night.
   */
  const money = (() => {
    if (properties.length === 0) return null;
    const ids = properties.map((p) => p.id);
    const sold = (days) =>
    occupancyByProperty(guestStays, ids, day, days).
    reduce((n, row) => n + row.booked_nights, 0);

    const capacity30 = properties.length * 30;
    const capacity14 = properties.length * 14;
    const sold30 = sold(30);
    const sold14 = sold(14);

    // Money already promised by guests arriving in the window. Counted on
    // arrival rather than spread per night, because that is the figure a
    // booking actually commits.
    const booked30 = guestStays.
    filter((v) => ymd(v.check_in) >= day && ymd(v.check_in) < ymd(addDays(day, 30))).
    reduce((sum, v) => sum + (Number(v.total_price) || 0), 0);

    // Why those nights might sell. A holiday inside the window is the
    // reason to look at a price before it passes, which is the only
    // thing about a holiday worth saying on a page about today.
    const to30 = ymd(addDays(day, 30));
    const soon = holidays.
    filter((h) => ymd(h.start) < to30 && ymd(h.end || h.start) >= day).
    sort((a, b) => ymd(a.start).localeCompare(ymd(b.start))).
    map((h) => ({
      name: h.name, label: h.label, kind: h.kind,
      start: ymd(h.start), end: ymd(h.end || h.start),
      days_away: daysOut(h.start, day),
    }));

    return {
      holidays: soon,
      open_nights_30: Math.max(0, capacity30 - sold30),
      capacity_30: capacity30,
      occupancy_30: capacity30 ? Math.round((sold30 / capacity30) * 100) : 0,
      open_nights_14: Math.max(0, capacity14 - sold14),
      capacity_14: capacity14,
      booked_revenue_30: Math.round(booked30),
    };
  })();

  /**
   * What somebody has run out of.
   *
   * Deliberately not in "needs you". That list is what will go wrong
   * today if it is ignored — a checkout with no cleaner costs a booking.
   * Bin liners can wait until you are next at the shops, and putting them
   * at the same weight is how the old attention list buried the things
   * that mattered.
   *
   * So it is its own section, and the screen only draws it when there is
   * something on it. A block sitting empty most of the week is a block
   * people learn to scroll past.
   */
  const suppliesRows = supplies.map((s) => ({
    id: s.id,
    property_id: s.property_id || null,
    property: s.property_id ? propertyName(s.property_id) : null,
    item: s.item_name,
    // Only when it is more than one. "1 " in front of every line is
    // noise, and the unit rarely says anything on its own.
    amount: Number(s.quantity) > 1 ? `${Number(s.quantity)} ${s.unit || ''}`.trim() : '',
    notes: s.notes || '',
    who: s.added_by_name || null,
    asked: s.created_at ? whenLabel(daysOut(s.created_at, day)) : '',
  }));

  return {
    needs: needs.sort((a, b) => a.sortAt - b.sortAt),
    money,
    supplies: suppliesRows,
    properties: propertyRows,
    // Seven days rather than two: two is not long enough to plan a
    // cleaner around, which is the main thing this is read for.
    upcoming: board.sort((a, b) => a.sortAt - b.sortAt || (a.kind === 'out' ? -1 : 1)),
  };
}

module.exports = { buildToday, whenLabel, daysOut };
