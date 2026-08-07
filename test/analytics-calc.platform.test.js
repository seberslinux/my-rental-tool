const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePlatform,
  isBlockedPlatform,
} = require('../src/services/analytics-calc');

test('normalizePlatform: null → Direct', () => {
  assert.equal(normalizePlatform(null), 'Direct');
});

test('normalizePlatform: empty string → Direct', () => {
  assert.equal(normalizePlatform(''), 'Direct');
});

test('normalizePlatform: Smoobu "Direct booking" → Direct', () => {
  // Regression guard: "Direct booking" contains "booking" — order matters.
  assert.equal(normalizePlatform('Direct booking'), 'Direct');
});

test('normalizePlatform: Airbnb variants', () => {
  assert.equal(normalizePlatform('Airbnb'), 'Airbnb');
  assert.equal(normalizePlatform('airbnb'), 'Airbnb');
  assert.equal(normalizePlatform('AIRBNB'), 'Airbnb');
  assert.equal(normalizePlatform('Airbnb 2'), 'Airbnb');
});

test('normalizePlatform: Booking.com', () => {
  assert.equal(normalizePlatform('Booking.com'), 'Booking.com');
  assert.equal(normalizePlatform('booking'), 'Booking.com');
});

test('normalizePlatform: VRBO and HomeAway alias', () => {
  assert.equal(normalizePlatform('VRBO'), 'VRBO');
  assert.equal(normalizePlatform('vrbo'), 'VRBO');
  assert.equal(normalizePlatform('HomeAway'), 'VRBO');
});

test('normalizePlatform: blocked channel', () => {
  assert.equal(normalizePlatform('Blocked channel'), 'Blocked');
  assert.equal(normalizePlatform('blocked'), 'Blocked');
});

test('normalizePlatform: unknown → Direct', () => {
  assert.equal(normalizePlatform('Some random channel'), 'Direct');
});

test('isBlockedPlatform', () => {
  assert.equal(isBlockedPlatform(null), false);
  assert.equal(isBlockedPlatform(''), false);
  assert.equal(isBlockedPlatform('Blocked'), true);
  assert.equal(isBlockedPlatform('blocked'), true);
  assert.equal(isBlockedPlatform('Blocked channel'), true);
  assert.equal(isBlockedPlatform('Airbnb'), false);
  assert.equal(isBlockedPlatform('Not blocked'), false); // does not start with "blocked"
});
