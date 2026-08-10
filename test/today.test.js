const test = require('node:test');
const assert = require('node:assert/strict');
const { buildToday } = require('../src/services/today');

/**
 * The three cases where the old home screen disagreed with itself.
 *
 * It answered "does this checkout have a cleaner" in four places, each
 * looking at the data its own way, and they contradicted each other on
 * the same screen. These fixtures are the shapes that broke it.
 */

const props = [{ id: 1, name: 'Hill Top Lodge', clean_fresh_nights: 3 }];
const TODAY = '2026-08-10';
const stay = (o) => ({ status: 'confirmed', platform: 'Airbnb', property_id: 1, ...o });
const job = (o) => ({ property_id: 1, status: 'confirmed', ...o });

test('a real cleaner on the day counts, even beside an empty row', () => {
  // The reported bug. Francesca had accepted; a row left behind by a
  // deleted cleaner sat on the same day; the board keyed jobs by
  // property+date in a Map, so one hid the other and "No cleaner" won.
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 1, check_in: '2026-08-08', check_out: TODAY })],
    jobs: [
      job({ id: 1, cleaning_date: TODAY, cleaner_id: 5, cleaner_name: 'Francesca' }),
      job({ id: 2, cleaning_date: TODAY, cleaner_id: null, cleaner_name: null, status: 'pending' }),
    ],
  });

  const row = out.upcoming.find((b) => b.kind === 'out');
  assert.equal(row.cleaner.name, 'Francesca');
  assert.equal(out.needs.filter((n) => n.key.startsWith('unstaffed')).length, 0,
    'and it is not also listed as needing somebody');
});

test('a declined job is not cover', () => {
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 2, check_in: '2026-08-08', check_out: TODAY })],
    jobs: [job({ id: 3, cleaning_date: TODAY, cleaner_id: 5, cleaner_name: 'Jane', status: 'declined' })],
  });
  assert.equal(out.upcoming.find((b) => b.kind === 'out').cleaner, null);
  assert.equal(out.needs.filter((n) => n.key.startsWith('unstaffed')).length, 1);
});

test('accepted, then marked unavailable, is raised rather than looking covered', () => {
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 3, check_in: '2026-08-08', check_out: TODAY })],
    jobs: [job({ id: 4, cleaning_date: TODAY, cleaner_id: 5, cleaner_name: 'Jane' })],
    isFree: () => false,
  });
  const clash = out.needs.find((n) => n.key.startsWith('clash'));
  assert.ok(clash);
  assert.match(clash.title, /can no longer clean/);
});

test('one checkout with nobody produces exactly one thing to do', () => {
  // The old screen produced three: a badge, an attention row, and a day
  // sheet warning.
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 4, check_in: '2026-08-08', check_out: TODAY })],
    jobs: [],
  });
  assert.equal(out.needs.filter((n) => n.key.startsWith('unstaffed')).length, 1);
});

test('needs are ordered by when they bite, not by kind', () => {
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [
      stay({ smoobu_id: 5, check_in: '2026-08-01', check_out: '2026-08-12' }),
      stay({ smoobu_id: 6, check_in: '2026-08-05', check_out: TODAY }),
    ],
    jobs: [],
    horizonDays: 3,
  });
  const dates = out.needs.map((n) => n.sortAt);
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b));
});

test('a property nobody is arriving at raises nothing', () => {
  const out = buildToday({ properties: props, today: TODAY, stays: [], jobs: [] });
  assert.deepEqual(out.needs, []);
  assert.deepEqual(out.upcoming, []);
});

test('blocked nights are not a checkout', () => {
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 7, check_in: '2026-08-08', check_out: TODAY, platform: 'Blocked channel auto' })],
    jobs: [],
  });
  assert.deepEqual(out.upcoming, [], 'nobody slept there, nobody is leaving');
});

// --- the tense of a checkout ---------------------------------------------

test('once the guests have gone, it stops saying they are leaving', () => {
  // "Checks out today" sat on the screen all afternoon, hours after the
  // guest had left: future tense for something already done, which made
  // the one urgent row on the page read like a plan.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-10',
  }];

  const morning = buildToday({ properties, stays, today: '2026-08-10', now: '08:30' });
  const unstaffedM = morning.needs.find((n) => n.key.startsWith('unstaffed:'));
  assert.equal(unstaffedM.title, 'The loft has no cleaner');
  assert.equal(unstaffedM.subtitle, 'Guests leave today');

  const afternoon = buildToday({ properties, stays, today: '2026-08-10', now: '15:00' });
  const unstaffedA = afternoon.needs.find((n) => n.key.startsWith('unstaffed:'));
  assert.equal(unstaffedA.subtitle, 'Guests have left — it is dirty now');
});

test('a property that is already dirty sorts above one that will be', () => {
  const properties = [
    { id: 1, name: 'The loft', check_out_time: '10:00' },
    { id: 2, name: 'Hill Top Lodge', check_out_time: '10:00' },
  ];
  const stays = [
    // Leaves tomorrow — still in the future.
    { smoobu_id: 'b', property_id: 2, status: 'confirmed', platform: 'Airbnb',
      guest_name: 'Siba', check_in: '2026-08-08', check_out: '2026-08-11' },
    // Left this morning.
    { smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
      guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-10' },
  ];

  const { needs } = buildToday({ properties, stays, today: '2026-08-10', now: '15:00' });
  const unstaffed = needs.filter((n) => n.key.startsWith('unstaffed:'));
  assert.equal(unstaffed[0].title, 'The loft has no cleaner', 'dirty now comes first');
  assert.equal(unstaffed[1].title, 'Hill Top Lodge has no cleaner');
});

test('without a clock it does not guess that anybody has left', () => {
  // buildToday is called in tests and from the cron without a time; the
  // safe reading is the one that does not claim something has happened.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-10',
  }];
  const { needs } = buildToday({ properties, stays, today: '2026-08-10' });
  assert.equal(needs.find((n) => n.key.startsWith('unstaffed:')).subtitle, 'Guests leave today');
});

test('every row names its own property', () => {
  // A row read on its own used to be meaningless — "Nobody is cleaning
  // this" needs the line underneath it to mean anything, and the tab
  // badge that counts these has no line underneath.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-10',
  }];
  const issues = [{ id: 7, property_id: 1, title: 'Shower head dripping' }];
  const { needs } = buildToday({ properties, stays, issues, today: '2026-08-10', now: '15:00' });

  needs.forEach((n) => {
    assert.match(n.title, /The loft/, `"${n.title}" does not say which property`);
  });
});

test('the board says a guest has left, not that they are leaving', () => {
  // The row under "Needs you" was corrected; this one still read
  // "Check-out · today" for the same guest who had already gone.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-10',
  }];
  const morning = buildToday({ properties, stays, today: '2026-08-10', now: '08:30' });
  assert.equal(morning.upcoming.find((b) => b.kind === 'out').when, 'today');

  const afternoon = buildToday({ properties, stays, today: '2026-08-10', now: '15:00' });
  assert.equal(afternoon.upcoming.find((b) => b.kind === 'out').when, 'already left');
});

// --- one row per property ------------------------------------------------

test('a property row carries the state, the guest and the cleaner together', () => {
  // Three sections used to answer a third of this each, a page apart.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-14',
  }];
  const jobs = [{
    id: 1, property_id: 1, cleaning_date: '2026-08-14', cleaner_id: 5,
    cleaner_name: 'Jane', status: 'confirmed',
  }];

  const { properties: rows } = buildToday({
    properties, stays, jobs, today: '2026-08-10', now: '12:00',
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'The loft');
  assert.equal(rows[0].guest.name, 'Gracey', 'who is in it');
  assert.equal(rows[0].guest.leaving_today, false);
  assert.equal(rows[0].cleaner.name, 'Jane', 'who cleans it next');
  assert.equal(rows[0].cleaner.date, '2026-08-14');
});

test('a guest who has already gone is not still staying there', () => {
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Gracey', check_in: '2026-08-07', check_out: '2026-08-10',
  }];

  const morning = buildToday({ properties, stays, today: '2026-08-10', now: '08:00' });
  assert.equal(morning.properties[0].guest.name, 'Gracey', 'still theirs until they leave');
  assert.equal(morning.properties[0].guest.leaving_today, true);

  const afternoon = buildToday({ properties, stays, today: '2026-08-10', now: '15:00' });
  assert.equal(afternoon.properties[0].guest, null, 'they have gone');
});

test('a declined job is not offered as the next cleaner', () => {
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const jobs = [{
    id: 1, property_id: 1, cleaning_date: '2026-08-12', cleaner_id: 5,
    cleaner_name: 'Jane', status: 'declined',
  }];
  const { properties: rows } = buildToday({ properties, jobs, today: '2026-08-10' });
  assert.equal(rows[0].cleaner, null, 'she said no');
});

test('the forward window is a week, not two days', () => {
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Later', check_in: '2026-08-15', check_out: '2026-08-18',
  }];
  const { upcoming } = buildToday({ properties, stays, today: '2026-08-10' });
  assert.equal(upcoming.length, 1, 'an arrival five days out is worth planning for');
  assert.equal(upcoming[0].kind, 'in');
});

test('a checkout a week out is planning, not something that needs you', () => {
  // The forward list looks seven days ahead. "Needs you" must not, or
  // widening one window silently fills the other with things that are
  // not urgent — a checkout in a week beside a property already dirty.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'Later', check_in: '2026-08-10', check_out: '2026-08-17',
  }];
  const { needs, upcoming } = buildToday({ properties, stays, today: '2026-08-10' });

  assert.equal(upcoming.filter((u) => u.kind === 'out').length, 1, 'still worth planning for');
  assert.equal(
    needs.filter((n) => n.key.startsWith('unstaffed')).length, 0,
    'but not something to do today'
  );
});

// --- what is left to sell ------------------------------------------------

test('the money band counts the nights nobody has bought yet', () => {
  // The old home screen showed gross revenue and average nightly rate —
  // report numbers, already on Analytics. What this page is for is what
  // to do next, and that is the unsold nights.
  const properties = [
    { id: 1, name: 'The loft', check_out_time: '10:00' },
    { id: 2, name: 'Hill Top Lodge', check_out_time: '10:00' },
  ];
  // One booking, 4 nights, in the next fortnight.
  const stays = [{
    smoobu_id: 'a', property_id: 1, status: 'confirmed', platform: 'Airbnb',
    guest_name: 'G', check_in: '2026-08-12', check_out: '2026-08-16',
    total_price: 4000,
  }];

  const { money } = buildToday({ properties, stays, today: '2026-08-10' });

  assert.equal(money.capacity_30, 60, 'two properties, thirty nights each');
  assert.equal(money.open_nights_30, 56, '60 less the 4 sold');
  assert.equal(money.occupancy_30, 7, '4/60 rounded');
  assert.equal(money.capacity_14, 28);
  assert.equal(money.open_nights_14, 24);
  assert.equal(money.booked_revenue_30, 4000, 'committed by an arrival in the window');
});

test('a block is not a sale', () => {
  // Nights taken off sale are not revenue and must not read as occupancy.
  const properties = [{ id: 1, name: 'The loft', check_out_time: '10:00' }];
  const stays = [{
    smoobu_id: 'b', property_id: 1, status: 'confirmed', platform: 'Blocked',
    guest_name: 'Blocked', check_in: '2026-08-12', check_out: '2026-08-16',
    total_price: 0,
  }];
  const { money } = buildToday({ properties, stays, today: '2026-08-10' });
  assert.equal(money.open_nights_30, 30, 'still all to sell');
  assert.equal(money.occupancy_30, 0);
});

test('no properties means no money band rather than a divide by zero', () => {
  const { money } = buildToday({ properties: [], today: '2026-08-10' });
  assert.equal(money, null);
});
