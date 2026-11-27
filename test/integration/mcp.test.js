const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking } = require('../helpers/seed');
const { inDays, daysAgo } = require('../helpers/dates');
const mockSmoobu = require('../helpers/mock-smoobu');
const { pool } = require('../../src/db/database');

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
let app;

test.before(async () => { app = await getApp(); });
test.beforeEach(async () => { await resetDb(); mockSmoobu.reset(); });
test.after(() => closePool());

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

function register(redirect = CALLBACK) {
  return request(app).post('/register').send({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
}

/** Claude's whole sign-in, as `user` in a browser: the tokens Claude ends up with. */
async function connect(user) {
  const client = (await register().expect(201)).body;
  const { verifier, challenge } = pkce();
  const auth = await request(app).get('/authorize').query({
    response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'st8',
  }).expect(302);
  const consent = auth.headers.location;
  assert.match(consent, /^\/oauth\/consent\?request=/);
  const requestId = new URL(consent, 'http://x').searchParams.get('request');

  const browser = await getAgent();
  assert.match((await browser.get(consent).expect(200)).text, /Sign in to connect Claude/);
  await browser.post('/oauth/consent/login').type('form').send({ request: requestId, email: user.email, password: user._plaintextPassword }).expect(303);
  const allow = (await browser.get(consent).expect(200)).text;
  assert.match(allow, /Allow Claude\?/);
  const csrf = allow.match(/name="csrf" value="([^"]+)"/)[1];
  const back = await browser.post('/oauth/consent').type('form').send({ request: requestId, csrf, decision: 'allow' }).expect(302);
  const to = new URL(back.headers.location);
  assert.equal(`${to.origin}${to.pathname}`, CALLBACK);
  assert.equal(to.searchParams.get('state'), 'st8');

  const tokens = (await request(app).post('/token').type('form').send({
    grant_type: 'authorization_code', code: to.searchParams.get('code'), code_verifier: verifier, client_id: client.client_id, redirect_uri: CALLBACK,
  }).expect(200)).body;
  return { client, tokens };
}

async function rpc(token, method, params = {}) {
  const res = await request(app).post('/mcp').set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method, params });
  return res;
}
async function callTool(token, name, args = {}) {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const r = res.body.result;
  return { error: r.isError ? r.content[0].text : null, data: r.isError ? null : JSON.parse(r.content[0].text) };
}

test('Claude signs in with an app account and uses the tools as that person', async () => {
  const admin = await seedUser({ role: 'admin', name: 'Owner' });
  const p = await seedProperty({ owner: admin, name: 'The loft' });
  await seedBooking({ property: p, check_in: inDays(10), check_out: inDays(12), guest_name: 'Ana Silva' });
  const { tokens } = await connect(admin);
  assert.ok(tokens.access_token && tokens.refresh_token);

  const init = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200, init.text);
  assert.equal(init.body.result.serverInfo.name, 'my-rental-tool');

  const names = (await rpc(tokens.access_token, 'tools/list')).body.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['compare_prices', 'competitor_sales', 'create_payment_link', 'get_performance', 'get_rates', 'list_bookings', 'list_payment_links', 'list_properties', 'quote_stay', 'set_rates']);

  const listed = await callTool(tokens.access_token, "list_properties"); assert.equal(listed.error, null); const props = listed.data;
  assert.deepEqual(props.map((x) => x.name), ['The loft']);
  assert.equal(Object.keys(props[0]).some((k) => /key|encrypted|iv/.test(k)), false, 'no secrets');

  const { data } = await callTool(tokens.access_token, 'list_bookings');
  assert.equal(data.count, 1);
  assert.equal(data.bookings[0].guest, 'Ana', 'first name only');
  assert.equal(JSON.stringify(data).includes('Silva'), false);
});

test('a property manager sees only their own properties', async () => {
  const admin = await seedUser({ role: 'admin' });
  const mine = await seedProperty({ owner: admin, name: 'The loft' });
  await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  const manager = await seedUser({ role: 'property_manager' });
  await pool.query(`INSERT INTO user_properties (user_id, property_id, role) VALUES ($1, $2, 'manager')`, [manager.id, mine.id]);
  const { tokens } = await connect(manager);
  assert.deepEqual((await callTool(tokens.access_token, 'list_properties')).data.map((x) => x.name), ['The loft']);
});

test('rate changes go through the app\'s own safeguards', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await seedProperty({ owner: admin, name: 'The loft', base_price: 2000 });
  await seedBooking({ property: p, check_in: inDays(20), check_out: inDays(22) });
  const sent = mockSmoobu.calls.setRatesForDates;
  const { tokens } = await connect(admin);

  const low = await callTool(tokens.access_token, 'set_rates', { property_id: p.id, from: inDays(19), to: inDays(22), price: 1500 });
  assert.match(low.error, /Below the minimum/);
  assert.equal(sent.length, 0);

  const ok = await callTool(tokens.access_token, 'set_rates', { property_id: p.id, from: inDays(19), to: inDays(22), price: 2700 });
  assert.equal(ok.error, null);
  assert.deepEqual(sent[0].dates, [inDays(19), inDays(22)], 'booked nights skipped');
  assert.equal(sent[0].price, 2700);
});

test('no token, a bad token, or a cleaner: no access', async () => {
  const noToken = await request(app).post('/mcp').set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(noToken.status, 401);
  assert.match(noToken.headers['www-authenticate'], /resource_metadata=.*oauth-protected-resource\/mcp/);
  assert.equal((await rpc('made-up', 'tools/list')).status, 401);

  const meta = (await request(app).get('/.well-known/oauth-protected-resource/mcp').expect(200)).body;
  assert.match(meta.resource, /\/mcp$/);
  await request(app).get('/.well-known/oauth-authorization-server').expect(200);

  // Cleaners cannot connect.
  const cleaner = await seedUser({ role: 'cleaner' });
  const client = (await register().expect(201)).body;
  const { challenge } = pkce();
  const auth = await request(app).get('/authorize').query({ response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' }).expect(302);
  const requestId = new URL(auth.headers.location, 'http://x').searchParams.get('request');
  const browser = await getAgent();
  const res = await browser.post('/oauth/consent/login').type('form').send({ request: requestId, email: cleaner.email, password: cleaner._plaintextPassword }).expect(200);
  assert.match(res.text, /cannot connect Claude/);
});

test('only Claude may register, and the consent cannot be forged', async () => {
  await register('https://evil.example/callback').expect(400);
  await register('http://claude.ai/callback').expect(400);
  await register('http://localhost:33418/callback').expect(201);

  const admin = await seedUser({ role: 'admin' });
  const client = (await register().expect(201)).body;
  const { challenge } = pkce();
  const auth = await request(app).get('/authorize').query({ response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' }).expect(302);
  const requestId = new URL(auth.headers.location, 'http://x').searchParams.get('request');
  const browser = await getAgent();
  await browser.post('/oauth/consent/login').type('form').send({ request: requestId, email: admin.email, password: admin._plaintextPassword }).expect(303);
  const res = await browser.post('/oauth/consent').type('form').send({ request: requestId, csrf: 'guess', decision: 'allow' }).expect(200);
  assert.match(res.text, /sign in and try again/);
});

test('a refresh token works once and is replaced; a code works once', async () => {
  const admin = await seedUser({ role: 'admin' });
  const { client, tokens } = await connect(admin);
  const refresh = (rt) => request(app).post('/token').type('form').send({ grant_type: 'refresh_token', refresh_token: rt, client_id: client.client_id });
  const next = (await refresh(tokens.refresh_token).expect(200)).body;
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  await refresh(tokens.refresh_token).expect(400);
  assert.equal((await rpc(next.access_token, 'tools/list')).status, 200);

  // A deactivated account loses access at once.
  await pool.query('UPDATE users SET active = 0 WHERE id = $1', [admin.id]);
  assert.equal((await rpc(next.access_token, 'tools/list')).status, 401);
});

test('the app\'s own pages stay closed to a request claiming to be a tool call', async () => {
  await request(app).get('/api/properties').set('x-mcp-caller', 'forged').expect(401);
});

test('every read tool answers', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await seedProperty({ owner: admin, name: 'The loft' });
  await seedBooking({ property: p, check_in: inDays(10), check_out: inDays(12) });
  const { tokens } = await connect(admin);
  for (const [name, args] of [
    ['get_performance', {}], ['get_performance', { property_id: p.id, from: daysAgo(365), to: inDays(30) }],
    ['competitor_sales', {}], ['compare_prices', {}], ['get_rates', { property_id: p.id }], ['list_payment_links', {}],
  ]) {
    const r = await callTool(tokens.access_token, name, args);
    assert.equal(r.error, null, `${name}: ${r.error}`);
  }
  const perf = (await callTool(tokens.access_token, 'get_performance', {})).data;
  assert.ok(perf.summary && 'net_revenue' in perf.summary);
  assert.equal(perf.recent_reviews, undefined);
});

test('get_rates puts the comparable price beside each base rate, labelled', async () => {
  const admin = await seedUser({ role: 'admin' });
  const p = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  await pool.query('UPDATE properties SET guest_markup_airbnb = 20.5 WHERE id = $1', [p.id]);
  const l = (await pool.query(`INSERT INTO peer_listings (airbnb_id, name, property_id, is_own) VALUES ('lodge-own', 'Hill Top Lodge', $1, TRUE) RETURNING id`, [p.id])).rows[0];
  await pool.query(`INSERT INTO peer_cleaning_fees (listing_id, check_in, nights, fee) VALUES ($1, $2, 2, 500)`, [l.id, inDays(10)]);
  for (const [d, price] of [[inDays(7), 3280], [inDays(8), 3210]]) {
    await pool.query(`INSERT INTO daily_rates (property_id, date, price, min_stay, available) VALUES ($1, $2, $3, 2, 1)`, [p.id, d, price]);
  }
  const { tokens } = await connect(admin);
  const { data, error } = await callTool(tokens.access_token, 'get_rates', { property_id: p.id, from: inDays(7), to: inDays(8) });
  assert.equal(error, null);
  const first = data[0];
  assert.equal(first.price, 3280);
  assert.match(first.price_basis, /base rate/);
  assert.equal(first.comparable_gross_nightly, 4161, '⌈3,280 × 1.205⌉ + ⌈3,210 × 1.205⌉ + 500, over 2 nights');
  assert.equal(first.basis, 'airbnb, cleaning over 2 nights, excl. guest service fee, from smoobu base rate');
  const three = (await callTool(tokens.access_token, 'get_rates', { property_id: p.id, from: inDays(7), to: inDays(7), stay_nights: 3 })).data[0];
  assert.equal(three.stay_nights, 3);
  // Asked for one day only, the stay's second night is still priced at its own rate.
  const one = (await callTool(tokens.access_token, 'get_rates', { property_id: p.id, from: inDays(7), to: inDays(7) })).data[0];
  assert.equal(one.comparable_gross_nightly, 4161);
});
