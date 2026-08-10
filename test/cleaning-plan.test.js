const test = require('node:test');
const assert = require('node:assert/strict');
const { planCleans } = require('../src/services/cleaning-plan');
const { propertyStatus, needsCleanBefore } = require('../src/services/cleaning-status');

/**
 * What a property needs cleaning-wise, decided without a database.
 *
 * This logic used to live inside assignCleanerForCheckout, tangled with
 * picking a cleaner and messaging them, and it only ever ran off a
 * checkout — so the rule "the property must be clean when guests arrive"
 * had nowhere to live and was never enforced.
 */

const prop = { id: 1, name: 'Hill Top Lodge', clean_fresh_nights: 3 };
const stay = (o) => ({ status: 'confirmed', platform: 'Airbnb', ...o });

// --- departures ----------------------------------------------------------

test('a departure always wants a clean', () => {
  const plan = planCleans({
    property: prop,
    stays: [stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' })],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  assert.ok(plan.some((p) => p.date === '2026-08-05' && p.reason === 'checkout'));
});

test('with no clean on record, the first arrival wants one too', () => {
  // Not an edge case — it is the honest answer when nothing says the
  // property has ever been cleaned. A planner that assumed clean would
  // send guests into whatever the last lot left.
  const plan = planCleans({
    property: prop,
    stays: [stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' })],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  const first = plan.find((p) => p.date === '2026-08-01');
  assert.equal(first.reason, 'checkin');
  assert.match(first.why, /no clean/);
});

test('a blocked stay is nobody leaving, so it wants nothing', () => {
  const plan = planCleans({
    property: prop,
    stays: [stay({ smoobu_id: 2, check_in: '2026-08-01', check_out: '2026-08-05', platform: 'Blocked channel auto' })],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  assert.deepEqual(plan, []);
});

// --- arrivals, and the still-clean rule ----------------------------------

test('an arrival soon after a checkout clean needs nothing of its own', () => {
  // Out on the 5th, cleaned that day, in again on the 7th: two nights,
  // inside the window, nobody in between.
  const plan = planCleans({
    property: prop,
    stays: [
      stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' }),
      stay({ smoobu_id: 2, check_in: '2026-08-07', check_out: '2026-08-09' }),
    ],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  assert.ok(!plan.some((p) => p.date === '2026-08-07'),
    'the 7th is covered by the clean on the 5th');
  assert.ok(plan.some((p) => p.date === '2026-08-05' && p.reason === 'checkout'));
});

test('an arrival long after the last clean wants a freshen', () => {
  const plan = planCleans({
    property: prop,
    stays: [
      stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' }),
      stay({ smoobu_id: 2, check_in: '2026-08-20', check_out: '2026-08-22' }),
    ],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  const kinds = plan.map((p) => p.date + ' ' + p.reason);
  assert.ok(kinds.includes('2026-08-20 checkin'), 'fifteen nights of dust is a clean');
  assert.ok(kinds.includes('2026-08-05 checkout'));
});

test('the window is a property setting, not a constant', () => {
  const patient = { ...prop, clean_fresh_nights: 30 };
  const plan = planCleans({
    property: patient,
    stays: [
      stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' }),
      stay({ smoobu_id: 2, check_in: '2026-08-20', check_out: '2026-08-22' }),
    ],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  assert.ok(!plan.some((p) => p.date === '2026-08-20'),
    'thirty nights is fine here, so the arrival needs nothing');
});

test('a same-day turnover is one clean, not two', () => {
  const plan = planCleans({
    property: prop,
    stays: [
      stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' }),
      stay({ smoobu_id: 2, check_in: '2026-08-05', check_out: '2026-08-08' }),
    ],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  const onTheFifth = plan.filter((p) => p.date === '2026-08-05');
  assert.equal(onTheFifth.length, 1);
  assert.equal(onTheFifth[0].reason, 'checkout', 'the turnover serves the arrival');
});

test('a blocked gap does not dirty the property', () => {
  // Out on the 5th, Smoobu blocks the 5th to the 7th for turnaround,
  // guests in on the 7th. Nobody slept in the block.
  const plan = planCleans({
    property: prop,
    stays: [
      stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' }),
      stay({ smoobu_id: 9, check_in: '2026-08-05', check_out: '2026-08-07', platform: 'Blocked channel' }),
      stay({ smoobu_id: 2, check_in: '2026-08-07', check_out: '2026-08-09' }),
    ],
    jobs: [], from: '2026-08-01', to: '2026-08-31',
  });
  assert.ok(!plan.some((p) => p.date === '2026-08-07' && p.reason === 'checkin'));
});

test('a clean already on the books is not planned twice', () => {
  const plan = planCleans({
    property: prop,
    stays: [
      stay({ smoobu_id: 1, check_in: '2026-08-01', check_out: '2026-08-05' }),
      stay({ smoobu_id: 2, check_in: '2026-08-20', check_out: '2026-08-22' }),
    ],
    jobs: [{ cleaning_date: '2026-08-19', status: 'confirmed' }],
    from: '2026-08-01', to: '2026-08-31',
  });
  assert.ok(!plan.some((p) => p.date === '2026-08-20'),
    'somebody is already going the day before');
});

// --- the status a person reads -------------------------------------------

test('occupied beats everything', () => {
  const s = propertyStatus({
    property: prop,
    stays: [stay({ check_in: '2026-08-01', check_out: '2026-08-05' })],
    jobs: [], today: '2026-08-03',
  });
  assert.equal(s.status, 'occupied');
});

test('cleaned yesterday reads ready; long ago reads stale', () => {
  const jobs = [{ cleaning_date: '2026-08-05', status: 'completed', completed_at: '2026-08-05T12:00:00Z' }];
  assert.equal(propertyStatus({ property: prop, stays: [], jobs, today: '2026-08-06' }).status, 'ready');
  assert.equal(propertyStatus({ property: prop, stays: [], jobs, today: '2026-08-20' }).status, 'stale');
});

test('a manager saying it is clean counts as a clean', () => {
  const s = propertyStatus({
    property: { ...prop, marked_clean_at: '2026-08-05T09:00:00Z' },
    stays: [], jobs: [], today: '2026-08-06',
  });
  assert.equal(s.status, 'ready');
  assert.equal(s.cleanSince, '2026-08-05');
});

test('a manager can overrule a clean that did not stick', () => {
  const s = propertyStatus({
    property: { ...prop, marked_dirty_at: '2026-08-06T09:00:00Z' },
    stays: [],
    jobs: [{ status: 'completed', completed_at: '2026-08-05T12:00:00Z' }],
    today: '2026-08-06',
  });
  assert.equal(s.status, 'dirty');
});

test('a property nobody has ever cleaned is dirty, not ready', () => {
  assert.equal(propertyStatus({ property: prop, stays: [], jobs: [], today: '2026-08-06' }).status, 'dirty');
});

test('guests since the clean make it dirty whatever the clock says', () => {
  const s = propertyStatus({
    property: prop,
    stays: [stay({ check_in: '2026-08-06', check_out: '2026-08-08' })],
    jobs: [{ status: 'completed', completed_at: '2026-08-05T12:00:00Z' }],
    today: '2026-08-09',
  });
  assert.equal(s.status, 'dirty');
});

test('a cleaner on site reads as being cleaned', () => {
  const s = propertyStatus({
    property: prop, stays: [],
    jobs: [{ started_at: '2026-08-06T10:00:00Z', completed_at: null }],
    today: '2026-08-06',
  });
  assert.equal(s.status, 'cleaning');
});
