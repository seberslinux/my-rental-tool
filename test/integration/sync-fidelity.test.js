const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const { pool } = require('../../src/db/database');

/**
 * Smoobu → Postgres data fidelity.
 *
 * These tests verify that every field from a Smoobu payload lands in the
 * right DB column, in the right format, with the right defaults — and that
 * both Smoobu payload dialects (kebab-case vs camelCase) work.
 *
 * If any of these regress, every downstream number in the app is silently
 * wrong: analytics chart, dashboard occupancy, cleaner payouts, P&L —
 * everything derives from these bookings rows.
 */

test.before(() => getApp());
test.beforeEach(async () => {
  await resetDb();
  mockSmoobu.reset();
});
test.after(() => closePool());

// Helpers -----------------------------------------------------------------

function todayPlus(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function syncAsAdmin(bookings, property, opts = {}) {
  const agent = await getAgent();
  const admin = opts.admin || await seedUser({ role: 'admin' });
  const prop = property || await seedProperty({ owner: admin, smoobu_id: 42 });
  await loginAs(agent, admin);
  mockSmoobu.setBookings(bookings);
  const res = await agent.post('/api/sync/bookings');
  return { res, admin, property: prop };
}

async function loadBooking(smoobuId) {
  const rows = await pool.query('SELECT * FROM bookings WHERE smoobu_id = $1', [smoobuId]);
  return rows.rows[0];
}

const toDateStr = (v) => new Date(v).toISOString().slice(0, 10);
const num = (v) => (v === null ? null : Number(v));

// ==========================================================================
// Section 1 — full field mapping (kebab-case dialect)
// ==========================================================================

test('kebab-case payload: every field maps to the correct DB column', async () => {
  // Uses Smoobu's older / documented payload shape:
  //   apartment: {id}, guest-name, arrival, departure, channel: {name},
  //   created-at, modified-at, price-details.
  const arrival = todayPlus(10);
  const departure = todayPlus(15); // 5-night stay
  const createdAt = todayPlus(-20).slice(0, 10);

  await syncAsAdmin([
    {
      id: 111,
      apartment: { id: 42 },
      'guest-name': 'Alice Kebab',
      arrival,
      departure,
      channel: { name: 'Airbnb' },
      price: 5000,
      adults: 3,
      'created-at': createdAt,
      'modified-at': '2025-01-15T10:30:00',
      'price-details': 'Total EUR 5000 including taxes',
    },
  ]);

  const b = await loadBooking(111);
  assert.ok(b, 'booking row must exist');
  assert.equal(b.smoobu_id, 111);
  assert.equal(b.guest_name, 'Alice Kebab');
  assert.equal(toDateStr(b.check_in), arrival);
  assert.equal(toDateStr(b.check_out), departure);
  assert.equal(b.platform, 'Airbnb');
  assert.equal(num(b.total_price), 5000);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.num_guests, 3);
  assert.equal(b.length_of_stay, 5);
  assert.equal(num(b.price_per_night), 1000); // 5000 / 5
  assert.equal(b.currency, 'EUR');            // detected from price-details
});

// ==========================================================================
// Section 2 — camelCase payload dialect
// ==========================================================================

test('camelCase payload: alternate field names also land correctly', async () => {
  // Smoobu's newer / API-response shape uses camelCase field names and a
  // plain-string channel. If any of these fallbacks break, live bookings
  // silently drop or misclassify.
  const arrival = todayPlus(20);
  const departure = todayPlus(25);

  await syncAsAdmin([
    {
      id: 222,
      apartmentId: 42, // NOT apartment.id
      guestName: 'Bob Camel',
      arrivalDate: arrival,
      departureDate: departure,
      channel: 'Booking.com', // NOT { name: ... }
      price: 4000,
      adults: 2,
      createdAt: todayPlus(-10).slice(0, 10),
      modifiedAt: '2025-05-01T08:00:00',
      priceDetails: 'Total USD 4000',
    },
  ]);

  const b = await loadBooking(222);
  assert.ok(b);
  assert.equal(b.guest_name, 'Bob Camel');
  assert.equal(toDateStr(b.check_in), arrival);
  assert.equal(toDateStr(b.check_out), departure);
  assert.equal(b.platform, 'Booking.com');
  assert.equal(num(b.total_price), 4000);
  assert.equal(b.num_guests, 2);
  assert.equal(b.length_of_stay, 5);
  assert.equal(num(b.price_per_night), 800); // 4000 / 5
  assert.equal(b.currency, 'USD');
});

// ==========================================================================
// Section 3 — length_of_stay computation
// ==========================================================================

test('length_of_stay: 1-night stay → 1', async () => {
  await syncAsAdmin([
    { id: 301, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(2), price: 100, adults: 1 },
  ]);
  assert.equal((await loadBooking(301)).length_of_stay, 1);
});

test('length_of_stay: 7-night stay → 7', async () => {
  await syncAsAdmin([
    { id: 302, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(8), price: 700, adults: 1 },
  ]);
  assert.equal((await loadBooking(302)).length_of_stay, 7);
});

test('length_of_stay: same-day (check_in == check_out) → 1 via Math.max floor', async () => {
  // Regression guard: naive subtraction gives 0, which would divide-by-zero
  // in price_per_night. Route uses Math.max(1, ...).
  await syncAsAdmin([
    { id: 303, apartment: { id: 42 }, arrival: todayPlus(5), departure: todayPlus(5), price: 500, adults: 1 },
  ]);
  const b = await loadBooking(303);
  assert.equal(b.length_of_stay, 1);
  assert.equal(num(b.price_per_night), 500); // 500 / 1, not NaN or Infinity
});

// ==========================================================================
// Section 4 — price_per_night computation
// ==========================================================================

test('price_per_night: exact division rounds correctly', async () => {
  // 1000 / 3 = 333.333... → rounded to 2 decimals = 333.33
  await syncAsAdmin([
    { id: 401, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(4), price: 1000, adults: 1 },
  ]);
  const b = await loadBooking(401);
  assert.equal(b.length_of_stay, 3);
  assert.equal(num(b.price_per_night), 333.33);
});

test('price_per_night: zero price → 0 (no NaN)', async () => {
  await syncAsAdmin([
    { id: 402, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3), price: 0, adults: 1 },
  ]);
  assert.equal(num((await loadBooking(402)).price_per_night), 0);
});

// ==========================================================================
// Section 5 — lead_time_days computation
// ==========================================================================

test('lead_time_days: check_in 30 days after created_at → 30', async () => {
  const created = '2025-05-01';
  const arrival = '2025-05-31'; // 30 days later
  await syncAsAdmin([
    { id: 501, apartment: { id: 42 }, arrival, departure: '2025-06-03', price: 1000, adults: 1, 'created-at': created },
  ]);
  assert.equal((await loadBooking(501)).lead_time_days, 30);
});

test('lead_time_days: missing created_at → 0', async () => {
  await syncAsAdmin([
    { id: 502, apartment: { id: 42 }, arrival: todayPlus(15), departure: todayPlus(18), price: 100, adults: 1 },
  ]);
  assert.equal((await loadBooking(502)).lead_time_days, 0);
});

test('lead_time_days: booked AFTER check-in (weird but possible) → clamped to 0', async () => {
  // Regression guard: Math.max(0, ...) prevents negative lead times from
  // corrupting the average.
  await syncAsAdmin([
    { id: 503, apartment: { id: 42 }, arrival: '2025-05-01', departure: '2025-05-04',
      price: 100, adults: 1, 'created-at': '2025-05-10' },
  ]);
  assert.equal((await loadBooking(503)).lead_time_days, 0);
});

// ==========================================================================
// Section 6 — currency detection + fallback chain
// ==========================================================================

test('currency: detected from price-details wins over property base', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 42, base_currency: 'ZAR' });
  await syncAsAdmin(
    [
      { id: 601, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3),
        price: 100, adults: 1, 'price-details': 'Total EUR 100' },
    ],
    property,
    { admin }
  );
  assert.equal((await loadBooking(601)).currency, 'EUR');
});

test('currency: falls back to property.base_currency when payload has none', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 42, base_currency: 'GBP' });
  await syncAsAdmin(
    [{ id: 602, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3), price: 100, adults: 1 }],
    property,
    { admin }
  );
  assert.equal((await loadBooking(602)).currency, 'GBP');
});

test('currency: falls back to ZAR when property currency is empty', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 42, base_currency: '' });
  await syncAsAdmin(
    [{ id: 603, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3), price: 100, adults: 1 }],
    property,
    { admin }
  );
  assert.equal((await loadBooking(603)).currency, 'ZAR');
});

test('currency: all supported currencies detected from price-details', async () => {
  // Guards against a regression in currency-detect.js that drops a currency
  // from the SUPPORTED_CURRENCIES regex.
  const currencies = ['EUR', 'ZAR', 'USD', 'GBP', 'CHF', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'CAD'];
  await syncAsAdmin(
    currencies.map((cur, i) => ({
      id: 610 + i,
      apartment: { id: 42 },
      arrival: todayPlus(i + 1),
      departure: todayPlus(i + 2),
      price: 100, adults: 1,
      'price-details': `Total ${cur} 100`,
    }))
  );
  for (let i = 0; i < currencies.length; i++) {
    const b = await loadBooking(610 + i);
    assert.equal(b.currency, currencies[i], `expected ${currencies[i]}`);
  }
});

// ==========================================================================
// Section 7 — defaults for missing/empty fields
// ==========================================================================

test('defaults: missing guest_name → empty string; missing adults → 1; missing platform → empty string', async () => {
  await syncAsAdmin([
    { id: 701, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(2), price: 100 },
  ]);
  const b = await loadBooking(701);
  assert.equal(b.guest_name, '');
  assert.equal(b.num_guests, 1);
  assert.equal(b.platform, '');
});

test('defaults: missing price → 0', async () => {
  await syncAsAdmin([
    { id: 702, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(2), adults: 1 },
  ]);
  assert.equal(num((await loadBooking(702)).total_price), 0);
});

// ==========================================================================
// Section 8 — cancellation classification
// ==========================================================================

test('classification: type="cancellation" → status="cancelled"', async () => {
  await syncAsAdmin([
    { id: 801, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3),
      price: 100, adults: 1, type: 'cancellation' },
  ]);
  assert.equal((await loadBooking(801)).status, 'cancelled');
});

test('classification: any other type (or none) → status="confirmed"', async () => {
  await syncAsAdmin([
    { id: 802, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3), price: 100, adults: 1 },
    { id: 803, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3), price: 100, adults: 1, type: 'reservation' },
  ]);
  assert.equal((await loadBooking(802)).status, 'confirmed');
  assert.equal((await loadBooking(803)).status, 'confirmed');
});

// ==========================================================================
// Section 9 — update semantics (ON CONFLICT DO UPDATE)
// ==========================================================================

test('sync semantic: re-sync wipes fields not present in latest Smoobu payload', async () => {
  // Pins the intended sync behaviour: Smoobu is the source of truth in the
  // sync window, so if it stops sending a field, the local DB drops it too.
  // (This is DIFFERENT from the webhook path — see webhook.test.js, which
  // preserves the old guest_name when the payload omits it. That difference
  // is intentional: sync = wholesale refresh, webhook = incremental edit.)
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 42 });
  await loginAs(agent, admin);

  mockSmoobu.setBookings([
    { id: 901, apartment: { id: 42 }, 'guest-name': 'Original Name',
      arrival: todayPlus(10), departure: todayPlus(13), price: 100, adults: 1 },
  ]);
  await agent.post('/api/sync/bookings').expect(200);
  assert.equal((await loadBooking(901)).guest_name, 'Original Name');

  mockSmoobu.setBookings([
    { id: 901, apartment: { id: 42 },
      arrival: todayPlus(10), departure: todayPlus(13), price: 100, adults: 1 },
  ]);
  await agent.post('/api/sync/bookings').expect(200);
  assert.equal(
    (await loadBooking(901)).guest_name,
    '',
    'sync must not preserve a field Smoobu no longer sends'
  );
});

test('update: check_in / check_out / price / num_guests / platform all overwritten in place', async () => {
  const agent = await getAgent();
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, smoobu_id: 42 });
  await loginAs(agent, admin);

  mockSmoobu.setBookings([
    { id: 902, apartment: { id: 42 }, 'guest-name': 'X',
      arrival: todayPlus(10), departure: todayPlus(13),
      channel: { name: 'Airbnb' }, price: 3000, adults: 2 },
  ]);
  await agent.post('/api/sync/bookings').expect(200);

  mockSmoobu.setBookings([
    { id: 902, apartment: { id: 42 }, 'guest-name': 'X',
      arrival: todayPlus(11), departure: todayPlus(15),
      channel: { name: 'Booking.com' }, price: 4500, adults: 4 },
  ]);
  await agent.post('/api/sync/bookings').expect(200);

  const b = await loadBooking(902);
  assert.equal(toDateStr(b.check_in), todayPlus(11));
  assert.equal(toDateStr(b.check_out), todayPlus(15));
  assert.equal(b.platform, 'Booking.com');
  assert.equal(num(b.total_price), 4500);
  assert.equal(b.num_guests, 4);
});

// ==========================================================================
// Section 9b — commission-included round-trip
// ==========================================================================

test('commission: Smoobu\'s commission-included field is stored on the row', async () => {
  // Regression guard for a real bug — the sync used to drop this field,
  // which broke net-revenue calculations downstream.
  await syncAsAdmin([
    {
      id: 950,
      apartment: { id: 42 },
      arrival: todayPlus(1),
      departure: todayPlus(3),
      price: 5000,
      adults: 2,
      channel: { name: 'Booking.com' },
      'commission-included': 750,
    },
  ]);

  const b = await loadBooking(950);
  assert.ok(b);
  assert.equal(Number(b.commission), 750);
  assert.equal(Number(b.total_price), 5000, 'gross price stays as sent (commission is included in it)');
});

test('commission: camelCase commissionIncluded also honoured', async () => {
  await syncAsAdmin([
    {
      id: 951,
      apartmentId: 42,
      arrivalDate: todayPlus(1),
      departureDate: todayPlus(3),
      price: 3000,
      adults: 2,
      channel: 'Airbnb',
      commissionIncluded: 450,
    },
  ]);
  const b = await loadBooking(951);
  assert.equal(Number(b.commission), 450);
});

test('commission: missing on payload → stored as 0', async () => {
  await syncAsAdmin([
    { id: 952, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3), price: 100, adults: 1 },
  ]);
  const b = await loadBooking(952);
  assert.equal(Number(b.commission), 0);
});

// ==========================================================================
// Section 9c — children round-trip
// ==========================================================================

test('children: stored separately from num_guests, which holds adults only', async () => {
  // Regression guard for a real under-report. Smoobu sends adults and
  // children as separate fields; this sync wrote only adults, so a family
  // of 2 + 2 was announced on the dashboard as "2 guests". Worse, because
  // the sync deletes and re-inserts its window, it also wiped the values
  // the historical sync had already stored.
  await syncAsAdmin([
    {
      id: 960, apartment: { id: 42 },
      arrival: todayPlus(1), departure: todayPlus(3),
      price: 5000, adults: 2, children: 2,
    },
  ]);

  const b = await loadBooking(960);
  assert.equal(b.num_guests, 2, 'num_guests holds adults');
  assert.equal(b.children, 2, 'children stored in its own column');
});

test('children: absent on the payload → 0, never null', async () => {
  await syncAsAdmin([
    { id: 961, apartment: { id: 42 }, arrival: todayPlus(1), departure: todayPlus(3),
      price: 100, adults: 1 },
  ]);
  assert.equal((await loadBooking(961)).children, 0);
});

test('children: a re-sync does not wipe a previously stored value', async () => {
  // The specific way this broke in production: the routine sync ran after
  // the historical one and silently zeroed the column.
  const payload = (children) => ([{
    id: 962, apartment: { id: 42 },
    arrival: todayPlus(1), departure: todayPlus(3),
    price: 5000, adults: 2, children,
  }]);

  const { admin, property } = await syncAsAdmin(payload(3));
  assert.equal((await loadBooking(962)).children, 3);

  // Same booking comes round again on the next sync.
  const agent = await getAgent();
  await loginAs(agent, admin);
  mockSmoobu.setBookings(payload(3));
  await agent.post('/api/sync/bookings').expect(200);

  assert.equal((await loadBooking(962)).children, 3, 're-sync must preserve children');
});

// ==========================================================================
// Section 10 — property linking robustness
// ==========================================================================

test('link: booking\'s property_id resolves via SELECT on smoobu_id', async () => {
  // Regression guard: the INSERT uses a subselect
  //   (SELECT id FROM properties WHERE smoobu_id = $2)
  // Both properties + bookings must be seeded/synced against smoobu_id
  // consistently; if the subselect returns NULL, the FK fires.
  const admin = await seedUser({ role: 'admin' });
  const propA = await seedProperty({ owner: admin, smoobu_id: 10001, name: 'Prop A' });
  const propB = await seedProperty({ owner: admin, smoobu_id: 10002, name: 'Prop B' });
  await syncAsAdmin(
    [
      { id: 1001, apartment: { id: 10001 }, arrival: todayPlus(1), departure: todayPlus(3), price: 100, adults: 1 },
      { id: 1002, apartment: { id: 10002 }, arrival: todayPlus(1), departure: todayPlus(3), price: 200, adults: 1 },
    ],
    propA,
    { admin }
  );
  assert.equal((await loadBooking(1001)).property_id, propA.id);
  assert.equal((await loadBooking(1002)).property_id, propB.id);
});
