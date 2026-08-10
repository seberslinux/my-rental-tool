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

  const row = out.board.find((b) => b.kind === 'out');
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
  assert.equal(out.board.find((b) => b.kind === 'out').cleaner, null);
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
  assert.match(clash.title, /no longer available/);
});

test('one checkout with nobody produces exactly one thing to do', () => {
  // The old screen produced three: a badge, an attention row, and a day
  // sheet warning.
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 4, check_in: '2026-08-08', check_out: TODAY })],
    jobs: [],
  });
  assert.equal(out.needs.filter((n) => n.subtitle.includes('checks out')).length, 1);
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
  assert.deepEqual(out.board, []);
});

test('blocked nights are not a checkout', () => {
  const out = buildToday({
    properties: props, today: TODAY,
    stays: [stay({ smoobu_id: 7, check_in: '2026-08-08', check_out: TODAY, platform: 'Blocked channel auto' })],
    jobs: [],
  });
  assert.deepEqual(out.board, [], 'nobody slept there, nobody is leaving');
});
