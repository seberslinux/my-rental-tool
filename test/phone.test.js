const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, samePhone } = require('../src/services/phone');

/**
 * Cleaner login matched the stored number as an exact string, while the
 * login field's placeholder read "+27 82 123 4567" — spaces included.
 * Following the hint produced a string that could never match a number
 * saved as "+27821234567", and the rejection said "Invalid phone or
 * PIN": it blamed the PIN, the one thing that was never wrong.
 *
 * These pin the shapes a person actually types.
 */

const CANONICAL = '27821234567';

// --- the forms one South African number arrives in ----------------------

test('spaces, as the login placeholder itself suggests', () => {
  assert.equal(normalizePhone('+27 82 123 4567'), CANONICAL);
});

test('national form with the trunk zero', () => {
  assert.equal(normalizePhone('082 123 4567'), CANONICAL);
});

test('the 00 international prefix', () => {
  assert.equal(normalizePhone('0027821234567'), CANONICAL);
});

test('brackets and dashes', () => {
  assert.equal(normalizePhone('(082) 123-4567'), CANONICAL);
});

test('already canonical, left alone', () => {
  assert.equal(normalizePhone('27821234567'), CANONICAL);
});

test('every one of those is the same line', () => {
  const forms = [
    '+27 82 123 4567',
    '082 123 4567',
    '0027821234567',
    '(082) 123-4567',
    '27821234567',
    '+27-82-123-4567',
  ];
  for (const f of forms) {
    assert.ok(samePhone(f, '+27821234567'), `${f} should match`);
  }
});

// --- numbers that must not be conflated ---------------------------------

test('different numbers stay different', () => {
  assert.ok(!samePhone('082 123 4567', '082 123 4568'));
});

test('a foreign number keeps its own country code', () => {
  // Jane's stored number is a 17-digit +34... string. It must normalise
  // to itself, not have a 27 bolted on.
  assert.equal(normalizePhone('+34435433243242'), '34435433243242');
  assert.ok(!samePhone('+34435433243242', '0435433243242'));
});

// --- the empty case, which is a security question -----------------------

test('an empty stored number never matches anything', () => {
  // A cleaner row saved with no phone must not let someone in by
  // submitting "" — or by submitting a string of punctuation.
  assert.equal(normalizePhone(''), '');
  assert.ok(!samePhone('', ''));
  assert.ok(!samePhone('+-() ', ''));
  assert.ok(!samePhone(null, null));
  assert.ok(!samePhone(undefined, ''));
});

test('non-string input does not throw', () => {
  assert.equal(normalizePhone(27821234567), CANONICAL);
  assert.equal(normalizePhone(null), '');
});

test('a lone zero is not a phone number', () => {
  assert.equal(normalizePhone('0'), '27');
  assert.ok(!samePhone('0', '+27 82 123 4567'));
});
