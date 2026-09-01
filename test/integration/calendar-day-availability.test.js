const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const {
  seedUser, seedProperty, seedCleaner, linkCleanerToProperty,
  seedAvailability, seedAvailabilityOverride, loginAs,
} = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { inDays, weekdayOf } = require('../helpers/dates');

/**
 * What the calendar's day sheet needs in order to offer a change.
 *
 * The sheet lists who can work a day. Until now that was all it could
 * do — it said who was free and gave you no way to change it, so a
 * cleaner ringing to say they cannot make Thursday sent you two screens
 * away to record it.
 *
 * Offering the change needs two things the entries did not carry.
 * Whether the day was *set* or is the weekly pattern showing through,
 * because "put it back to their usual" is a different act from "mark
 * them available" — an override wins outright, hours included, so a
 * blanket yes would offer somebody an afternoon they never work. And
 * whether they are down at another property, because that is not
 * something their availability can fix and a button implying otherwise
 * is worse than no button.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const DATE = inDays(10);

async function setup() {
  const user = await seedUser({ role: 'property_manager' });
  const property = await seedProperty({ owner: user });
  const cleaner = await seedCleaner({ name: 'Francesca' });
  await linkCleanerToProperty(cleaner, property);
  await seedAvailability(cleaner, weekdayOf(DATE), '09:00', '17:00');
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, cleaner, property };
}

/** The entry for one cleaner on one day, from whichever list holds them. */
async function entryFor(agent, cleanerId, date = DATE) {
  const res = await agent.get(`/api/cleaners/calendar?from=${date}&to=${date}`).expect(200);
  const day = res.body.days[date];
  return [...day.available, ...day.unavailable].find((c) => c.id === cleanerId);
}

// --- set, or just the pattern --------------------------------------------

test('a day nobody has touched is not reported as set', async () => {
  const { agent, cleaner } = await setup();
  const entry = await entryFor(agent, cleaner.id);
  assert.equal(entry.override, false, 'this is their weekly pattern showing through');
  assert.equal(entry.reason, 'works that weekday');
});

test('a day somebody marked off is reported as set', async () => {
  // Which is what makes "back to their usual" offerable, and only where
  // there is something to put back.
  const { agent, cleaner } = await setup();
  await seedAvailabilityOverride(cleaner, DATE, false);

  const entry = await entryFor(agent, cleaner.id);
  assert.equal(entry.override, true);
  assert.equal(entry.reason, 'unavailable that day');
});

test('a day marked available against the pattern is also set', async () => {
  // The other direction: a day they do not usually work, said yes to.
  const { agent, cleaner } = await setup();
  const off = inDays(11);
  await seedAvailabilityOverride(cleaner, off, true);

  const entry = await entryFor(agent, cleaner.id, off);
  assert.equal(entry.override, true);
  assert.equal(entry.reason, 'available that day');
});

test('clearing the day puts the pattern back and stops it being set', async () => {
  const { agent, cleaner } = await setup();
  await agent.post(`/api/cleaners/${cleaner.id}/overrides`)
    .send({ date: DATE, available: false }).expect(200);
  assert.equal((await entryFor(agent, cleaner.id)).override, true);

  await agent.delete(`/api/cleaners/${cleaner.id}/overrides?date=${DATE}`).expect(200);

  const entry = await entryFor(agent, cleaner.id);
  assert.equal(entry.override, false, 'nothing left to take back');
  assert.equal(entry.reason, 'works that weekday');
});

// --- booked elsewhere ----------------------------------------------------

test('somebody down at another property is marked as such', async () => {
  // Their availability is not what is in the way, so the sheet says
  // "already booked" rather than offering a change that cannot help.
  const { agent, cleaner, property } = await setup();
  const user = await seedUser({ role: 'property_manager' });
  const other = await seedProperty({ owner: user, name: 'The other place' });
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, '09:00', '12:00', 'confirmed')`,
    [other.id, cleaner.id, DATE]
  );

  const entry = await entryFor(agent, cleaner.id);
  assert.equal(entry.committed, true);
  assert.match(entry.reason, /already at/);
  assert.ok(property.id, 'the property they were free for is beside the point');
});

test('a declined job is not something they are committed to', async () => {
  // They said no, so the day is theirs again and the sheet may offer it.
  const { agent, cleaner, property } = await setup();
  await pool.query(
    `INSERT INTO cleaning_jobs (property_id, cleaner_id, cleaning_date, start_time, end_time, status)
     VALUES ($1, $2, $3, '09:00', '12:00', 'declined')`,
    [property.id, cleaner.id, DATE]
  );

  const entry = await entryFor(agent, cleaner.id);
  assert.equal(entry.committed, false);
});

test('everybody who cleans the property appears somewhere, free or not', async () => {
  // The sheet builds its list from both, so somebody in neither would
  // simply be missing from the day.
  const { agent, cleaner, property } = await setup();
  const second = await seedCleaner({ name: 'Ayanda' });
  await linkCleanerToProperty(second, property);

  const res = await agent.get(`/api/cleaners/calendar?from=${DATE}&to=${DATE}`).expect(200);
  const day = res.body.days[DATE];
  const ids = [...day.available, ...day.unavailable].map((c) => c.id);
  assert.ok(ids.includes(cleaner.id));
  assert.ok(ids.includes(second.id), 'no weekly pattern is still somebody you can set a day for');
});
