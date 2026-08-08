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
 * ## Why there is no default country
 *
 * The obvious fix is to read a leading zero as the South African trunk
 * prefix and bolt 27 onto the front. That is wrong the moment a cleaner
 * is not South African: a German number typed in German national form,
 * "030 12345678", would become 27 3012345678 — a Cape Town prefix on a
 * Berlin line — and never match the +49 number on file.
 *
 * A leading zero means "national format" in South Africa, Germany, the
 * UK and most of Europe, and nothing in the string says which. So this
 * does not guess. It compares the national part against the *stored*
 * number and lets that number supply the country: if the digits on file
 * end with the digits typed, and what remains in front is the length of
 * a country code, they are the same line. That works for +27 and +49
 * alike without a table of dialling codes.
 *
 * Nothing is rewritten in the database. Both sides are normalised at the
 * moment of comparison, so existing rows keep whatever format they were
 * entered in.
 */

// Country codes are one to three digits (+1, +27, +49, +351). Anything
// longer in front of a matching national number is not a country code,
// it is a different number.
const MAX_COUNTRY_CODE_DIGITS = 3;

// Short strings must not match by suffix: "234567" should not sign
// someone in against +27821234567. Real subscriber numbers are longer.
const MIN_NATIONAL_DIGITS = 6;

/**
 * Reduce a number to its digits, resolving only what is unambiguous.
 *
 *   "+27 82 123 4567" -> "27821234567"
 *   "(082) 123-4567"  -> "0821234567"    (national form, country unknown)
 *   "0049 30 1234"    -> "49301234"      (00 is international everywhere)
 *
 * The leading zero is deliberately left in place: resolving it needs a
 * country, and this function is not given one. samePhone() resolves it
 * against the number on file.
 */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  // 00 is the international access prefix in most of the world, so
  // 0027... and 0049... are unambiguous.
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

/** The subscriber part of a national-format number, or null. */
function nationalPart(digits) {
  if (!digits.startsWith('0')) return null;
  const national = digits.replace(/^0+/, '');
  return national.length >= MIN_NATIONAL_DIGITS ? national : null;
}

/**
 * Is `international` the same line as national-format `national`?
 * True when the full number ends with it and the country code in front
 * is a plausible length.
 */
function matchesWithCountryCode(international, national) {
  if (!international.endsWith(national)) return false;
  const cc = international.length - national.length;
  return cc >= 1 && cc <= MAX_COUNTRY_CODE_DIGITS;
}

/** Do two numbers refer to the same line, however they were written? */
function samePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na === '' || nb === '') return false;
  if (na === nb) return true;

  // One side written nationally, the other with its country code — the
  // international one tells us which country the zero stood for.
  const partA = nationalPart(na);
  if (partA && matchesWithCountryCode(nb, partA)) return true;

  const partB = nationalPart(nb);
  if (partB && matchesWithCountryCode(na, partB)) return true;

  return false;
}

module.exports = { normalizePhone, samePhone };
