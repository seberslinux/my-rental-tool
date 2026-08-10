const test = require('node:test');
const assert = require('node:assert/strict');
const { stillOn, stillToDo, STILL_ON_SQL, STILL_TO_DO_SQL } = require('../src/services/job-life');

/**
 * The two questions, and the promise that SQL and JavaScript answer them
 * the same way. Four call sites used to answer the first one as
 * `status != 'completed'`, which says yes to a job the cleaner refused.
 */

test('a refused job is nobody\'s commitment', () => {
  assert.equal(stillOn({ status: 'declined' }), false);
  assert.equal(stillOn({ status: 'cancelled' }), false);
});

test('everything else is', () => {
  ['pending', 'confirmed', 'in_progress', 'completed'].forEach((status) => {
    assert.equal(stillOn({ status }), true, `${status} counts as cover`);
  });
});

test('work still to do excludes both the refused and the finished', () => {
  assert.equal(stillToDo({ status: 'declined' }), false, 'she said no');
  assert.equal(stillToDo({ status: 'completed' }), false, 'already done');
  assert.equal(stillToDo({ status: 'confirmed' }), true);
  assert.equal(stillToDo({ status: 'pending' }), true);
});

test('the SQL says the same thing as the JavaScript', () => {
  // Read the statuses back out of each fragment and check they agree with
  // the predicate beside them, so the two cannot drift apart.
  const listed = (sql) => sql.match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ''));
  const ALL = ['pending', 'confirmed', 'in_progress', 'completed', 'declined', 'cancelled'];

  const excluded = listed(STILL_ON_SQL);
  ALL.forEach((status) => {
    assert.equal(stillOn({ status }), !excluded.includes(status), `stillOn disagrees on ${status}`);
  });

  const included = listed(STILL_TO_DO_SQL);
  ALL.forEach((status) => {
    assert.equal(stillToDo({ status }), included.includes(status), `stillToDo disagrees on ${status}`);
  });
});
