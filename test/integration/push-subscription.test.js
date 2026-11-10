const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * Keeping the server's copy of a subscription true.
 *
 * A push subscription is an endpoint the push service owns and a
 * keypair the browser owns. The service only checks the endpoint and
 * the VAPID signature; the payload is encrypted end to end, so if the
 * server holds stale keys the message is accepted, delivered, and
 * silently discarded by a handset that cannot open it.
 *
 * Nothing upstream can see that. The server records `sent: 1`, the
 * settings screen says `ready` because the browser does have a
 * subscription, and an owner goes weeks without a notification while
 * every signal says they are on. The only cure is for the device to
 * re-assert what it holds, and for that to actually overwrite.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

const ENDPOINT = 'https://web.push.apple.com/QF2a8Xk-this-one-device';

const sub = (keys) => ({ endpoint: ENDPOINT, keys });

async function signedIn() {
  const user = await seedUser({ role: 'admin' });
  const agent = await getAgent();
  await loginAs(agent, user);
  return { agent, user };
}

const stored = () => pool.query('SELECT * FROM push_subscriptions').then((r) => r.rows);

test('re-subscribing the same device replaces its keys', async () => {
  // The repair. Without it a drifted row stays drifted forever, because
  // nothing else ever writes it.
  const { agent } = await signedIn();

  await agent.post('/api/push/subscribe')
    .send(sub({ p256dh: 'OLD-p256dh', auth: 'OLD-auth' })).expect(200);
  await agent.post('/api/push/subscribe')
    .send(sub({ p256dh: 'NEW-p256dh', auth: 'NEW-auth' })).expect(200);

  const rows = await stored();
  assert.equal(rows.length, 1, 'one device, one row');
  assert.equal(rows[0].p256dh, 'NEW-p256dh');
  assert.equal(rows[0].auth, 'NEW-auth');
});

test('a device that changed hands belongs to whoever is signed in now', async () => {
  // Francesca's old phone, now Patti's. Leaving the first owner on the
  // row would send one cleaner's shifts to another.
  const first = await seedUser({ role: 'admin' });
  const second = await seedUser({ role: 'admin' });

  const a = await getAgent();
  await loginAs(a, first);
  await a.post('/api/push/subscribe').send(sub({ p256dh: 'k', auth: 'a' })).expect(200);

  const b = await getAgent();
  await loginAs(b, second);
  await b.post('/api/push/subscribe').send(sub({ p256dh: 'k2', auth: 'a2' })).expect(200);

  const rows = await stored();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, second.id);
});

test('a payload that is not a subscription is refused', async () => {
  const { agent } = await signedIn();
  await agent.post('/api/push/subscribe').send({ endpoint: ENDPOINT }).expect(400);
  await agent.post('/api/push/subscribe').send({ keys: { p256dh: 'k', auth: 'a' } }).expect(400);
  assert.equal((await stored()).length, 0);
});

test('signed out, nobody registers a device', async () => {
  const app = await getApp();
  await require('supertest')(app).post('/api/push/subscribe')
    .send(sub({ p256dh: 'k', auth: 'a' })).expect(401);
});

test('turning it off removes the row, so nothing is pushed to it', async () => {
  const { agent } = await signedIn();
  await agent.post('/api/push/subscribe').send(sub({ p256dh: 'k', auth: 'a' })).expect(200);
  await agent.delete('/api/push/subscribe').send({ endpoint: ENDPOINT }).expect(200);
  assert.equal((await stored()).length, 0);
});
