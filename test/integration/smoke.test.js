const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, loginAs } = require('../helpers/seed');
const request = require('supertest');

// One end-to-end smoke test that proves the whole integration stack works:
//   - Docker Postgres is reachable via DATABASE_URL.
//   - runMigrations() completes.
//   - buildApp() produces a usable Express app.
//   - The auth wall rejects unauthenticated /api requests.
//   - Local-strategy login creates a session cookie.
//   - The cookie authenticates subsequent requests.
//   - Session round-trip works via PgSession.
//
// If any of these regress, the entire integration test suite fails at this
// file, making the root cause obvious.

test.before(async () => {
  // Prime the app (runs migrations, builds Express) so the first real test
  // isn't the one paying that cost.
  await getApp();
});

test.beforeEach(async () => {
  await resetDb();
});

test.after(async () => {
  await closePool();
});

test('unauthenticated GET /api/auth/me returns 401', async () => {
  const app = await getApp();
  await request(app).get('/api/auth/me').expect(401);
});

test('login → /api/auth/me returns the logged-in user', async () => {
  const user = await seedUser({ email: 'smoke@test.local', role: 'admin' });
  const agent = await getAgent();

  await loginAs(agent, user);

  const res = await agent.get('/api/auth/me').expect(200);
  assert.equal(res.body.email, 'smoke@test.local');
  assert.equal(res.body.role, 'admin');
});

test('login with wrong password → 401', async () => {
  await seedUser({ email: 'wrongpw@test.local' });
  const agent = await getAgent();

  await agent
    .post('/api/auth/login')
    .send({ email: 'wrongpw@test.local', password: 'not-the-password' })
    .expect(401);
});

test('login for nonexistent user → 401', async () => {
  const agent = await getAgent();

  await agent
    .post('/api/auth/login')
    .send({ email: 'ghost@test.local', password: 'anything' })
    .expect(401);
});

test('after logout, session no longer authenticates', async () => {
  const user = await seedUser({ email: 'logout@test.local' });
  const agent = await getAgent();

  await loginAs(agent, user);
  await agent.get('/api/auth/me').expect(200);

  await agent.post('/api/auth/logout').expect(200);
  await agent.get('/api/auth/me').expect(401);
});
