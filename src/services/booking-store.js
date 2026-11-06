/**
 * One statement that writes a booking, for every path that writes one.
 *
 * `smoobu-mapper` made the *mapping* single. The writing stayed
 * quadruple: the routine sync, the historical resync and the webhook's
 * two branches each carried a hand-written column list, and they
 * disagreed about which columns existed.
 *
 * That is not a tidiness complaint, it is the same bug three times:
 *
 *   - the webhook's new-booking insert left out `length_of_stay` and
 *     `price_per_night`, so every booking that arrived by push was
 *     stored as a one-night stay whatever its dates
 *   - the webhook's modify branch updated ten fields, so a stay whose
 *     dates changed kept the old night count and the old nightly price
 *   - neither sync path wrote `raw_payload` at all, and
 *     reset-and-resync opens with `DELETE FROM bookings` — so a resync
 *     erased every verbatim payload the webhook had ever stored
 *
 * The last one matters most. `raw_payload` is the reason an unmapped
 * field is recoverable: Smoobu's API serves a limited window, so a
 * field not captured when the booking arrives cannot be fetched later.
 * Keeping it on one path and wiping it on another meant the safety net
 * was there for whichever bookings happened to arrive by webhook since
 * the last resync, and gone for the rest.
 *
 * So: the mapper decides what a row contains, this decides how it is
 * written, and a new field is one line in each.
 */

/**
 * Every column a mapped row fills, in order.
 *
 * `status` is last of the mapped set so a caller can override it
 * without disturbing the rest — the webhook's new-booking branch
 * asserts 'confirmed' rather than trusting an event type it has
 * already matched on.
 */
const COLUMNS = [
  'smoobu_id', 'property_id', 'guest_name', 'check_in', 'check_out',
  'platform', 'total_price', 'num_guests', 'children', 'created_at',
  'modified_at', 'lead_time_days', 'length_of_stay', 'price_per_night',
  'currency', 'commission', 'language', 'guest_country', 'raw_payload',
  'status',
];

/**
 * Columns that are not overwritten blindly on a repeat.
 *
 * A later payload is usually fuller than an earlier one, but not
 * always: Smoobu's modification events carry the fields that changed
 * and leave the rest empty. Writing those through would blank a guest
 * name or a booking date that is still perfectly good.
 *
 * `created_at` never changes once a booking exists, and `lead_time_days`
 * is measured from it, so both follow it.
 */
const KEEP_IF_BLANK = {
  guest_name: "CASE WHEN EXCLUDED.guest_name = '' THEN bookings.guest_name ELSE EXCLUDED.guest_name END",
  created_at: "CASE WHEN EXCLUDED.created_at = '' THEN bookings.created_at ELSE EXCLUDED.created_at END",
  lead_time_days: "CASE WHEN EXCLUDED.created_at = '' THEN bookings.lead_time_days ELSE EXCLUDED.lead_time_days END",
};

function buildSql(propertyIdIsLookup) {
  const names = COLUMNS.join(', ');
  // property_id is either passed straight in or resolved from the
  // apartment's Smoobu id, depending on what the caller already knows.
  const values = COLUMNS.map((c, i) =>
    c === 'property_id' && propertyIdIsLookup ?
      `(SELECT id FROM properties WHERE smoobu_id = $${i + 1})` :
      `$${i + 1}`
  ).join(', ');

  const updates = COLUMNS
    .filter((c) => c !== 'smoobu_id' && c !== 'property_id')
    .map((c) => `${c} = ${KEEP_IF_BLANK[c] || `EXCLUDED.${c}`}`)
    .join(', ');

  return `INSERT INTO bookings (${names}) VALUES (${values})
          ON CONFLICT(smoobu_id) DO UPDATE SET ${updates}`;
}

/**
 * Write one mapped booking.
 *
 * `exec` is anything with the `(sql, params)` shape — `run` from the
 * database module, or a transaction client's `query`, so a sync can do
 * a few hundred of these inside one transaction.
 *
 * Give either `propertyId`, when the caller has already looked the
 * property up, or nothing, in which case the apartment's Smoobu id on
 * the row resolves it. `status` overrides the mapped one.
 */
async function upsertBooking(exec, row, { propertyId = null, status = null } = {}) {
  const byLookup = propertyId === null;
  const values = COLUMNS.map((c) => {
    if (c === 'property_id') return byLookup ? row.apartment_smoobu_id : propertyId;
    if (c === 'status') return status || row.status;
    if (c === 'raw_payload') return row.raw_payload === undefined ? null : row.raw_payload;
    return row[c];
  });
  return exec(buildSql(byLookup), values);
}

module.exports = { upsertBooking, COLUMNS, KEEP_IF_BLANK, buildSql };
