const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedCleaner, seedAvailability, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * A manager setting the days a cleaner usually works.
 *
 * Setting a single date has been possible since the day overrides landed.
 * The pattern those dates are exceptions to could not be touched — so a
 * cleaner whose usual days changed needed an override on every date from
 * then on, and one who does not use the app could never have a pattern
 * set after the day they were added.
 *
 * It is also what the detail sheet counts exceptions against, which makes
 * "3 days differ from that pattern" unfalsifiable while the pattern
 * itself is read-only.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

async function manager() {
  const user = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, user);
  return agent;
}

const MON_TO_WED = [
  { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 2, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 3, start_time: '09:00', end_time: '17:00' },
];

// --- setting it ----------------------------------------------------------

test('a manager can set the days a cleaner usually works', async () => {
  const cleaner = await seedCleaner({});
  const agent = await manager();

  const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`)
    .send({ schedule: MON_TO_WED }).expect(200);

  assert.deepEqual(res.body.map((r) => r.day_of_week), [1, 2, 3]);
  assert.equal(res.body[0].start_time, '09:00');
});

test('a cleaner who never had a pattern can be given one', async () => {
  // The case that stranded anybody without the app: their pattern could
  // be set on the day they were added and never again.
  const cleaner = await seedCleaner({});
  const agent = await manager();

  const before = await pool.query(
    'SELECT COUNT(*)::int AS n FROM cleaner_availability WHERE cleaner_id = $1', [cleaner.id]
  );
  assert.equal(before.rows[0].n, 0);

  await agent.put(`/api/cleaners/${cleaner.id}/availability`)
    .send({ schedule: MON_TO_WED }).expect(200);

  const after = await pool.query(
    'SELECT COUNT(*)::int AS n FROM cleaner_availability WHERE cleaner_id = $1', [cleaner.id]
  );
  assert.equal(after.rows[0].n, 3);
});

test('the week is replaced, not merged', async () => {
  // The screen sends the pattern it is showing. A merge would leave a day
  // switched off in the form still switched on in the database.
  const cleaner = await seedCleaner({});
  await seedAvailability(cleaner, 5, '08:00', '12:00');
  const agent = await manager();

  await agent.put(`/api/cleaners/${cleaner.id}/availability`)
    .send({ schedule: MON_TO_WED }).expect(200);

  const { rows } = await pool.query(
    'SELECT day_of_week FROM cleaner_availability WHERE cleaner_id = $1 ORDER BY day_of_week',
    [cleaner.id]
  );
  assert.deepEqual(rows.map((r) => r.day_of_week), [1, 2, 3], 'Friday is gone');
});

test('an empty week means they work no days', async () => {
  const cleaner = await seedCleaner({});
  await seedAvailability(cleaner, 1, '09:00', '17:00');
  const agent = await manager();

  const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`)
    .send({ schedule: [] }).expect(200);
  assert.deepEqual(res.body, []);
});

// --- one day at a time ---------------------------------------------------

/**
 * The seven circles on the cleaner card send the whole week with one day
 * added or taken away. Both directions have to leave everything else
 * exactly as it was, or tapping Saturday would quietly reset the hours
 * somebody set for Monday.
 */

test('adding one day leaves the other days hours alone', async () => {
  const cleaner = await seedCleaner({});
  const agent = await manager();
  await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({
    schedule: [{ day_of_week: 1, start_time: '06:30', end_time: '11:45' }],
  }).expect(200);

  // Monday as it stands, plus a Saturday on the card's default hours.
  const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({
    schedule: [
      { day_of_week: 1, start_time: '06:30', end_time: '11:45' },
      { day_of_week: 6, start_time: '06:30', end_time: '11:45' },
    ],
  }).expect(200);

  const monday = res.body.find((r) => r.day_of_week === 1);
  assert.equal(monday.start_time, '06:30', 'not reset to nine');
  assert.equal(monday.end_time, '11:45');
});

test('taking one day away keeps the rest', async () => {
  const cleaner = await seedCleaner({});
  const agent = await manager();
  await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({
    schedule: [
      { day_of_week: 1, start_time: '06:30', end_time: '11:45' },
      { day_of_week: 2, start_time: '06:30', end_time: '11:45' },
    ],
  }).expect(200);

  const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({
    schedule: [{ day_of_week: 2, start_time: '06:30', end_time: '11:45' }],
  }).expect(200);

  assert.deepEqual(res.body.map((r) => r.day_of_week), [2]);
  assert.equal(res.body[0].start_time, '06:30');
});

test('a time with seconds on it is the same time', async () => {
  // The card sends back what it was given. Somewhere that formats a time
  // as 09:00:00 should not be a 400 about the format.
  const cleaner = await seedCleaner({});
  const agent = await manager();

  const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({
    schedule: [{ day_of_week: 3, start_time: '09:00:00', end_time: '17:00:00' }],
  }).expect(200);

  assert.equal(res.body[0].start_time, '09:00', 'stored the way everything else writes it');
  assert.equal(res.body[0].end_time, '17:00');
});

// --- refusing nonsense ---------------------------------------------------

test('a malformed day is refused with a reason, not a 500', async () => {
  // day_of_week has a CHECK and both times are NOT NULL, so this used to
  // surface as a Postgres error rather than a sentence.
  const cleaner = await seedCleaner({});
  const agent = await manager();

  for (const [schedule, expected] of [
    [[{ day_of_week: 9, start_time: '09:00', end_time: '17:00' }], /0 \(Sunday\) to 6/],
    [[{ day_of_week: 1, start_time: '9am', end_time: '17:00' }], /HH:MM/],
    [[{ day_of_week: 1, start_time: '09:00' }], /HH:MM/],
    [[{ day_of_week: 1, start_time: '17:00', end_time: '09:00' }], /ends before it starts/],
    [[
      { day_of_week: 1, start_time: '09:00', end_time: '12:00' },
      { day_of_week: 1, start_time: '13:00', end_time: '17:00' },
    ], /Monday is listed twice/],
  ]) {
    const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({ schedule });
    assert.equal(res.status, 400, JSON.stringify(schedule));
    assert.match(res.body.error, expected);
  }

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM cleaner_availability WHERE cleaner_id = $1', [cleaner.id]
  );
  assert.equal(rows[0].n, 0, 'nothing was stored by any of them');
});

test('a schedule that is not a list is refused', async () => {
  const cleaner = await seedCleaner({});
  const agent = await manager();
  const res = await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({ schedule: 'Mondays' });
  assert.equal(res.status, 400);
});

test('a cleaner who does not exist is a 404', async () => {
  const agent = await manager();
  const res = await agent.put('/api/cleaners/999999/availability').send({ schedule: MON_TO_WED });
  assert.equal(res.status, 404);
});

// --- telling them --------------------------------------------------------

test('the cleaner is told their usual days changed', async () => {
  // Somebody else deciding which days you work is the kind of thing you
  // find out by turning up on a day you no longer work.
  const cleaner = await seedCleaner({});
  const agent = await manager();

  await agent.put(`/api/cleaners/${cleaner.id}/availability`)
    .send({ schedule: MON_TO_WED }).expect(200);

  const { rows } = await pool.query(
    `SELECT event, audience, title, body FROM notifications WHERE cleaner_id = $1`,
    [cleaner.id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'availability_updated');
  assert.equal(rows[0].audience, 'cleaner', 'their feed, not the manager’s');
  assert.match(rows[0].title, /Mon, Tue, Wed/);
  assert.match(rows[0].body, /manager set this/);
});

test('saving the same pattern back tells them nothing', async () => {
  // Not news.
  const cleaner = await seedCleaner({});
  const agent = await manager();
  await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({ schedule: MON_TO_WED }).expect(200);
  await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({ schedule: MON_TO_WED }).expect(200);

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM notifications WHERE cleaner_id = $1', [cleaner.id]
  );
  assert.equal(rows[0].n, 1, 'one change, one message');
});

test('being given no days at all is still worth being told', async () => {
  const cleaner = await seedCleaner({});
  await seedAvailability(cleaner, 1, '09:00', '17:00');
  const agent = await manager();

  await agent.put(`/api/cleaners/${cleaner.id}/availability`).send({ schedule: [] }).expect(200);

  const { rows } = await pool.query(
    'SELECT title FROM notifications WHERE cleaner_id = $1', [cleaner.id]
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /no days/);
});
