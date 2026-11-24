const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const { inDays, todayISO } = require('../helpers/dates');
const mock = require('../helpers/mock-smoobu');
const smoobu = require('../../src/services/smoobu');
const paystack = require('../../src/services/paystack');
const notifyModule = require('../../src/services/notify');
const accounts = require('../../src/services/payment-accounts');
const { pool } = require('../../src/db/database');

const KEY = 'sk_live_website';
let app;
let paystackCalls;
let reservations;
const originalNotify = notifyModule.notify;

function fakePaystack(url, opts) {
  const body = opts.body ? JSON.parse(opts.body) : null;
  paystackCalls.push({ url, body, auth: opts.headers.Authorization });
  let data = [];
  if (url.endsWith('/transaction/initialize')) data = { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference };
  else if (url.includes('/transaction/verify/')) {
    const init = paystackCalls.find((c) => c.url.endsWith('/transaction/initialize'));
    data = { status: 'success', amount: init.body.amount, currency: 'ZAR' };
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: true, data }) });
}

test.before(async () => { app = await getApp(); });
test.beforeEach(async () => {
  await resetDb();
  mock.reset();
  process.env.SMOOBU_DIRECT_CHANNEL_ID = '3697409';
  paystackCalls = [];
  paystack.setFetch(fakePaystack);
  reservations = [];
  smoobu.createReservation = async (f) => { reservations.push(f); return { id: 777 }; };
  notifyModule.notify = async () => {};
});
test.after(async () => {
  paystack.setFetch(null);
  notifyModule.notify = originalNotify;
  delete process.env.SMOOBU_DIRECT_CHANNEL_ID;
  await closePool();
});

/** The Loft: R1,500 a night for the next 60 nights, minimum 2, sleeps 3, R500 cleaning, 20.5% Airbnb markup. */
async function loft(admin, { connect = true } = {}) {
  const p = await seedProperty({ owner: admin, name: 'The loft', max_guests: 3 });
  await pool.query('UPDATE properties SET guest_markup_airbnb = 20.5 WHERE id = $1', [p.id]);
  const l = (await pool.query(`INSERT INTO peer_listings (airbnb_id, name, property_id, is_own) VALUES ('loft-own', 'Scarborough Loft', $1, TRUE) RETURNING id`, [p.id])).rows[0];
  await pool.query(`INSERT INTO peer_cleaning_fees (listing_id, check_in, nights, fee) VALUES ($1, $2, 2, 500)`, [l.id, inDays(10)]);
  const rates = {};
  for (let i = 1; i <= 60; i++) rates[inDays(i)] = { price: 1500, available: 1, min_length_of_stay: 2 };
  rates[inDays(20)] = { price: 1500, available: 0, min_length_of_stay: 2 };
  rates[inDays(40)] = { price: 1500, available: 1, min_length_of_stay: 4 };
  mock.setDailyRates({ [p.smoobu_id]: rates });
  if (connect) await accounts.connect(p.id, { secretKey: KEY, accountName: 'Francesca' });
  return p;
}

function switchOn(agent, p, extra = {}) {
  return agent.put(`/api/payment-links/website/${p.id}`).send({ enabled: true, slug: 'the-loft', ...extra });
}

test('a property is on the website only when switched on and paid into a Paystack account', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin, { connect: false });
  const agent = await getAgent();
  await loginAs(agent, admin);

  await request(app).get('/book/the-loft').expect(404);
  await switchOn(agent, p).expect(409);
  await accounts.connect(p.id, { secretKey: KEY, accountName: 'Francesca' });
  const { body } = await switchOn(agent, p).expect(200);
  assert.deepEqual({ enabled: body.enabled, slug: body.slug, paystack: body.paystack }, { enabled: true, slug: 'the-loft', paystack: true });

  const page = await request(app).get('/book/the-loft').expect(200);
  assert.match(page.text, /The loft/);
  assert.match(page.text, /sleeps 3/);

  await accounts.disconnect(p.id);
  await request(app).get('/book/the-loft').expect(404, /cannot be booked here/);
});

test('the calendar shows the free nights a year ahead, from tomorrow', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin);
  const agent = await getAgent();
  await loginAs(agent, admin);
  await switchOn(agent, p).expect(200);

  const { body } = await request(app).get('/book/the-loft/availability').expect(200);
  assert.equal(body.from, inDays(1));
  assert.ok(body.open.includes(inDays(19)));
  assert.ok(!body.open.includes(inDays(20)), 'a taken night is not open');
  assert.ok(!body.open.includes(todayISO()));
  assert.equal(body.min_stay[inDays(40)], 4);
});

test('the price is the direct price, and a stay the rules do not allow says why', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin);
  const agent = await getAgent();
  await loginAs(agent, admin);
  await switchOn(agent, p).expect(200);
  const q = (ci, co, adults = 2) => request(app).get(`/book/the-loft/price?check_in=${ci}&check_out=${co}&adults=${adults}`);

  const { body } = await q(inDays(5), inDays(7)).expect(200);
  assert.equal(body.bookable, true);
  assert.equal(body.airbnb_total, 4120, '3,000 × 1.205 + 500, to the R10');
  assert.equal(body.total, 3710, '10% below');
  assert.equal(body.rates, undefined, 'no breakdown of our rates');

  assert.equal((await q(inDays(19), inDays(21)).expect(200)).body.bookable, false);
  const short = (await q(inDays(40), inDays(42)).expect(200)).body;
  assert.equal(short.bookable, false);
  assert.match(short.reason, /minimum stay from that date is 4 nights/);
  await q(inDays(5), inDays(7), 4).expect(400, /sleeps up to 3/);
  await q(todayISO(), inDays(2)).expect(400, /earliest check-in is tomorrow/);
});

test('a guest books on the website: the price is ours, not the browser\'s, and the booking reaches Smoobu', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin);
  const agent = await getAgent();
  await loginAs(agent, admin);
  await switchOn(agent, p, { terms: 'Cancellation: full refund up to 14 days before arrival.' }).expect(200);

  const guest = { check_in: inDays(5), check_out: inDays(7), adults: 2, first_name: 'Ana', email: 'ana@example.com', amount: 1 };
  await request(app).post('/book/the-loft/reserve').send(guest).expect(400, /accept the booking terms/);
  assert.match((await request(app).get('/book/the-loft')).text, /full refund up to 14 days/);

  const { body } = await request(app).post('/book/the-loft/reserve').send({ ...guest, agreed: true }).expect(200);
  assert.match(body.checkout_url, /^https:\/\/checkout\.paystack\.test\//);
  const init = paystackCalls.find((c) => c.url.endsWith('/transaction/initialize'));
  assert.equal(init.body.amount, 371000, 'the direct price, whatever the browser sent');
  assert.equal(init.auth, `Bearer ${KEY}`, 'into the property\'s own account');

  const link = (await pool.query(`SELECT source, created_by, expires_at - created_at AS open_for FROM payment_links WHERE token = $1`, [body.token])).rows[0];
  assert.equal(link.source, 'website');
  assert.equal(link.created_by, null);
  assert.equal(link.open_for.hours, 1, 'a website link lasts an hour');

  await request(app).get(`/pay/${body.token}/return`).expect(303);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].price, 3710);
  assert.match(reservations[0].notice, /^Booked on the website\./);

  const { body: list } = await agent.get('/api/payment-links').expect(200);
  assert.equal(list.links[0].source, 'website');
  assert.equal(list.links[0].status, 'booked');
});

test('a booking the rules do not allow is refused before any checkout', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin);
  const agent = await getAgent();
  await loginAs(agent, admin);
  await switchOn(agent, p).expect(200);
  const base = { adults: 2, first_name: 'Ana', email: 'ana@example.com' };
  await request(app).post('/book/the-loft/reserve').send({ ...base, check_in: inDays(19), check_out: inDays(21) }).expect(409, /not available/);
  await request(app).post('/book/the-loft/reserve').send({ ...base, check_in: inDays(40), check_out: inDays(42) }).expect(409, /minimum stay/);
  await request(app).post('/book/the-loft/reserve').send({ ...base, adults: 5, check_in: inDays(5), check_out: inDays(7) }).expect(400);
  await request(app).post('/book/the-loft/reserve').send({ ...base, email: 'nope', check_in: inDays(5), check_out: inDays(7) }).expect(400);
  assert.equal(paystackCalls.filter((c) => c.url.endsWith('/transaction/initialize')).length, 0);
});

test('website settings: admins only, a clean address, one property per address', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin);
  const other = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  const agent = await getAgent();
  await loginAs(agent, admin);

  await switchOn(agent, p, { slug: 'The Loft!' }).expect(400);
  await switchOn(agent, p).expect(200);
  await agent.put(`/api/payment-links/website/${other.id}`).send({ enabled: false, slug: 'the-loft' }).expect(409);
  const { body } = await agent.get('/api/payment-links').expect(200);
  assert.equal(body.website.find((w) => w.property_id === other.id).slug, 'hill-top-lodge', 'suggested from the name');

  const manager = await seedUser({ role: 'property_manager' });
  await pool.query(`INSERT INTO user_properties (user_id, property_id, role) VALUES ($1, $2, 'manager')`, [manager.id, p.id]);
  const m = await getAgent();
  await loginAs(m, manager);
  await m.put(`/api/payment-links/website/${p.id}`).send({ enabled: false, slug: 'the-loft' }).expect(403);
});

test('a test Paystack key keeps a property off the website: its checkout can be passed without paying', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await loft(admin, { connect: false });
  await accounts.connect(p.id, { secretKey: 'sk_test_francesca', accountName: 'Francesca' });
  const agent = await getAgent();
  await loginAs(agent, admin);
  await switchOn(agent, p).expect(409, /live Paystack key/);

  // Switched on while live, then put back on a test key: off the website at once.
  await accounts.connect(p.id, { secretKey: KEY, accountName: 'Francesca' });
  await switchOn(agent, p).expect(200);
  await request(app).get('/book/the-loft').expect(200);
  await accounts.connect(p.id, { secretKey: 'sk_test_francesca', accountName: 'Francesca' });
  await request(app).get('/book/the-loft').expect(404);
  await request(app).post('/book/the-loft/reserve').send({ check_in: inDays(5), check_out: inDays(7), adults: 2, first_name: 'Ana', email: 'ana@example.com' }).expect(404);
  assert.equal(paystackCalls.filter((c) => c.url.endsWith('/transaction/initialize')).length, 0);
});
