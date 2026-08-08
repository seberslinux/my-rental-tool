/**
 * Phone numbers, compared the way people type them.
 *
 * Cleaner login matched the stored number as an exact string:
 *
 *   SELECT * FROM cleaners WHERE phone = $1
 *
 * The login field's own placeholder is "+27 82 123 4567", spaces and
 * all, so following the hint produced a string that could never match a
 * number saved as "+27821234567". To a person those are one number; to
 * that query they are two rows, and so are "0821234567" and
 * "27 82 123 4567".
 *
 * The failure then reported "Invalid phone or PIN", which blames the PIN
 * for a formatting mismatch — the one thing the cleaner would retype,
 * and the one thing that was never wrong.
 *
 * Nothing is rewritten in the database. Both sides are normalised at the
 * moment of comparison, so existing rows keep whatever format they were
 * entered in.
 */

// The properties are in Cape Town and cleaners are local, so a number
// written in national form ("082...") is South African. Only the leading
// zero is ambiguous; anything already carrying a country code is left
// alone.
const DEFAULT_COUNTRY_CODE = '27';

/**
 * Reduce a number to comparable digits.
 *
 *   "+27 82 123 4567" -> "27821234567"
 *   "082 123 4567"    -> "27821234567"
 *   "(082) 123-4567"  -> "27821234567"
 *
 * Returns '' for anything with no digits at all, which never matches —
 * an empty stored number must not let someone log in by sending "".
 */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';

  // 00 is the international prefix in much of the world — 0027... is the
  // same number as +27...
  if (digits.startsWith('00')) return digits.slice(2);

  // A single leading zero is the national trunk prefix: drop it and add
  // the country code.
  if (digits.startsWith('0')) return DEFAULT_COUNTRY_CODE + digits.replace(/^0+/, '');

  return digits;
}

/** Do two numbers refer to the same line, however they were written? */
function samePhone(a, b) {
  const na = normalizePhone(a);
  return na !== '' && na === normalizePhone(b);
}

module.exports = { normalizePhone, samePhone, DEFAULT_COUNTRY_CODE };
