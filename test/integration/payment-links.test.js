const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const { inDays } = require('../helpers/dates');
const mock = require('../helpers/mock-smoobu');
const smoobu = require('../../src/services/smoobu');
const paystack = require('../../src/services/paystack');
const notifyModule = require('../../src/services/notify');
const { pool } = require('../../src/db/database');

const SECRET = 'sk_test_payment_links';
let app;
let paystackCalls;
let paystackState;
let reservations;
let notes;
const originalNotify = notifyModule.notify;

/** A Paystack that answers initialize and verify from `paystackState`. */
function fakePaystack(url, opts) {
  const body = opts.body ? JSON.parse(opts.body) : null;
  paystackCalls.push({ url, method: opts.method, body, auth: opts.headers.Authorization });
  let data;
  if (url.endsWith('/transaction/initialize')) {
    data = { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference };
    paystackState.amount = paystackState.amount ?? body.amount;
  } else if (url.includes('/transaction/verify/')) {
    data = { status: paystackState.status, amount: paystackState.amount, currency: 'ZAR', paid_at: new Date().toISOString() };
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: true, data }) });
}

test.before(async () => { app = await getApp(); });
test.beforeEach(async () => {
  await resetDb();
  mock.reset();
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  process.env.SMOOBU_DIRECT_CHANNEL_ID = '3697409';
  paystackCalls = [];
  paystackState = { status: 'success', amount: null };
  paystack.setFetch(fakePaystack);
  reservations = [];
  smoobu.createReservation = async (fields) => { reservations.push(fields); return { id: 900000 + reservations.length }; };
  notes = [];
  notifyModule.notify = async (n) => { notes.push(n); };
});
test.after(async () => {
  paystack.setFetch(null);
  notifyModule.notify = originalNotify;
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.SMOOBU_DIRECT_CHANNEL_ID;
  await closePool();
});

async function lodgeWithRates(owner, prices) {
  const lodge = await seedProperty({ owner, name: 'Hill Top Lodge' });
  await pool.query('UPDATE properties SET guest_markup_airbnb = 20.5 WHERE id = $1', [lodge.id]);
  const listing = (await pool.query(
    `INSERT INTO peer_listings (airbnb_id, name, property_id, is_own) VALUES ($1, 'The Hill Top Lodge', $2, TRUE) RETURNING id`,
    [String(lodge.id * 1000 + 7), lodge.id]
  )).rows[0];
  await pool.query(`INSERT INTO peer_cleaning_fees (listing_id, check_in, nights, fee) VALUES ($1, $2, 2, 500)`, [listing.id, inDays(10)]);
  const rates = {};
  prices.forEach((price, i) => { rates[inDays(30 + i)] = { price, available: price ? 1 : 0, min_length_of_stay: 2 }; });
  mock.setDailyRates({ [lodge.smoobu_id]: rates });
  return lodge;
}

const linkBody = (lodge, overrides = {}) => ({
  property_id: lodge.id, check_in: inDays(30), check_out: inDays(32), adults: 2,
  first_name: 'Anna', last_name: 'Guest', email: 'anna@example.com', phone: '082 000 0000', amount: 5880, ...overrides,
});
const sign = (body) => crypto.createHmac('sha512', SECRET).update(body).digest('hex');

test('a quote is the Airbnb price — Smoobu rates with the markup, plus cleaning — and 10% below it', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);

  const { body } = await agent.post('/api/payment-links/quote')
    .send({ property_id: lodge.id, check_in: inDays(30), check_out: inDays(32) }).expect(200);
  assert.equal(body.nights, 2);
  assert.equal(body.rates, 5000);
  assert.equal(body.cleaning, 500);
  assert.equal(body.airbnb_total, 6530, '5,000 × 1.205 + 500, to the R10');
  assert.equal(body.direct_total, 5880, '10% below');
  assert.equal(body.available, true);
  assert.equal(body.below_min_stay, false);

  const own = await agent.post('/api/payment-links/quote')
    .send({ property_id: lodge.id, check_in: inDays(30), check_out: inDays(32), discount_percent: 0 }).expect(200);
  assert.equal(own.body.direct_total, 6530);
});

test('a night already taken stops the quote and the link', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 0]);
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.post('/api/payment-links/quote')
    .send({ property_id: lodge.id, check_in: inDays(30), check_out: inDays(32) }).expect(200);
  assert.equal(body.available, false);
  assert.deepEqual(body.taken, [inDays(31)]);
  await agent.post('/api/payment-links').send(linkBody(lodge)).expect(409);
});

test('the guest pays the link in full and the booking is created in Smoobu, once', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);

  const { body: link } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  assert.equal(link.status, 'open');
  assert.equal(link.amount, 5880);
  assert.equal(link.airbnb, 6530);
  assert.ok(link.token.length >= 24, 'an unguessable token');

  const pageRes = await request(app).get(`/pay/${link.token}`).expect(200);
  assert.match(pageRes.text, /Hill Top Lodge/);
  assert.match(pageRes.text, /R5[\s,]?880/);
  assert.match(pageRes.text, /Anna/);
  assert.doesNotMatch(pageRes.text, /anna@example\.com/, 'the page shows no email');

  const start = await request(app).post(`/pay/${link.token}/start`).expect(303);
  assert.match(start.headers.location, /^https:\/\/checkout\.paystack\.test\//);
  const init = paystackCalls.find((c) => c.url.endsWith('/transaction/initialize'));
  assert.equal(init.body.amount, 588000, 'in cents');
  assert.equal(init.body.currency, 'ZAR');
  assert.equal(init.body.email, 'anna@example.com');
  assert.equal(init.auth, `Bearer ${SECRET}`);
  assert.match(init.body.callback_url, new RegExp(`/pay/${link.token}/return$`));

  // Coming back to the page before paying goes to the same checkout.
  const again = await request(app).post(`/pay/${link.token}/start`).expect(303);
  assert.equal(again.headers.location, start.headers.location);
  assert.equal(paystackCalls.filter((c) => c.url.endsWith('/transaction/initialize')).length, 1);

  await request(app).get(`/pay/${link.token}/return?reference=${init.body.reference}`).expect(303);
  assert.equal(reservations.length, 1);
  const r = reservations[0];
  assert.equal(r.apartmentId, lodge.smoobu_id);
  assert.equal(r.channelId, 3697409);
  assert.equal(r.arrivalDate, inDays(30));
  assert.equal(r.departureDate, inDays(32));
  assert.equal(r.price, 5880);
  assert.equal(r.adults, 2);
  assert.equal(r.email, 'anna@example.com');
  assert.match(r.notice, new RegExp(init.body.reference));

  const done = await request(app).get(`/pay/${link.token}`).expect(200);
  assert.match(done.text, /booking is confirmed/);

  // Paystack's webhook for the same payment books nothing more.
  const event = JSON.stringify({ event: 'charge.success', data: { reference: init.body.reference } });
  await request(app).post('/paystack/webhook').set('Content-Type', 'application/json')
    .set('x-paystack-signature', sign(event)).send(event).expect(200);
  assert.equal(reservations.length, 1);

  const { body: list } = await agent.get('/api/payment-links').expect(200);
  assert.equal(list.links[0].status, 'booked');
  assert.equal(Number(list.links[0].smoobu_reservation_id), 900001);
  assert.ok(notes.some((n) => n.event === 'direct_booking_paid'));
});

test('the webhook alone books a payment, and an unsigned webhook is refused', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body: link } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  await request(app).post(`/pay/${link.token}/start`).expect(303);
  const reference = paystackCalls[0].body.reference;

  const event = JSON.stringify({ event: 'charge.success', data: { reference } });
  await request(app).post('/paystack/webhook').set('Content-Type', 'application/json')
    .set('x-paystack-signature', 'not-the-signature').send(event).expect(401);
  assert.equal(reservations.length, 0);

  await request(app).post('/paystack/webhook').set('Content-Type', 'application/json')
    .set('x-paystack-signature', sign(event)).send(event).expect(200);
  assert.equal(reservations.length, 1);
});

test('a payment not completed books nothing; a payment of the wrong amount is held for the owner', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body: link } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  await request(app).post(`/pay/${link.token}/start`).expect(303);

  paystackState.status = 'abandoned';
  await request(app).get(`/pay/${link.token}/return`).expect(303);
  assert.equal(reservations.length, 0);
  assert.equal((await agent.get('/api/payment-links')).body.links[0].status, 'pending');

  paystackState.status = 'success';
  paystackState.amount = 100000;
  await request(app).get(`/pay/${link.token}/return`).expect(303);
  assert.equal(reservations.length, 0);
  const held = (await agent.get('/api/payment-links')).body.links[0];
  assert.equal(held.status, 'paid_unbooked');
  assert.match(held.error, /expected 5880/);
  assert.ok(notes.some((n) => n.event === 'direct_booking_failed'));
});

test('dates taken while the guest paid: kept as paid, not booked, and booked on retry once free', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body: link } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  await request(app).post(`/pay/${link.token}/start`).expect(303);

  mock.setDailyRates({ [lodge.smoobu_id]: { [inDays(30)]: { price: 2000, available: 0 }, [inDays(31)]: { price: 3000, available: 1 } } });
  await request(app).get(`/pay/${link.token}/return`).expect(303);
  assert.equal(reservations.length, 0);
  const held = (await agent.get('/api/payment-links')).body.links[0];
  assert.equal(held.status, 'paid_unbooked');
  assert.match(held.error, new RegExp(inDays(30)));
  const guest = await request(app).get(`/pay/${link.token}`).expect(200);
  assert.match(guest.text, /Payment received/);

  mock.setDailyRates({ [lodge.smoobu_id]: { [inDays(30)]: { price: 2000, available: 1 }, [inDays(31)]: { price: 3000, available: 1 } } });
  const { body: retried } = await agent.post(`/api/payment-links/${held.id}/retry`).expect(200);
  assert.equal(retried.status, 'booked');
  assert.equal(reservations.length, 1);
  await agent.post(`/api/payment-links/${held.id}/retry`).expect(409);
});

test('a cancelled or expired link cannot be paid', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);

  const { body: a } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  await agent.post(`/api/payment-links/${a.id}/cancel`).expect(200);
  const res = await request(app).post(`/pay/${a.token}/start`).expect(303);
  assert.match(res.headers.location, new RegExp(`^/pay/${a.token}\\?e=`));
  assert.match((await request(app).get(`/pay/${a.token}`)).text, /no longer valid/);

  const { body: b } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  await pool.query(`UPDATE payment_links SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [b.id]);
  await request(app).post(`/pay/${b.token}/start`).expect(303);
  assert.equal(paystackCalls.length, 0, 'no checkout for either');
  assert.equal((await agent.get('/api/payment-links')).body.links.find((l) => l.id === b.id).status, 'expired');

  await request(app).get('/pay/no-such-token').expect(404);
});

test('only managers of the property can quote or make links', async () => {
  const owner = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(owner, [2000, 3000]);
  const other = await seedUser({ role: 'property_manager' });
  const agent = await getAgent();
  await loginAs(agent, other);
  await agent.post('/api/payment-links/quote').send({ property_id: lodge.id, check_in: inDays(30), check_out: inDays(32) }).expect(403);
  await agent.post('/api/payment-links').send(linkBody(lodge)).expect(403);
  await request(app).get('/api/payment-links').expect(401);
});

test('without a Paystack key the guest is told payments are not set up', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await lodgeWithRates(admin, [2000, 3000]);
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body: link } = await agent.post('/api/payment-links').send(linkBody(lodge)).expect(201);
  delete process.env.PAYSTACK_SECRET_KEY;
  assert.equal((await agent.get('/api/payment-links')).body.payments_ready, false);
  const res = await request(app).post(`/pay/${link.token}/start`).expect(303);
  assert.match(decodeURIComponent(res.headers.location), /could not be started/);
});
