/**
 * What somebody typed, as a list.
 *
 * A request for supplies arrives as prose in a box, and it is almost
 * never one thing: "laundry liquid, bin liners, dishwasher tablets"
 * written down the lines of a textarea the way anybody writes a shopping
 * list. Stored as one row that is one thing to tick off, so buying the
 * bin liners means either closing the other two with them or leaving all
 * three open. Neither is true, and the list stops being worth keeping.
 *
 * So the split happens once, here, on the way in — rather than being
 * guessed at on the way out, where the same text would have to be
 * re-parsed on every render and could not be ticked off individually
 * anyway.
 */

/** Nobody writes a shopping list this long; past here it is a paste accident. */
const MAX_ITEMS = 50;

/**
 * Lines, tidied.
 *
 * Accepts either an array (a client that already knows the shape) or the
 * raw text of a box somebody typed into. Leading bullets and "1." style
 * numbering go, because people type them and they are not part of the
 * item's name.
 *
 * The bullet strip deliberately requires whitespace after the marker, so
 * "2 rolls of bin liners" keeps its 2 — a quantity at the start of a
 * line is far commoner than a numbered list, and eating it would be a
 * silent wrong answer rather than an untidy one.
 */
function splitItems(input) {
  const lines = Array.isArray(input) ?
  input.map((s) => String(s == null ? '' : s)) :
  String(input == null ? '' : input).split(/\r?\n/);

  return lines.
  map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).
  filter(Boolean).
  slice(0, MAX_ITEMS);
}

module.exports = { splitItems, MAX_ITEMS };
