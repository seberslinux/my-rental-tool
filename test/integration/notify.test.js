const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedCleaner } = require('../helpers/seed');
const { pool } = require('../../src/db/database');
const mockWa = require('../helpers/mock-whatsapp');
const { notify, recent, recipientsFor } = require('../../src/services/notify');

/**
 * Who gets told what.
 *
 * Four call sites used to reach for whatsapp.sendMessage directly, each
 * with its own message, its own recipients, and a catch that logged and
 * carried on. That is why every cleaning job in production read
 * notified = 0 while the app reported it assigned — the sends had been
 * failing since the token expired in March and nothing said so.
 *
 * The properties worth pinning are: everything is recorded whatever
 * happens to delivery, only the events worth interrupting for go out,
 * and a failure is visible rather than swallowed.
 */

// getApp() is what runs the migrations — without it the notifications
// table does not exist yet.
test.before(async () => { await getApp(); await resetDb(); });
test.after(async () => { await closePool(); });

test.beforeEach(() => {
  mockWa.reset();
  process.env.ADMIN_WHATSAPP = '+27831112222';
});

// --- recording ----------------------------------------------------------

test('a routine event is recorded and not sent', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({
    event: 'cleaning_started',
    title: 'Jane started cleaning Hill Top Lodge',
    propertyId: property.id,
  });

  assert.equal(out.delivery, 'skipped', 'routine events do not interrupt anybody');
  assert.equal(mockWa.sent.length, 0);

  const feed = await recent({});
  assert.equal(feed.length, 1);
  assert.equal(feed[0].event, 'cleaning_started');
  assert.equal(feed[0].channel, 'in_app');
});

test('an exception is sent and recorded as sent', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({
    event: 'job_declined',
    title: 'Jane cannot clean Hill Top Lodge on Friday',
    propertyId: property.id,
    link: '/cleaners',
  });

  assert.equal(out.delivery, 'sent');
  assert.equal(mockWa.sent.length, 1);
  assert.equal(mockWa.sent[0].to, '27831112222', 'digits, no plus');

  const feed = await recent({});
  assert.equal(feed[0].delivery, 'sent');
  assert.equal(feed[0].channel, 'whatsapp');
});

test('the message carries a link into the app', async () => {
  await resetDb();
  process.env.APP_URL = 'https://rental.example';
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  await notify({
    event: 'issue_reported',
    title: 'Jane reported: shower head dripping',
    propertyId: property.id,
    link: '/more',
  });

  assert.match(mockWa.sent[0].message, /https:\/\/rental\.example\/more/,
    'a notification you can act on beats one you have to go and find');
  delete process.env.APP_URL;
});

// --- failures are visible, which is the whole point ----------------------

test('a failed send is recorded with the provider\'s own reason', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const err = new Error('send failed');
  err.response = { data: { error: { message: 'Session has expired' } } };
  mockWa.reset();
  require('../../src/services/whatsapp').sendMessage = async () => { throw err; };

  const out = await notify({
    event: 'job_declined', title: 'Jane declined', propertyId: property.id,
  });

  assert.equal(out.delivery, 'failed');
  assert.match(out.deliveryError, /Session has expired/);

  const feed = await recent({});
  assert.equal(feed[0].delivery, 'failed');
  assert.match(feed[0].delivery_error, /Session has expired/);
});

test('with nobody reachable it is recorded as failed, not quietly dropped', async () => {
  await resetDb();
  delete process.env.ADMIN_WHATSAPP;
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({ event: 'job_declined', title: 'Jane declined', propertyId: property.id });
  assert.equal(out.delivery, 'failed');
  assert.match(out.deliveryError, /phone number/i);

  const feed = await recent({});
  assert.equal(feed.length, 1, 'still recorded — the event happened');
});

test('notify never throws, whatever the channel does', async () => {
  // The event it describes has already happened. A cleaner who finished
  // has finished whether or not anyone could be told.
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  require('../../src/services/whatsapp').sendMessage = async () => { throw new Error('network down'); };

  await notify({ event: 'job_declined', title: 'x', propertyId: property.id });
  assert.ok(true, 'did not throw');
});

// --- who is reachable ----------------------------------------------------

test('managers with a phone number are included, those without are not', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin', phone: '+27821110000' });
  const silent = await seedUser({ role: 'property_manager' }); // no phone
  const property = await seedProperty({ owner });

  const numbers = await recipientsFor(property.id);
  assert.ok(numbers.includes('27821110000'));
  assert.ok(numbers.includes('27831112222'), 'the admin fallback is still there');
  assert.equal(numbers.length, 2, `unexpected recipients: ${numbers.join(', ')}`);
  assert.ok(silent.id);
});

test('a number with no country code is dropped rather than guessed at', async () => {
  await resetDb();
  await seedUser({ role: 'admin', phone: '082 111 0000' });
  const numbers = await recipientsFor(null);
  assert.ok(!numbers.some((n) => n.startsWith('0')));
});

// --- the setting that decides what goes out -----------------------------

test('the sendable set can be widened without a deploy', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('notify_whatsapp_events', 'all') ON CONFLICT (key) DO UPDATE SET value = 'all'"
  );
  mockWa.reset();

  await notify({ event: 'cleaning_started', title: 'Jane started', propertyId: property.id });
  assert.equal(mockWa.sent.length, 1, 'routine events go out once configured to');

  await pool.query("DELETE FROM app_settings WHERE key = 'notify_whatsapp_events'");
});

test('an unknown event is still recorded rather than lost', async () => {
  await resetDb();
  await notify({ event: 'something_new', title: 'Unhandled' });
  const feed = await recent({});
  assert.equal(feed.length, 1);
  assert.equal(feed[0].severity, 'info');
});

// --- template delivery ---------------------------------------------------

test('an alert goes out as a template when one is configured', async () => {
  // Free-form text is accepted by Meta and silently dropped outside a
  // 24-hour window — a message id comes back and nothing arrives. A
  // template is the only shape that lands whatever the window is doing.
  await resetDb();
  process.env.WHATSAPP_ALERT_TEMPLATE = 'rental_alert';
  mockWa.resetTemplates('ok');
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({
    event: 'job_declined',
    title: 'Jane cannot clean Hill Top Lodge on Friday',
    body: 'Somebody else will need to cover it.',
    propertyId: property.id,
    link: '/cleaners',
  });

  assert.equal(out.delivery, 'sent');
  assert.equal(out.deliveryError, null, 'no caveat when a template was used');
  assert.equal(mockWa.templates.length, 1);
  assert.equal(mockWa.templates[0].name, 'rental_alert');

  // Everything in one variable, joined — template parameters cannot
  // contain newlines.
  const param = mockWa.templates[0].components[0].parameters[0].text;
  assert.match(param, /Jane cannot clean/);
  assert.ok(!param.includes('\n'), 'no newlines in a template variable');

  delete process.env.WHATSAPP_ALERT_TEMPLATE;
});

test('without a template it still sends, and says the message may not land', async () => {
  await resetDb();
  delete process.env.WHATSAPP_ALERT_TEMPLATE;
  mockWa.reset();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({ event: 'job_declined', title: 'Jane declined', propertyId: property.id });

  assert.equal(out.delivery, 'sent');
  assert.match(out.deliveryError, /24h window/,
    'recording a clean success here would repeat the blindness this module exists to end');

  const feed = await recent({});
  assert.match(feed[0].delivery_error, /WHATSAPP_ALERT_TEMPLATE/);
});
