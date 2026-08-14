const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedCleaner, loginAs, linkCleanerToProperty } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * Asking for supplies, and being told about it.
 *
 * The request was recorded and nobody was told. `supplies_needed` had
 * been in the events table since it was written and was fired from
 * nowhere, so the only form in the cleaner's app that reached the owner
 * was the maintenance one — and cleaners used it for supplies, because
 * that was the one that visibly worked. Laundry liquid arrived as a
 * reported fault while the shopping list sat silent.
 */

async function signedInCleaner(phone = '+27821234567') {
  const cleaner = await seedCleaner({ phone });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [
    bcrypt.hashSync('1234', 4), cleaner.id,
  ]);
  const agent = await getAgent();
  await agent.post('/api/auth/cleaner-login').send({ phone, pin: '1234' }).expect(200);
  return { cleaner, agent };
}

test.before(async () => { await resetDb(); });
test.after(async () => { await closePool(); });

// --- being told ----------------------------------------------------------

test('a cleaner asking for supplies tells the owner', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);

  await agent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Laundry liquid', notes: 'The big one' })
    .expect(201);

  const { rows } = await pool.query(
    `SELECT event, severity, audience, title, body, link FROM notifications WHERE property_id = $1`,
    [property.id]
  );
  assert.equal(rows.length, 1, 'exactly one, and it exists at all');
  assert.equal(rows[0].event, 'supplies_needed');
  assert.equal(rows[0].severity, 'attention', 'it is meant to reach a phone, not just the feed');
  assert.equal(rows[0].audience, 'owner');
  // A link that points at a screen. It pointed at '/' before, which is
  // the URL the app is most likely already on — and navigating to where
  // you already are looks exactly like a dead link.
  assert.equal(rows[0].link, '/reported');
  assert.match(rows[0].title, new RegExp(cleaner.name));
  assert.match(rows[0].title, /Laundry liquid/);
  assert.match(rows[0].body, /The big one/);
});

test('an owner adding to their own list is not messaged about it', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const agent = await getAgent();
  await loginAs(agent, owner);

  await agent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Coffee' })
    .expect(201);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM notifications');
  assert.equal(rows[0].n, 0, 'telling yourself what you just did is noise');
});

// --- seeing it -----------------------------------------------------------

test('the request shows on the front page', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, name: 'Hill Top Lodge' });
  const { cleaner, agent: cleanerAgent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);

  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Bin liners', quantity: 3, unit: 'rolls' })
    .expect(201);

  const owned = await getAgent();
  await loginAs(owned, owner);
  const res = await owned.get('/api/dashboard/today').expect(200);

  assert.equal(res.body.supplies.length, 1);
  const s = res.body.supplies[0];
  assert.equal(s.item, 'Bin liners');
  assert.equal(s.property, 'Hill Top Lodge');
  assert.equal(s.who, cleaner.name, 'who asked');
  assert.equal(s.amount, '3 rolls');

  // It is not also raised as something that will go wrong today.
  assert.equal(res.body.needs.filter((n) => /liner/i.test(n.title)).length, 0);
});

test('another owner\'s supplies are not on your front page', async () => {
  await resetDb();
  const mine = await seedUser({ role: 'property_manager' });
  const theirs = await seedUser({ role: 'property_manager' });
  const myProperty = await seedProperty({ owner: mine });
  const theirProperty = await seedProperty({ owner: theirs });
  const { cleaner, agent: cleanerAgent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, theirProperty);

  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: theirProperty.id, item_name: 'Not yours' })
    .expect(201);

  const agent = await getAgent();
  await loginAs(agent, mine);
  const res = await agent.get('/api/dashboard/today').expect(200);
  assert.deepEqual(res.body.supplies, [], `and ${myProperty.name} has nothing of its own`);
});

// --- ticking it off ------------------------------------------------------

test('bought takes it off the list', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const { cleaner, agent: cleanerAgent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);
  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Dishwasher tablets' }).expect(201);

  const agent = await getAgent();
  await loginAs(agent, owner);
  const before = await agent.get('/api/dashboard/today').expect(200);
  const id = before.body.supplies[0].id;

  await agent.patch(`/api/supplies/${id}/purchased`).expect(200);

  const after = await agent.get('/api/dashboard/today').expect(200);
  assert.deepEqual(after.body.supplies, [], 'gone from the front page');

  const { rows } = await pool.query('SELECT status, purchased_at FROM shopping_list WHERE id = $1', [id]);
  assert.equal(rows[0].status, 'purchased');
  assert.ok(rows[0].purchased_at, 'and when');
});

test('you cannot tick off an item at a property you cannot see', async () => {
  // The cleaner portal's own route takes an id and updates it, with no
  // scoping at all. That is safe enough among cleaners reaching their own
  // list; it is not the owner's button.
  await resetDb();
  const mine = await seedUser({ role: 'property_manager' });
  const theirs = await seedUser({ role: 'property_manager' });
  const theirProperty = await seedProperty({ owner: theirs });
  const { cleaner, agent: cleanerAgent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, theirProperty);
  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: theirProperty.id, item_name: 'Not yours' }).expect(201);

  const { rows: seeded } = await pool.query('SELECT id FROM shopping_list');
  const agent = await getAgent();
  await loginAs(agent, mine);

  const res = await agent.patch(`/api/supplies/${seeded[0].id}/purchased`);
  assert.equal(res.status, 403);

  const { rows } = await pool.query('SELECT status FROM shopping_list WHERE id = $1', [seeded[0].id]);
  assert.equal(rows[0].status, 'needed', 'untouched');
});

// --- the whole list, bought ones included --------------------------------

test('the full list keeps what has been bought', async () => {
  // The front page carries what is outstanding. This is the other
  // question — did anybody actually get it — and the card cannot answer
  // it, because a bought item leaves the card entirely.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, name: 'Hill Top Lodge' });
  const { cleaner, agent: cleanerAgent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, property);
  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Laundry liquid' }).expect(201);
  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: property.id, item_name: 'Bin liners' }).expect(201);

  const agent = await getAgent();
  await loginAs(agent, owner);

  const liquid = (await agent.get('/api/supplies').expect(200)).body
    .find((s) => s.item_name === 'Laundry liquid');
  await agent.patch(`/api/supplies/${liquid.id}/purchased`).expect(200);

  const all = (await agent.get('/api/supplies').expect(200)).body;
  assert.equal(all.length, 2, 'both still listed');
  const byName = Object.fromEntries(all.map((s) => [s.item_name, s]));
  assert.equal(byName['Laundry liquid'].status, 'purchased');
  assert.equal(byName['Bin liners'].status, 'needed');
  assert.equal(byName['Bin liners'].property, 'Hill Top Lodge', 'named, for a list across properties');
  assert.equal(byName['Bin liners'].added_by_name, cleaner.name);

  // …while the front page carries only what is left to do.
  const today = await agent.get('/api/dashboard/today').expect(200);
  assert.deepEqual(today.body.supplies.map((s) => s.item), ['Bin liners']);
});

test('the full list is scoped to your own properties', async () => {
  await resetDb();
  const mine = await seedUser({ role: 'property_manager' });
  const theirs = await seedUser({ role: 'property_manager' });
  await seedProperty({ owner: mine });
  const theirProperty = await seedProperty({ owner: theirs });
  const { cleaner, agent: cleanerAgent } = await signedInCleaner();
  await linkCleanerToProperty(cleaner, theirProperty);
  await cleanerAgent.post('/api/cleaner-portal/shopping-list')
    .send({ property_id: theirProperty.id, item_name: 'Not yours' }).expect(201);

  const agent = await getAgent();
  await loginAs(agent, mine);
  assert.deepEqual((await agent.get('/api/supplies').expect(200)).body, []);
});

test('an item that is not on the list at all is a 404', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  await seedProperty({ owner });
  const agent = await getAgent();
  await loginAs(agent, owner);

  const res = await agent.patch('/api/supplies/999999/purchased');
  assert.equal(res.status, 404);
});
