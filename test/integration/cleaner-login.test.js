const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedCleaner } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

/**
 * Cleaner login, through the endpoint.
 *
 * The unit tests in test/phone.test.js pin the normalisation itself.
 * These prove the thing that actually mattered: a cleaner typing their
 * own number the way the login field's placeholder shows it — with
 * spaces — gets in.
 *
 * Before this, the lookup was `WHERE phone = $1`. Typing the placeholder
 * form against a number stored without spaces returned "Invalid phone or
 * PIN", so the cleaner retyped the PIN, which had never been wrong.
 */

async function cleanerWithPin(phone, pin = '1234') {
  const c = await seedCleaner({ phone });
  await pool.query('UPDATE cleaners SET pin = $1 WHERE id = $2', [
    bcrypt.hashSync(pin, 10),
    c.id,
  ]);
  return c;
}

const login = (agent, phone, pin) =>
  agent.post('/api/auth/cleaner-login').send({ phone, pin });

test.before(async () => { await resetDb(); });
test.after(async () => { await closePool(); });

test('the number typed as the placeholder shows it — with spaces — logs in', async () => {
  await resetDb();
  const c = await cleanerWithPin('+27821234567');
  const agent = await getAgent();

  const res = await login(agent, '+27 82 123 4567', '1234');
  assert.equal(res.status, 200, res.body?.error);
  assert.equal(res.body.id, c.id);
  assert.equal(res.body.role, 'cleaner');
});

test('national form with the trunk zero logs in', async () => {
  await resetDb();
  await cleanerWithPin('+27821234567');
  const agent = await getAgent();
  assert.equal((await login(agent, '082 123 4567', '1234')).status, 200);
});

test('the stored format is irrelevant — spaces in the database work too', async () => {
  await resetDb();
  await cleanerWithPin('082 123 4567');
  const agent = await getAgent();
  assert.equal((await login(agent, '+27821234567', '1234')).status, 200);
});

test('the session it opens actually reaches the cleaner portal', async () => {
  // A 200 from the login route proves little on its own; the session has
  // to satisfy requireCleaner on a subsequent request.
  await resetDb();
  const c = await cleanerWithPin('+27821234567');
  const agent = await getAgent();
  await login(agent, '+27 82 123 4567', '1234').expect(200);

  const me = await agent.get('/api/cleaner-portal/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.id, c.id);
});

// --- what must still be refused -----------------------------------------

test('a wrong PIN is still refused', async () => {
  await resetDb();
  await cleanerWithPin('+27821234567', '1234');
  const agent = await getAgent();
  const res = await login(agent, '+27 82 123 4567', '9999');
  assert.equal(res.status, 401);
});

test('a different number is still refused', async () => {
  await resetDb();
  await cleanerWithPin('+27821234567');
  const agent = await getAgent();
  assert.equal((await login(agent, '082 123 4568', '1234')).status, 401);
});

test('a cleaner with no PIN cannot log in', async () => {
  await resetDb();
  await seedCleaner({ phone: '+27821234567' }); // no PIN set
  const agent = await getAgent();
  const res = await login(agent, '+27 82 123 4567', '1234');
  assert.equal(res.status, 401);
  assert.match(res.body.error, /PIN not set/);
});

test('an empty phone does not match a cleaner stored without one', async () => {
  // Normalisation must not turn "no number" into a wildcard.
  await resetDb();
  await cleanerWithPin('');
  const agent = await getAgent();
  const res = await login(agent, '', '1234');
  assert.equal(res.status, 400); // missing field, never a match
});

test('two cleaners sharing a number are refused rather than guessed', async () => {
  // Signing the second one in as the first would show them another
  // person's jobs, so this is a 409 and not a login.
  await resetDb();
  await cleanerWithPin('+27821234567');
  await cleanerWithPin('082 123 4567');
  const agent = await getAgent();
  const res = await login(agent, '+27 82 123 4567', '1234');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /more than one/i);
});
