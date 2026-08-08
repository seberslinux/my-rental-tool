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

test('with nobody reachable it is still recorded, and says why nothing went out', async () => {
  // Not a failure any more: in-app is the baseline channel, so an alert
  // nobody asked to be messaged about has still been delivered.
  await resetDb();
  delete process.env.ADMIN_WHATSAPP;
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({ event: 'job_declined', title: 'Jane declined', propertyId: property.id });
  assert.equal(out.delivery, 'skipped');
  assert.match(out.deliveryError, /turned on/i);

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

test('only people who opted in are recipients', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin', phone: '+27821110000' });
  await pool.query('UPDATE users SET notify_whatsapp = 1 WHERE id = $1', [owner.id]);
  // Has a number, never asked to be messaged.
  const quiet = await seedUser({ role: 'property_manager', phone: '+27821118888' });
  const property = await seedProperty({ owner });

  const numbers = await recipientsFor(property.id);
  assert.ok(numbers.includes('27821110000'));
  assert.ok(!numbers.includes('27821118888'), 'having a number is not consent');
  assert.ok(numbers.includes('27831112222'), 'a configured admin number still counts');
  assert.ok(quiet.id);
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

// --- the choice of channel ----------------------------------------------

test('WhatsApp goes only to people who turned it on', async () => {
  // A channel nobody asked for is the fastest way to have it muted, and
  // then the one message that mattered lands in a thread nobody opens.
  await resetDb();
  delete process.env.ADMIN_WHATSAPP;
  mockWa.reset();

  const optedIn = await seedUser({ role: 'admin', phone: '+27821110000' });
  await pool.query('UPDATE users SET notify_whatsapp = 1 WHERE id = $1', [optedIn.id]);
  const optedOut = await seedUser({ role: 'admin', phone: '+27821119999' });

  const property = await seedProperty({ owner: optedIn });
  await notify({ event: 'job_declined', title: 'Jane declined', propertyId: property.id });

  assert.equal(mockWa.sent.length, 1, 'one recipient, not both');
  assert.equal(mockWa.sent[0].to, '27821110000');
  assert.ok(optedOut.id);
});

test('with nobody opted in it is skipped, not failed', async () => {
  // The feed still has it. Nobody has asked to be messaged as well, which
  // is a choice rather than a fault.
  await resetDb();
  delete process.env.ADMIN_WHATSAPP;
  mockWa.reset();
  const owner = await seedUser({ role: 'admin', phone: '+27821110000' });
  const property = await seedProperty({ owner });

  const out = await notify({ event: 'job_declined', title: 'Jane declined', propertyId: property.id });
  assert.equal(out.delivery, 'skipped');
  assert.match(out.deliveryError, /turned on/i);
  assert.equal(mockWa.sent.length, 0);

  const feed = await recent({});
  assert.equal(feed.length, 1, 'the record does not depend on the channel');
});

// --- whose message is it? ------------------------------------------------

/**
 * The cleaner's own feed, and why it is not just "rows with my id on".
 *
 * cleaner_id says who a row is *about*. Most rows carrying one are
 * written for the owner — "Jane started cleaning Hill Top Lodge" is about
 * Jane and for whoever runs the place. Building her feed on the id alone
 * would hand her the commentary on her own work, including the times
 * somebody was told she had not shown up.
 */

const { recentForCleaner } = require('../../src/services/notify');

test("an owner's event about a cleaner stays out of the cleaner's feed", async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner();

  await notify({
    event: 'cleaning_overdue',
    title: 'Jane has not started Hill Top Lodge',
    propertyId: property.id, cleanerId: cleaner.id,
  });

  const hers = await recentForCleaner(cleaner.id);
  assert.equal(hers.length, 0, 'that row is about her, not for her');

  const theirs = await recent({});
  assert.equal(theirs.length, 1, "and it is still the owner's to see");
});

test("a cleaner's own event reaches her feed and not the owner's", async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234567' });

  await notify({
    event: 'job_assigned',
    title: 'You are cleaning Hill Top Lodge on Friday',
    propertyId: property.id, cleanerId: cleaner.id,
  });

  const hers = await recentForCleaner(cleaner.id);
  assert.equal(hers.length, 1);
  assert.match(hers[0].title, /You are cleaning/);

  const theirs = await recent({});
  assert.equal(theirs.length, 0, "the owner's feed is not the cleaner's inbox");
});

test('one cleaner cannot see another cleaner’s messages', async () => {
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const jane = await seedCleaner({ phone: '+27821111111' });
  const bea = await seedCleaner({ phone: '+27822222222' });

  await notify({
    event: 'job_assigned', title: 'Jane’s job',
    propertyId: property.id, cleanerId: jane.id,
  });

  assert.equal((await recentForCleaner(bea.id)).length, 0);
  assert.equal((await recentForCleaner(jane.id)).length, 1);
});

test("a cleaner's message goes to their own phone, opt-in or not", async () => {
  // The owner's opt-in is somebody choosing whether to hear about their
  // business. This is the only way a cleaner learns they have a shift.
  await resetDb();
  delete process.env.ADMIN_WHATSAPP;
  mockWa.reset();
  const owner = await seedUser({ role: 'admin', phone: '+27829999999' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234567' });

  const out = await notify({
    event: 'job_assigned', title: 'You are cleaning on Friday',
    propertyId: property.id, cleanerId: cleaner.id,
  });

  assert.equal(out.audience, 'cleaner');
  assert.equal(out.delivery, 'sent');
  assert.equal(mockWa.sent.length, 1, 'exactly one recipient — hers');
  assert.equal(mockWa.sent[0].to, '27821234567');
});

test('a routine cleaner event still reaches the phone', async () => {
  // Severity governs the owner's noise, not the cleaner's. They are not
  // sitting in front of this app, so an upcoming shift has to reach them.
  await resetDb();
  mockWa.reset();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234567' });

  const out = await notify({
    event: 'job_upcoming', title: 'Tomorrow: Hill Top Lodge',
    propertyId: property.id, cleanerId: cleaner.id,
  });

  assert.equal(out.severity, 'info');
  assert.equal(out.delivery, 'sent', 'an info event for a cleaner still goes out');
});

test('a cleaner with no usable number is recorded, not lost', async () => {
  await resetDb();
  mockWa.reset();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  // Local format, no country code — cannot be dialled, must not be guessed.
  const cleaner = await seedCleaner({ phone: '082 123 4567' });

  const out = await notify({
    event: 'job_assigned', title: 'You are cleaning on Friday',
    propertyId: property.id, cleanerId: cleaner.id,
  });

  assert.equal(out.delivery, 'skipped');
  assert.match(out.deliveryError, /phone number/i);
  const hers = await recentForCleaner(cleaner.id);
  assert.equal(hers.length, 1, 'the app is the only place she will find this');
});

// --- the channel being off is not the channel being broken --------------

test('with WhatsApp unconfigured, a cleaner message is in-app only, not failed', async () => {
  // Every send would otherwise be three doomed HTTP attempts ending in
  // "Invalid OAuth access token", and the cleaner's app would mark every
  // message they own as undelivered.
  await resetDb();
  mockWa.reset();
  const token = process.env.WHATSAPP_TOKEN;
  const pid = process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;

  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });
  const cleaner = await seedCleaner({ phone: '+27821234567' });

  const out = await notify({
    event: 'job_assigned', title: 'You are cleaning on Friday',
    propertyId: property.id, cleanerId: cleaner.id,
  });

  assert.equal(out.delivery, 'skipped', 'not "failed" — nothing is broken');
  assert.match(out.deliveryError, /off/i);
  assert.equal(mockWa.sent.length, 0, 'no doomed attempt is made at all');

  const hers = await recentForCleaner(cleaner.id);
  assert.equal(hers.length, 1, 'the app is the channel, and it worked');

  if (token) process.env.WHATSAPP_TOKEN = token;
  if (pid) process.env.WHATSAPP_PHONE_NUMBER_ID = pid;
});

test('an owner alert is likewise recorded rather than attempted', async () => {
  await resetDb();
  mockWa.reset();
  const token = process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_TOKEN;
  process.env.ADMIN_WHATSAPP = '+27831112222';

  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner });

  const out = await notify({
    event: 'job_declined', title: 'Jane declined', propertyId: property.id,
  });
  assert.equal(out.delivery, 'skipped');
  assert.equal(mockWa.sent.length, 0);
  assert.equal((await recent({})).length, 1);

  if (token) process.env.WHATSAPP_TOKEN = token;
});
