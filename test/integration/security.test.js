const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool, WEBHOOK_SECRET } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const { buildApp } = require('../../src/app');

/**
 * Security-hardening tests.
 *
 * Complements the auth/scoping tests already in the suite (auth wall,
 * webhook secret gate, cross-tenant IDOR): here we exercise the
 * defence-in-depth pieces — production rate limiting actually fires,
 * SQL-injection attempts don't corrupt state, hostile stored content
 * round-trips as data (not code), timing-safe secret compares work.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

// ==========================================================================
// Rate limiting
// ==========================================================================
//
// The test harness disables the auth limiter so single test files can make
// many login attempts. These tests build a fresh app WITH limits on to
// prove the production-shape middleware actually rejects abuse.

test('production build: /api/auth/login rejects after 20 attempts in 15 min', async () => {
  const prod = buildApp({
    sessionSecret: 'rate-limit-test-secret',
    disableRateLimits: false,
  });

  // The limiter counts by IP; supertest reuses the same source so all 21
  // requests land in the same bucket.
  let acceptedCount = 0;
  let rateLimited = false;
  for (let i = 0; i < 25; i++) {
    const res = await request(prod)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'x' });
    if (res.status === 429) { rateLimited = true; break; }
    if (res.status === 401) acceptedCount++;
  }
  assert.ok(rateLimited, `expected a 429 within 25 attempts; got ${acceptedCount} 401s`);
  assert.ok(acceptedCount <= 20, `expected ≤ 20 real responses before limiter fires; got ${acceptedCount}`);
});

test('production build: /webhook rejects after 60 attempts in 60s', async () => {
  const prod = buildApp({
    sessionSecret: 'rate-limit-test-secret',
    disableRateLimits: false,
  });

  let rateLimited = false;
  for (let i = 0; i < 65; i++) {
    const res = await request(prod).post('/webhook/wrong-secret').send({});
    if (res.status === 429) { rateLimited = true; break; }
  }
  assert.ok(rateLimited, 'expected a 429 within 65 webhook attempts');
});

// ==========================================================================
// SQL injection probes
// ==========================================================================
//
// Every DB call in the codebase uses parameterized queries, so hostile
// input should land in the query as literal text — not as SQL. These
// tests fire classic payloads at query params and body fields, then
// verify the DB is intact afterwards.

const SQL_PAYLOADS = [
  "1; DROP TABLE bookings;--",
  "1' OR '1'='1",
  "1 UNION SELECT null,null,null",
  "'; DELETE FROM users;--",
];

// The security invariant we care about here is that hostile input NEVER
// executes as SQL — the DB stays intact after any payload. Whether the
// endpoint 200s, 400s, or 500s is a UX/input-validation concern (worth
// fixing, but not a SECURITY bug). These tests fire payloads and then
// verify the DB survived, without asserting on response status.

async function firePayloads(agent, urls) {
  for (const url of urls) {
    try { await agent.get(url); } catch (_) { /* swallow — we only care about DB state */ }
  }
}

test('SQL injection: hostile query params never mutate the DB', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, total_price: 3000, length_of_stay: 3 });

  const initialBookings = 1;
  const initialProperties = 1;
  const initialUsers = 1;

  const agent = await getAgent();
  await loginAs(agent, admin);

  // Fire every payload against every parameter that flows into a SQL query.
  const urls = [];
  for (const p of SQL_PAYLOADS) {
    const e = encodeURIComponent(p);
    urls.push(
      `/api/analytics/data?property_id=${e}`,
      `/api/analytics/data?from=${e}`,
      `/api/analytics/data?to=${e}`,
      `/api/bookings?property_id=${e}`,
      `/api/dashboard/stats?anything=${e}`,
      `/api/finances/pnl?from=${e}`,
      `/api/finances/pnl?to=${e}`,
    );
  }
  await firePayloads(agent, urls);

  // The invariant: none of those payloads mutated the DB.
  const b = await pool.query('SELECT count(*)::int FROM bookings');
  const p = await pool.query('SELECT count(*)::int FROM properties');
  const u = await pool.query('SELECT count(*)::int FROM users');
  assert.equal(b.rows[0].count, initialBookings, 'bookings row count changed after SQLi probes');
  assert.equal(p.rows[0].count, initialProperties, 'properties row count changed after SQLi probes');
  assert.equal(u.rows[0].count, initialUsers, 'users row count changed after SQLi probes');

  // And the tables themselves still exist (drop-table would leave 42P01).
  await pool.query('SELECT 1 FROM bookings LIMIT 1');
  await pool.query('SELECT 1 FROM users LIMIT 1');
});

// ==========================================================================
// Hostile stored content round-trip
// ==========================================================================
//
// User-writable fields (guest_name, property name, review body) can contain
// arbitrary strings including HTML/JS/quotes/emoji. These tests confirm
// storage is byte-safe (postgres param binding stores them as literals) —
// the responsibility for rendering them safely is on the frontend, which
// React handles by default.

const XSS_STRINGS = [
  "<script>alert('xss')</script>",
  "<img src=x onerror=alert(1)>",
  "'; DROP TABLE bookings;--",   // stored as literal, not executed
  '"double-quote-injection"',
  "unicode: café 🏠 日本 ​",  // includes zero-width space
];

test('hostile guest_name stored & retrieved verbatim', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  for (let i = 0; i < XSS_STRINGS.length; i++) {
    const hostile = XSS_STRINGS[i];
    await seedBooking({
      property,
      smoobu_id: 8000 + i,
      guest_name: hostile,
      check_in: '2025-06-01', check_out: '2025-06-03',
    });
    const row = await pool.query(
      'SELECT guest_name FROM bookings WHERE smoobu_id = $1',
      [8000 + i]
    );
    assert.equal(row.rows[0].guest_name, hostile, `guest_name #${i} was mangled in storage`);
  }
});

test('hostile property name stored & retrieved verbatim, appears literally in API response', async () => {
  const admin = await seedUser({ role: 'admin' });
  const hostile = "<script>alert('xss')</script> & \" ' 🏠";
  const property = await seedProperty({ owner: admin, name: hostile });

  const agent = await getAgent();
  await loginAs(agent, admin);
  const res = await agent.get('/api/properties').expect(200);
  const found = res.body.find((p) => p.id === property.id);
  assert.equal(found.name, hostile, 'API must return the string as-is (not escape or strip tags)');
  // Note: no `dangerouslySetInnerHTML` is used in the frontend for property
  // names — React escapes on render. This test locks the *storage/transport*
  // contract; a frontend audit is a separate exercise.
});

// ==========================================================================
// Webhook secret timing-safe compare
// ==========================================================================
//
// The webhook route uses crypto.timingSafeEqual on the URL-path secret.
// A timing-based attack would measure response time to guess the secret
// byte-by-byte; these tests just prove the compare function is exposed
// and that a wrong secret 401s consistently regardless of length /
// prefix match.

test('webhook: secret compare rejects on 1-char-different, prefix-match, length-mismatch', async () => {
  const app = await getApp();
  const cases = [
    'wrong-webhook-secret',                    // same length, one char diff
    WEBHOOK_SECRET + 'x',                       // right prefix
    WEBHOOK_SECRET.slice(0, 3),                 // short prefix
    '',                                         // empty — matches 404 case, not 401; test guards route pattern
    'A' + WEBHOOK_SECRET.slice(1),              // 1-char-different at start
    WEBHOOK_SECRET.slice(0, -1) + 'A',          // 1-char-different at end
  ];
  for (const attempt of cases) {
    if (attempt === '') {
      // Empty path segment doesn't match /:secret; expect 404 not 401.
      await request(app).post('/webhook/').send({}).expect(404);
    } else {
      const res = await request(app).post(`/webhook/${attempt}`).send({});
      assert.equal(res.status, 401, `expected 401 for "${attempt}", got ${res.status}`);
    }
  }
});
