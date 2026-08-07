const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking } = require('../helpers/seed');
const mockSmoobu = require('../helpers/mock-smoobu');
const {
  sendCheckinMessages,
  sendCheckoutMessages,
} = require('../../src/services/messaging');

/**
 * Guest messaging cron correctness.
 *
 * sendCheckinMessages runs each morning and DMs guests arriving tomorrow.
 * sendCheckoutMessages runs each morning and DMs guests leaving today.
 * Bugs here silently spam or silently drop guest communications.
 */

test.before(() => getApp());
test.beforeEach(async () => {
  await resetDb();
  mockSmoobu.reset();
  // Reset templates each test so an earlier test's env override doesn't
  // leak.
  delete process.env.CHECKIN_MESSAGE_TEMPLATE;
  delete process.env.CHECKOUT_MESSAGE_TEMPLATE;
});
test.after(() => closePool());

function todayPlus(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// --- sendCheckinMessages -------------------------------------------------

test('sendCheckinMessages: only targets bookings checking in tomorrow', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, name: 'Sea Villa' });

  // Tomorrow — included.
  await seedBooking({
    property, smoobu_id: 100, guest_name: 'Alice',
    check_in: todayPlus(1), check_out: todayPlus(4),
  });
  // Today (already arrived) — excluded.
  await seedBooking({
    property, smoobu_id: 101, guest_name: 'BobToday',
    check_in: todayPlus(0), check_out: todayPlus(3),
  });
  // Day after tomorrow — excluded.
  await seedBooking({
    property, smoobu_id: 102, guest_name: 'CharlieDay2',
    check_in: todayPlus(2), check_out: todayPlus(5),
  });

  await sendCheckinMessages();

  assert.equal(mockSmoobu.calls.sendGuestMessage.length, 1);
  assert.equal(mockSmoobu.calls.sendGuestMessage[0].reservationId, 100);
});

test('sendCheckinMessages: skips cancelled bookings', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({
    property, smoobu_id: 200, check_in: todayPlus(1), check_out: todayPlus(4),
    status: 'cancelled',
  });

  await sendCheckinMessages();
  assert.equal(mockSmoobu.calls.sendGuestMessage.length, 0);
});

test('sendCheckinMessages: substitutes {guest_name} and {property_name} and {check_in}', async () => {
  process.env.CHECKIN_MESSAGE_TEMPLATE =
    'Hi {guest_name}, welcome to {property_name} on {check_in}!';

  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, name: 'Ocean House' });
  const arrival = todayPlus(1);
  await seedBooking({
    property, smoobu_id: 300, guest_name: 'Dan',
    check_in: arrival, check_out: todayPlus(4),
  });

  await sendCheckinMessages();

  const call = mockSmoobu.calls.sendGuestMessage[0];
  assert.equal(call.subject, 'Check-in Instructions');
  assert.equal(call.messageBody, `Hi Dan, welcome to Ocean House on ${arrival}!`);
});

test('sendCheckinMessages: missing guest_name → "Guest" fallback', async () => {
  process.env.CHECKIN_MESSAGE_TEMPLATE = 'Hi {guest_name}!';

  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({
    property, smoobu_id: 400, guest_name: '',
    check_in: todayPlus(1), check_out: todayPlus(4),
  });

  await sendCheckinMessages();
  assert.equal(mockSmoobu.calls.sendGuestMessage[0].messageBody, 'Hi Guest!');
});

test('sendCheckinMessages: a per-booking Smoobu failure does not stop the loop', async () => {
  // Regression guard: if the loop bailed on first error, only the earlier
  // guests would receive their check-in instructions.
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({ property, smoobu_id: 501, guest_name: 'A', check_in: todayPlus(1), check_out: todayPlus(4) });
  await seedBooking({ property, smoobu_id: 502, guest_name: 'B', check_in: todayPlus(1), check_out: todayPlus(4) });
  await seedBooking({ property, smoobu_id: 503, guest_name: 'C', check_in: todayPlus(1), check_out: todayPlus(4) });

  // Make the second call throw.
  const original = mockSmoobu.calls.sendGuestMessage;
  const smoobu = require('../../src/services/smoobu');
  const origFn = smoobu.sendGuestMessage;
  let n = 0;
  smoobu.sendGuestMessage = async (...args) => {
    n++;
    if (n === 2) throw new Error('Smoobu 502 upstream');
    return origFn(...args);
  };

  try {
    await sendCheckinMessages();
    assert.equal(n, 3, 'the loop must attempt all three sends, not stop at the first failure');
  } finally {
    smoobu.sendGuestMessage = origFn;
  }
});

// --- sendCheckoutMessages -----------------------------------------------

test('sendCheckoutMessages: only targets bookings checking out today', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });

  await seedBooking({
    property, smoobu_id: 600, guest_name: 'LeavingToday',
    check_in: todayPlus(-3), check_out: todayPlus(0),
  });
  await seedBooking({
    property, smoobu_id: 601, guest_name: 'LeavingTomorrow',
    check_in: todayPlus(-2), check_out: todayPlus(1),
  });
  await seedBooking({
    property, smoobu_id: 602, guest_name: 'LeftYesterday',
    check_in: todayPlus(-5), check_out: todayPlus(-1),
  });

  await sendCheckoutMessages();
  assert.equal(mockSmoobu.calls.sendGuestMessage.length, 1);
  assert.equal(mockSmoobu.calls.sendGuestMessage[0].reservationId, 600);
});

test('sendCheckoutMessages: substitutes template placeholders + uses subject', async () => {
  process.env.CHECKOUT_MESSAGE_TEMPLATE = 'Bye {guest_name}, hope you enjoyed {property_name} until {check_out}.';

  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin, name: 'Cliff House' });
  const checkOut = todayPlus(0);
  await seedBooking({
    property, smoobu_id: 700, guest_name: 'Elena',
    check_in: todayPlus(-3), check_out: checkOut,
  });

  await sendCheckoutMessages();
  const call = mockSmoobu.calls.sendGuestMessage[0];
  assert.equal(call.subject, 'Checkout Reminder');
  assert.equal(call.messageBody, `Bye Elena, hope you enjoyed Cliff House until ${checkOut}.`);
});

test('sendCheckoutMessages: skips cancelled bookings', async () => {
  const admin = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner: admin });
  await seedBooking({
    property, smoobu_id: 800,
    check_in: todayPlus(-3), check_out: todayPlus(0),
    status: 'cancelled',
  });

  await sendCheckoutMessages();
  assert.equal(mockSmoobu.calls.sendGuestMessage.length, 0);
});
