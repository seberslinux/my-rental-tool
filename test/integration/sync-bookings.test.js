const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const { pool } = require('../../src/db/database');
const request = require('supertest');

// POST /api/sync/bookings pulls from Smoobu and mirrors into local DB.
// The route deletes bookings inside the sync window (30 days back → 180
// forward) and re-inserts what Smoobu returned, so its behaviour is:
//   - admin-only
//   - idempotent by construction (delete + re-insert on every run)
//   - transactional (a Smoobu-side failure mid-loop must roll back the delete)

test.before(() => getApp());
test.beforeEach(async () => {
  await resetDb();
  mockSmoobu.reset();
});
test.after(() => closePool());

// A Smoobu-shaped booking payload. `apartmentSmoobuId` links it to a local
// property via the `apartment.id` field.
function smoobuBooking(apartmentSmoobuId, overrides = {}) {
  const arrival = overrides.arrival ?? '2025-06-10';
  const departure = overrides.departure ?? '2025-06-13';
  return {
    id: overrides.id ?? Math.floor(Math.random() * 1e9),
    apartment: { id: apartmentSmoobuId },
    'guest-name': overrides['guest-name'] ?? 'Guest',
    arrival,
    departure,
    channel: { name: overrides.channel ?? 'Airbnb' },
    price: overrides.price ?? 3000,
    adults: overrides.adults ?? 2,
    ...overrides,
  };
}

// --- authorization --------------------------------------------------------

test('sync/bookings requires authentication → 401', async () => {
  const app = await getApp();
  await request(app).post('/api/sync/bookings').expect(401);
});

test('sync/bookings requires admin role → non-admin gets 403', async () => {
  const agent = await getAgent();
  const user = await seedUser({ role: 'property_manager' });
  await loginAs(agent, user);
  await agent.post('/api/sync/bookings').expect(403);
});

// --- happy path -----------------------------------------------------------

test('sync inserts each Smoobu booking as a local row', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 500 });
  await loginAs(agent, admin);

  const from = todayPlus(-5);
  const to = todayPlus(5);
  mockSmoobu.setBookings([
    smoobuBooking(500, { id: 1, arrival: from, departure: to, price: 4000 }),
    smoobuBooking(500, { id: 2, arrival: todayPlus(10), departure: todayPlus(15), price: 6000 }),
  ]);

  const res = await agent.post('/api/sync/bookings').expect(200);
  assert.equal(res.body.synced, 2);

  const rows = await pool.query('SELECT smoobu_id, total_price, property_id FROM bookings ORDER BY smoobu_id');
  assert.equal(rows.rowCount, 2);
  assert.equal(Number(rows.rows[0].total_price), 4000);
  assert.equal(Number(rows.rows[1].total_price), 6000);
  assert.ok(rows.rows.every((r) => r.property_id === property.id));
});

test('sync is idempotent — running twice leaves the same rows', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 501 });
  await loginAs(agent, admin);

  mockSmoobu.setBookings([
    smoobuBooking(501, { id: 10, price: 3000 }),
    smoobuBooking(501, { id: 11, price: 4000 }),
  ]);

  await agent.post('/api/sync/bookings').expect(200);
  await agent.post('/api/sync/bookings').expect(200);

  const count = await pool.query('SELECT count(*)::int FROM bookings');
  assert.equal(count.rows[0].count, 2, 'expected exactly 2 rows after two syncs');
});

test('sync updates existing rows in place when Smoobu returns modified data', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 502 });
  await loginAs(agent, admin);

  // First sync: baseline
  mockSmoobu.setBookings([smoobuBooking(502, { id: 99, 'guest-name': 'Alice', price: 3000 })]);
  await agent.post('/api/sync/bookings').expect(200);

  // Second sync: same booking, different fields
  mockSmoobu.setBookings([smoobuBooking(502, { id: 99, 'guest-name': 'Alice Updated', price: 4500, adults: 4 })]);
  await agent.post('/api/sync/bookings').expect(200);

  const rows = await pool.query('SELECT * FROM bookings WHERE smoobu_id = $1', [99]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].guest_name, 'Alice Updated');
  assert.equal(Number(rows.rows[0].total_price), 4500);
  assert.equal(rows.rows[0].num_guests, 4);
});

test('sync removes local bookings Smoobu no longer returns (within sync window)', async () => {
  // The sync deletes bookings inside [today - 30, today + 180] before
  // re-inserting Smoobu's response. So a booking that disappears from
  // Smoobu — but was inside that window — must disappear locally too.
  // Bookings outside the window are untouched (see the FK-rollback test
  // below for why we care about that).
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 503 });
  await loginAs(agent, admin);

  const arrival = todayPlus(15); // safely inside the [today - 30, today + 180] window
  const departure = todayPlus(18);
  mockSmoobu.setBookings([
    smoobuBooking(503, { id: 20, arrival, departure }),
    smoobuBooking(503, { id: 21, arrival, departure }),
  ]);
  await agent.post('/api/sync/bookings').expect(200);
  assert.equal((await pool.query('SELECT count(*)::int FROM bookings')).rows[0].count, 2);

  mockSmoobu.setBookings([smoobuBooking(503, { id: 20, arrival, departure })]); // id 21 gone
  await agent.post('/api/sync/bookings').expect(200);

  const rows = await pool.query('SELECT smoobu_id FROM bookings ORDER BY smoobu_id');
  assert.deepEqual(rows.rows.map((r) => Number(r.smoobu_id)), [20]);
});

test('sync classifies "cancellation" payloads as status=cancelled', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 504 });
  await loginAs(agent, admin);

  mockSmoobu.setBookings([
    smoobuBooking(504, { id: 30, type: 'cancellation' }),
  ]);
  await agent.post('/api/sync/bookings').expect(200);

  const rows = await pool.query('SELECT status FROM bookings WHERE smoobu_id = $1', [30]);
  assert.equal(rows.rows[0].status, 'cancelled');
});

// --- pagination -----------------------------------------------------------

test('sync walks all pages until Smoobu returns a short page', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  await seedProperty({ owner: admin, smoobu_id: 505 });
  await loginAs(agent, admin);

  // Two full pages of 100 + one short page = handler should hit all three.
  const page1 = Array.from({ length: 100 }, (_, i) => smoobuBooking(505, { id: 1000 + i }));
  const page2 = Array.from({ length: 100 }, (_, i) => smoobuBooking(505, { id: 2000 + i }));
  const page3 = Array.from({ length: 5 }, (_, i) => smoobuBooking(505, { id: 3000 + i }));
  mockSmoobu.setBookings([page1, page2, page3]);

  const res = await agent.post('/api/sync/bookings').expect(200);
  assert.equal(res.body.synced, 205);
  const count = await pool.query('SELECT count(*)::int FROM bookings');
  assert.equal(count.rows[0].count, 205);
});

// --- failure modes --------------------------------------------------------

test('Smoobu HTTP failure mid-sync rolls back — no partial writes', async () => {
  // The route's per-booking INSERT loop runs inside `transaction(...)`. If
  // any DB error mid-loop throws, the outer transaction rolls back the
  // DELETE too. We simulate this by having Smoobu return a payload whose
  // apartment.id doesn't match any local property (which causes the INSERT's
  // subselect to be NULL, tripping the FK).
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 506 });
  await loginAs(agent, admin);

  // Baseline data that should survive the failed sync.
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, length_of_stay)
     VALUES (777, $1, 'Preexisting', '2020-01-10', '2020-01-13', 'Direct', 1500, 'confirmed', 1, 3)`,
    [property.id]
  );

  mockSmoobu.setBookings([
    smoobuBooking(506, { id: 1 }),                              // valid
    smoobuBooking(999999, { id: 2 }),                            // apartment doesn't exist → FK violation
  ]);

  const res = await agent.post('/api/sync/bookings');
  assert.notEqual(res.status, 200, `expected non-200; got ${res.status}, body ${JSON.stringify(res.body)}`);

  // The pre-existing baseline row is outside the sync window (Jan 2020) so
  // it must still be present regardless — but critically, the *new* bookings
  // from this sync must not be there.
  const survived = await pool.query('SELECT smoobu_id FROM bookings WHERE smoobu_id = 777');
  assert.equal(survived.rowCount, 1, 'baseline row outside the sync window was wiped by a failed sync');
  const inserted = await pool.query('SELECT smoobu_id FROM bookings WHERE smoobu_id IN (1, 2)');
  assert.equal(inserted.rowCount, 0, 'partial writes leaked from a failed sync');
});

test('Smoobu API failure surfaces as 5xx and does not touch DB', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 507 });
  await loginAs(agent, admin);

  // Seed a baseline row inside the sync window that should NOT be deleted
  // when Smoobu itself fails before any writes happen.
  await pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, length_of_stay)
     VALUES (888, $1, 'Preexisting', $2, $3, 'Direct', 1500, 'confirmed', 1, 3)`,
    [property.id, todayPlus(0), todayPlus(3)]
  );

  mockSmoobu.makeFail(new Error('Smoobu 503 upstream error'), 'getBookings');

  const res = await agent.post('/api/sync/bookings');
  assert.equal(res.status, 500);

  // Baseline row must still be there — the delete only runs inside the
  // transaction, which never started because Smoobu threw first.
  const survived = await pool.query('SELECT smoobu_id FROM bookings WHERE smoobu_id = 888');
  assert.equal(survived.rowCount, 1);
});

// --- helpers --------------------------------------------------------------

function todayPlus(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
