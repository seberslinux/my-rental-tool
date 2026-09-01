const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const {
  seedUser, seedProperty, seedCleaner, linkCleanerToProperty,
  seedAvailability, loginAs,
} = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, daysAgo, weekdayOf } = require('../helpers/dates');

/**
 * The manager setting one of a cleaner's days, on their behalf.
 *
 * A cleaner could already do this from their own app. The other
 * direction had a route but no way to reach it and no guards: the date
 * went into the table unchecked, and nobody was told it had happened.
 *
 * What is pinned here is the part that is easy to get wrong and
 * impossible to notice: a bad date used to write a row that no lookup
 * would ever match, so the override existed and did nothing.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

/** A manager, a property, and a cleaner who works the given day. */
async function setup({ worksOn = null } = {}) {
  const user = await seedUser({ role: 'property_manager' });
  const property = await seedProperty({ owner: user });
  const cleaner = await seedCleaner({ name: 'Francesca' });
  await linkCleanerToProperty(cleaner, property);
  if (worksOn) await seedAvailability(cleaner, weekdayOf(worksOn), '09:00', '13:00');
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, cleaner, property };
}

const told = () => pool.query(
  "SELECT * FROM notifications WHERE event = 'availability_updated' ORDER BY id"
).then((r) => r.rows);

// --- the guards that were missing ----------------------------------------

test('a date that is not a date is refused', async () => {
  // It used to be inserted as given. The row existed, every lookup
  // compares against YYYY-MM-DD, and so it silently did nothing.
  const { agent, cleaner } = await setup();
  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date: 'next Tuesday', available: false }).expect(400);

  const { rows } = await pool.query('SELECT * FROM cleaner_availability_overrides');
  assert.equal(rows.length, 0, 'nothing was written');
});

test('a day that has gone is refused', async () => {
  const { agent, cleaner } = await setup();
  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date: daysAgo(2), available: false }).expect(400);
});

test('a cleaner who does not exist is a 404, not a stray row', async () => {
  const { agent } = await setup();
  await agent.post('/api/cleaners/999999/overrides')
    .send({ date: inDays(3), available: false }).expect(404);

  const { rows } = await pool.query('SELECT * FROM cleaner_availability_overrides');
  assert.equal(rows.length, 0);
});

test('signed out, nobody sets anybody\'s days', async () => {
  const app = await getApp();
  const cleaner = await seedCleaner();
  await require('supertest')(app)
    .post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date: inDays(3), available: false })
    .expect(401);
});

// --- what it does --------------------------------------------------------

test('marking a working day off takes it off their calendar', async () => {
  const date = inDays(9);
  const { agent, cleaner } = await setup({ worksOn: date });

  const before = await agent.get(`/api/cleaners/${cleaner.id}/calendar?from=${date}&to=${date}`).expect(200);
  assert.equal(before.body.days[date].state, 'free', 'their weekly pattern says they work it');

  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date, available: false }).expect(200);

  const after = await agent.get(`/api/cleaners/${cleaner.id}/calendar?from=${date}&to=${date}`).expect(200);
  assert.equal(after.body.days[date].state, 'off');
  assert.equal(after.body.days[date].override, true, 'and says it is an exception, not the pattern');
});

test('the cleaner is told, because somebody else changed their days', async () => {
  const date = inDays(9);
  const { agent, cleaner } = await setup({ worksOn: date });

  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date, available: false }).expect(200);

  const notes = await told();
  assert.equal(notes.length, 1);
  assert.equal(Number(notes[0].cleaner_id), cleaner.id);
  assert.match(notes[0].title, /not available/);
});

test('a change that changes nothing tells nobody', async () => {
  // Marking somebody off a day they have never worked is a no-op wearing
  // the clothes of a change. Sending it teaches them to ignore the next.
  const date = inDays(9);
  const { agent, cleaner } = await setup(); // no weekly pattern at all

  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date, available: false }).expect(200);

  assert.equal((await told()).length, 0);
});

test('being given a day they do not usually work does tell them', async () => {
  const date = inDays(9);
  const { agent, cleaner } = await setup(); // works no days

  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date, available: true }).expect(200);

  const notes = await told();
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /available/);
});

test('taking somebody off a day they are booked on says so rather than refusing', async () => {
  // The manager is the one who can resolve it. Refusing would leave them
  // unable to record what they have just been told on the phone.
  const date = inDays(9);
  const { agent, cleaner, property } = await setup({ worksOn: date });
  await pool.query(
    `INSERT INTO cleaning_jobs (cleaner_id, property_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, '10:00', '12:30', 'confirmed')`,
    [cleaner.id, property.id, date]
  );

  const { body } = await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date, available: false }).expect(200);

  assert.equal(body.available, false);
  assert.equal(body.jobs.length, 1, 'the clash comes back so it can be shown');
  assert.equal(body.jobs[0].property_name, property.name);
});

test('a job they turned down is not a clash', async () => {
  const date = inDays(9);
  const { agent, cleaner, property } = await setup({ worksOn: date });
  await pool.query(
    `INSERT INTO cleaning_jobs (cleaner_id, property_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, '10:00', '12:30', 'declined')`,
    [cleaner.id, property.id, date]
  );

  const { body } = await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date, available: false }).expect(200);

  assert.deepEqual(body.jobs, [], 'declined work is nobody\'s commitment');
});

// --- undoing -------------------------------------------------------------

test('clearing a day is not the same as toggling it back', async () => {
  // An override wins outright, hours included. A day switched off and on
  // again reads as a blanket yes — so somebody who works Tuesday
  // mornings would be offered a Tuesday afternoon. Clearing is how you
  // actually take it back.
  const date = inDays(9);
  const { agent, cleaner } = await setup({ worksOn: date });

  await agent.post(`/api/cleaners/${cleaner.id}/overrides`).send({ date, available: false }).expect(200);
  await agent.post(`/api/cleaners/${cleaner.id}/overrides`).send({ date, available: true }).expect(200);

  const toggled = await pool.query('SELECT * FROM cleaner_availability_overrides');
  assert.equal(toggled.rows.length, 1, 'toggling back leaves an override behind');

  const { body } = await agent.delete(`/api/cleaners/${cleaner.id}/overrides?date=${date}`).expect(200);
  assert.equal(body.cleared, true);
  assert.equal(body.available, true, 'their pattern says they work it');

  const cleared = await pool.query('SELECT * FROM cleaner_availability_overrides');
  assert.equal(cleared.rows.length, 0, 'and now the pattern is all there is');
});

test('clearing back to the pattern reports the day as their pattern has it', async () => {
  const date = inDays(9);
  const { agent, cleaner } = await setup(); // works no days
  await agent.post(`/api/cleaners/${cleaner.id}/overrides`).send({ date, available: true }).expect(200);

  const { body } = await agent.delete(`/api/cleaners/${cleaner.id}/overrides?date=${date}`).expect(200);
  assert.equal(body.available, false, 'the pattern says they do not work it');

  const after = await agent.get(`/api/cleaners/${cleaner.id}/calendar?from=${date}&to=${date}`).expect(200);
  assert.equal(after.body.days[date].override, false);
});

test('clearing needs a real date', async () => {
  const { agent, cleaner } = await setup();
  await agent.delete(`/api/cleaners/${cleaner.id}/overrides?date=whenever`).expect(400);
});
