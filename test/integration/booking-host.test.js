const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, loginAs } = require('../helpers/seed');

const saved = {};
const ENV = { PUBLIC_BASE_URL: 'https://book.example.test', APP_URL: 'https://app.example.test', WEBSITE_URL: 'https://www.example.test/' };
let app;

test.before(async () => {
  app = await getApp();
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
});
test.beforeEach(async () => { await resetDb(); });
test.after(async () => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await closePool();
});

const onBooking = (method, path) => request(app)[method](path).set('Host', 'book.example.test');

test('the booking address serves the guests\' pages and nothing of the app', async () => {
  // Guest pages reach their own routes (an unknown address says so in its own words).
  await onBooking('get', '/book/no-such-place').expect(404, /cannot be booked here/);
  await onBooking('get', '/pay/no-such-token').expect((res) => assert.notEqual(res.text, 'Not found'));
  await onBooking('post', '/paystack/webhook').send({ event: 'charge.success', data: { reference: 'unknown' } }).expect(200);

  // The app is not there: no sign-in, no API, no dashboard.
  await onBooking('post', '/api/auth/login').send({ email: 'a@b.c', password: 'x' }).expect(404, 'Not found');
  await onBooking('get', '/api/payment-links').expect(404, 'Not found');
  await onBooking('get', '/index.html').expect(404, 'Not found');
  await onBooking('get', '/direct').expect(404, 'Not found');

  // The bare address goes to the website.
  await onBooking('get', '/').expect(302).expect('Location', 'https://www.example.test/');
});

test('the app\'s own address is untouched, and hands out booking-address links', async () => {
  const admin = await seedUser({ role: 'admin' });
  const agent = await getAgent();
  await loginAs(agent, admin);
  const { body } = await agent.get('/api/payment-links').set('Host', 'app.example.test').expect(200);
  assert.equal(body.booking_base_url, 'https://book.example.test');
});

test('with the booking address the same as the app\'s, nothing is kept apart', async () => {
  process.env.PUBLIC_BASE_URL = ENV.APP_URL;
  try {
    await request(app).post('/api/auth/login').set('Host', 'app.example.test').send({ email: 'a@b.c', password: 'x' })
      .expect((res) => assert.notEqual(res.status, 404));
  } finally { process.env.PUBLIC_BASE_URL = ENV.PUBLIC_BASE_URL; }
});
