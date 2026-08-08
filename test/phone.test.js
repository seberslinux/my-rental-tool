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
 * The first fix read a leading zero as the South African trunk prefix.
 * That breaks for any cleaner who is not South African — a German
 * number typed as "030 12345678" would have become 27 3012345678, a
 * Cape Town prefix on a Berlin line. No country is assumed now; the
 * stored number supplies it.
 */

// --- one number, however it is written ----------------------------------

test('the placeholder form and the stored form are the same line', () => {
  assert.ok(samePhone('+27 82 123 4567', '+27821234567'));
});

test('national form matches the international number on file', () => {
  assert.ok(samePhone('082 123 4567', '+27821234567'));
});

test('the 00 international prefix resolves without a country guess', () => {
  assert.equal(normalizePhone('0027821234567'), '27821234567');
  assert.ok(samePhone('0027821234567', '+27 82 123 4567'));
});

test('brackets, dashes and spaces are all noise', () => {
  for (const f of ['(082) 123-4567', '082-123-4567', '082 123 4567', '0821234567']) {
    assert.ok(samePhone(f, '+27821234567'), `${f} should match`);
  }
});

test('it works in both directions', () => {
  // Whichever side happens to be stored nationally.
  assert.ok(samePhone('+27821234567', '082 123 4567'));
  assert.ok(samePhone('082 123 4567', '+27821234567'));
});

// --- any country, not just South Africa ---------------------------------

test('a German number typed in German national form matches', () => {
  // The case that broke the first version: +49 on file, 030… typed.
  assert.ok(samePhone('+49 30 12345678', '030 12345678'));
});

test('German international forms match each other', () => {
  assert.ok(samePhone('+49 30 12345678', '0049 30 12345678'));
  assert.ok(samePhone('+49 30 12345678', '49 30 12345678'));
});

test('a UK number in national form matches', () => {
  assert.ok(samePhone('+44 20 7123 4567', '020 7123 4567'));
});

test('normalizePhone leaves the national zero alone', () => {
  // Resolving it needs a country, and this function is not given one.
  assert.equal(normalizePhone('082 123 4567'), '0821234567');
  assert.equal(normalizePhone('+27 82 123 4567'), '27821234567');
});

// --- numbers that must not be conflated ---------------------------------

test('the same digits under different country codes are different lines', () => {
  assert.ok(!samePhone('+27 82 123 4567', '+49 82 123 4567'));
});

test('different subscriber numbers stay different', () => {
  assert.ok(!samePhone('082 123 4567', '082 123 4568'));
  assert.ok(!samePhone('+49 30 12345678', '+49 30 12345679'));
});

test('a suffix match is not enough on its own', () => {
  // "1234567" appearing at the end of a longer number must not sign
  // anyone in — what precedes it has to be country-code length.
  assert.ok(!samePhone('01234567', '+27 99 888 1234567'));
});

test('a short string cannot match by suffix', () => {
  assert.ok(!samePhone('0234567', '+27821234567'));
  assert.ok(!samePhone('0', '+27 82 123 4567'));
});

// --- the empty case, which is a security question -----------------------

test('an empty stored number never matches anything', () => {
  // A cleaner row saved with no phone must not let someone in by
  // submitting "" — or a string of punctuation.
  assert.equal(normalizePhone(''), '');
  assert.ok(!samePhone('', ''));
  assert.ok(!samePhone('+-() ', ''));
  assert.ok(!samePhone(null, null));
  assert.ok(!samePhone(undefined, '+27821234567'));
});

test('non-string input does not throw', () => {
  assert.equal(normalizePhone(27821234567), '27821234567');
  assert.equal(normalizePhone(null), '');
});
