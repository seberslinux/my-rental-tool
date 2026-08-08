const test = require('node:test');
const assert = require('node:assert/strict');
const { getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedCleaner, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * Cleaner invitations.
 *
 * The owner decides who gets access; the cleaner decides how they get in.
 * Before this, the owner typed a PIN and read it out, which meant the
 * owner held the cleaner's credential — and since PINs are hashed, a
 * forgotten one could only be overwritten, never recovered.
 *
 * The properties that matter are the ones a link can violate: it must
 * work once, expire, admit only its own cleaner, and be issuable only by
 * someone entitled to grant access.
 */

const invite = (agent, id) => agent.post(`/api/cleaners/${id}/invite`);
const tokenOf = (url) => url.split('/invite/')[1];

test.before(async () => { await resetDb(); });
test.after(async () => { await closePool(); });

// --- the path a cleaner actually walks ----------------------------------

test('an invitation lets a cleaner set a PIN and signs them in', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ name: 'Jane', phone: '+27821234567' });

  const admin = await getAgent();
  await loginAs(admin, owner);
  const res = await invite(admin, cleaner.id).expect(201);
  assert.match(res.body.url, /\/invite\/.+/);

  // A fresh agent: the cleaner is on their own phone, not the owner's.
  const phone = await getAgent();
  const token = tokenOf(res.body.url);

  const look = await phone.get(`/api/auth/invite/${token}`).expect(200);
  assert.equal(look.body.name, 'Jane', 'greets them by name');
  assert.equal(look.body.phone, undefined, 'must not leak the number to a forwarded link');

  const redeem = await phone.post(`/api/auth/invite/${token}`).send({ pin: '4821' }).expect(200);
  assert.equal(redeem.body.role, 'cleaner');

  // Signed in already — no second login step.
  const me = await phone.get('/api/cleaner-portal/me').expect(200);
  assert.equal(me.body.id, cleaner.id);
});

test('the PIN they chose works on the normal login afterwards', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });

  const admin = await getAgent();
  await loginAs(admin, owner);
  const { body } = await invite(admin, cleaner.id).expect(201);
  const fresh = await getAgent();
  await fresh.post(`/api/auth/invite/${tokenOf(body.url)}`).send({ pin: '4821' }).expect(200);

  // A different device, the number typed the way a person types it.
  const later = await getAgent();
  const res = await later
    .post('/api/auth/cleaner-login')
    .send({ phone: '082 123 4567', pin: '4821' });
  assert.equal(res.status, 200, res.body?.error);
  assert.equal(res.body.id, cleaner.id);
});

// --- single use, which is the whole point of "one-time" -----------------

test('a link cannot be spent twice', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);
  const { body } = await invite(admin, cleaner.id).expect(201);
  const token = tokenOf(body.url);

  await (await getAgent()).post(`/api/auth/invite/${token}`).send({ pin: '1111' }).expect(200);

  // Someone the link was forwarded to must not be able to change the PIN.
  const second = await (await getAgent())
    .post(`/api/auth/invite/${token}`)
    .send({ pin: '2222' });
  assert.equal(second.status, 404);

  // And the first PIN still stands.
  const login = await (await getAgent())
    .post('/api/auth/cleaner-login')
    .send({ phone: '+27821234567', pin: '1111' });
  assert.equal(login.status, 200);
});

test('two simultaneous redemptions cannot both succeed', async () => {
  // A double tap, or the same link opened on two phones at once. The
  // claim is a conditional UPDATE precisely so one of these loses.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);
  const { body } = await invite(admin, cleaner.id).expect(201);
  const token = tokenOf(body.url);

  const [a, b] = await Promise.all([
    (await getAgent()).post(`/api/auth/invite/${token}`).send({ pin: '1111' }),
    (await getAgent()).post(`/api/auth/invite/${token}`).send({ pin: '2222' }),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 404], 'exactly one wins');
});

test('issuing a new invitation voids the previous unused one', async () => {
  // The reason to re-invite is usually that the first link went astray.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);

  const first = await invite(admin, cleaner.id).expect(201);
  const second = await invite(admin, cleaner.id).expect(201);
  assert.notEqual(tokenOf(first.body.url), tokenOf(second.body.url));

  const old = await (await getAgent())
    .post(`/api/auth/invite/${tokenOf(first.body.url)}`)
    .send({ pin: '1111' });
  assert.equal(old.status, 404, 'the superseded link is dead');

  await (await getAgent())
    .post(`/api/auth/invite/${tokenOf(second.body.url)}`)
    .send({ pin: '2222' })
    .expect(200);
});

// --- expiry --------------------------------------------------------------

test('an expired invitation is refused', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);
  const { body } = await invite(admin, cleaner.id).expect(201);
  const token = tokenOf(body.url);

  await pool.query(
    "UPDATE cleaner_invites SET expires_at = NOW() - INTERVAL '1 day' WHERE token = $1",
    [token]
  );

  await (await getAgent()).get(`/api/auth/invite/${token}`).expect(404);
  const res = await (await getAgent()).post(`/api/auth/invite/${token}`).send({ pin: '1111' });
  assert.equal(res.status, 404);
});

// --- who may grant access ------------------------------------------------

test('a cleaner cannot invite anybody', async () => {
  // requireAuth admits cleaner PIN sessions, so this is guarded by
  // requireRole, which needs a real user. Without it a cleaner could
  // hand out access.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const jane = await seedCleaner({ phone: '+27821234567' });
  const other = await seedCleaner({ phone: '+27829999999' });

  const admin = await getAgent();
  await loginAs(admin, owner);
  const { body } = await invite(admin, jane.id).expect(201);

  const janePhone = await getAgent();
  await janePhone.post(`/api/auth/invite/${tokenOf(body.url)}`).send({ pin: '1111' }).expect(200);

  const res = await janePhone.post(`/api/cleaners/${other.id}/invite`);
  assert.ok(res.status === 401 || res.status === 403, `expected refusal, got ${res.status}`);
});

test('an anonymous request cannot issue an invitation', async () => {
  await resetDb();
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const res = await (await getAgent()).post(`/api/cleaners/${cleaner.id}/invite`);
  assert.equal(res.status, 401);
});

// --- input the endpoint must refuse --------------------------------------

test('the PIN must be four digits', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);
  const { body } = await invite(admin, cleaner.id).expect(201);
  const token = tokenOf(body.url);

  for (const bad of ['123', '12345', 'abcd', '', '12 4', null]) {
    const res = await (await getAgent()).post(`/api/auth/invite/${token}`).send({ pin: bad });
    assert.equal(res.status, 400, `"${bad}" should be refused`);
  }

  // Still redeemable afterwards — a rejected PIN must not burn the link.
  await (await getAgent()).post(`/api/auth/invite/${token}`).send({ pin: '4821' }).expect(200);
});

test('a made-up token is refused', async () => {
  await resetDb();
  await (await getAgent()).get('/api/auth/invite/not-a-real-token').expect(404);
  const res = await (await getAgent())
    .post('/api/auth/invite/not-a-real-token')
    .send({ pin: '1234' });
  assert.equal(res.status, 404);
});

test('inviting a cleaner who does not exist is a 404', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const admin = await getAgent();
  await loginAs(admin, owner);
  const res = await invite(admin, 999999);
  assert.equal(res.status, 404);
});

// --- delivery over WhatsApp ---------------------------------------------

const mockWa = require('../helpers/mock-whatsapp');

test('the invitation is sent as a WhatsApp template, token in the button', async () => {
  await resetDb();
  mockWa.resetTemplates('ok');
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_INVITE_TEMPLATE = 'cleaner_invite';

  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ name: 'Jane', phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);

  const { body } = await invite(admin, cleaner.id).expect(201);
  assert.equal(body.sent, true);

  assert.equal(mockWa.templates.length, 1);
  const msg = mockWa.templates[0];
  assert.equal(msg.to, '27821234567', 'digits, no +');
  assert.equal(msg.name, 'cleaner_invite');

  // The token rides in the URL button so Meta renders a real button
  // rather than a bare link in the body text.
  const button = msg.components.find((c) => c.type === 'button');
  assert.equal(button.sub_type, 'url');
  assert.equal(button.parameters[0].text, tokenOf(body.url));

  const bodyPart = msg.components.find((c) => c.type === 'body');
  assert.equal(bodyPart.parameters[0].text, 'Jane');
});

test('a failed send is reported, and the link still works', async () => {
  // The old assignment code swallowed send failures and carried on as
  // though the cleaner had been told. The owner must be able to see it
  // did not arrive, and still be able to pass the link on by hand.
  await resetDb();
  mockWa.resetTemplates('fail');
  process.env.WHATSAPP_INVITE_TEMPLATE = 'cleaner_invite';

  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);

  const { body } = await invite(admin, cleaner.id).expect(201);
  assert.equal(body.sent, false);
  assert.match(body.reason, /Session has expired/);
  assert.match(body.url, /\/invite\/.+/, 'the link is still returned');

  await (await getAgent())
    .post(`/api/auth/invite/${tokenOf(body.url)}`)
    .send({ pin: '4821' })
    .expect(200);
});

test('with WhatsApp unconfigured, the invitation is still issued', async () => {
  await resetDb();
  mockWa.resetTemplates('ok');
  delete process.env.WHATSAPP_INVITE_TEMPLATE;

  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '+27821234567' });
  const admin = await getAgent();
  await loginAs(admin, owner);

  const { body } = await invite(admin, cleaner.id).expect(201);
  assert.equal(body.sent, false);
  assert.match(body.reason, /not configured/i);
  assert.equal(mockWa.templates.length, 0, 'nothing attempted');
});

test('a number with no country code is refused rather than guessed', async () => {
  // "082…" cannot be addressed on WhatsApp — nothing in it says which
  // country, and guessing is how a German number would acquire a South
  // African prefix.
  await resetDb();
  mockWa.resetTemplates('ok');
  process.env.WHATSAPP_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_INVITE_TEMPLATE = 'cleaner_invite';

  const owner = await seedUser({ role: 'admin' });
  const cleaner = await seedCleaner({ phone: '082 123 4567' });
  const admin = await getAgent();
  await loginAs(admin, owner);

  const { body } = await invite(admin, cleaner.id).expect(201);
  assert.equal(body.sent, false);
  assert.match(body.reason, /country code/i);
  assert.equal(mockWa.templates.length, 0);
});
