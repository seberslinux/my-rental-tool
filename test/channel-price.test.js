const test = require('node:test');
const assert = require('node:assert/strict');
const { guestPrice, netForChannel, viewsFor, channelList } = require('../src/services/channel-price');

/**
 * One rate, three numbers.
 *
 * What you set, what the guest is charged, what reaches you. The two
 * percentages point in opposite directions and the temptation is to
 * treat them as one number — these pin that they are not.
 */

/** A property on Airbnb's split fee: little off the host, a lot on the guest. */
const splitFee = {
  commission_airbnb: 3, guest_markup_airbnb: 14,
  bank_charge_airbnb: 0, vat_airbnb: 0,
};

/** And one on the more common host-only fee: taken out, nothing added. */
const hostOnly = {
  commission_airbnb: 15, guest_markup_airbnb: 0,
  bank_charge_airbnb: 0, vat_airbnb: 0,
};

// --- what the guest is charged -------------------------------------------

test('the markup goes on top of the rate', () => {
  assert.equal(guestPrice(2000, 14), 2280);
});

test('no markup means the guest sees exactly what you set', () => {
  assert.equal(guestPrice(2000, 0), 2000);
  assert.equal(guestPrice(2000, null), 2000);
  assert.equal(guestPrice(2000, undefined), 2000);
});

test('a nonsense markup is treated as none rather than as a discount', () => {
  // A negative here would quietly undercut every listing.
  assert.equal(guestPrice(2000, -30), 2000);
  assert.equal(guestPrice(2000, 'abc'), 2000);
});

test('the guest sees whole rand', () => {
  assert.equal(guestPrice(1999, 14), 2279);
});

// --- what reaches you ----------------------------------------------------

test('commission comes out of the rate, not out of the guest price', () => {
  // The distinction that matters: on the split fee you keep 97% of your
  // own rate, and the 14% the guest paid on top was never yours.
  assert.equal(netForChannel(2000, splitFee, 'airbnb'), 1940);
});

test('a host-only fee takes far more of the same rate', () => {
  assert.equal(netForChannel(2000, hostOnly, 'airbnb'), 1700);
});

test('VAT falls on the fees, not on the rate', () => {
  // 2000 at 15% commission is 300; 2.1% bank charge is 42; VAT at 15%
  // applies to those two and not to the 2000 itself.
  const p = {
    commission_booking: 15, bank_charge_booking: 2.1, vat_booking: 15,
    guest_markup_booking: 0,
  };
  const fees = 300 + 42 + (300 + 42) * 0.15;
  assert.equal(netForChannel(2000, p, 'booking'), Math.round(2000 - fees));
});

test('a channel with nothing configured returns the rate untouched', () => {
  assert.equal(netForChannel(2000, {}, 'vrbo'), 2000);
});

// --- all three together --------------------------------------------------

test('the same rate reads three different ways', () => {
  const v = viewsFor(2000, splitFee);
  assert.equal(v.base, 2000, 'what you set, and what gets sent');
  assert.equal(v.channels.airbnb.guest, 2280, 'what the guest is charged');
  assert.equal(v.channels.airbnb.net, 1940, 'what reaches you');
  assert.equal(v.channels.airbnb.markup, 14);
});

test('every channel is reported, not only the one being looked at', () => {
  // So a screen can switch between them without asking again.
  const v = viewsFor(2000, splitFee);
  assert.deepEqual(Object.keys(v.channels), ['airbnb', 'booking', 'vrbo']);
  assert.equal(v.channels.booking.guest, 2000, 'no markup set for this one');
});

test('markup and commission are independent of each other', () => {
  // The whole reason they are two fields. Same rate, same commission,
  // different markup: what you keep does not move.
  const a = viewsFor(2000, { commission_airbnb: 3, guest_markup_airbnb: 0 });
  const b = viewsFor(2000, { commission_airbnb: 3, guest_markup_airbnb: 20 });
  assert.equal(a.channels.airbnb.net, b.channels.airbnb.net, 'the guest fee was never yours');
  assert.notEqual(a.channels.airbnb.guest, b.channels.airbnb.guest);
});

test('the channel list carries both percentages for a form to show', () => {
  const list = channelList(splitFee);
  const airbnb = list.find((c) => c.key === 'airbnb');
  assert.equal(airbnb.label, 'Airbnb');
  assert.equal(airbnb.markup, 14);
  assert.equal(airbnb.commission, 3);
});
