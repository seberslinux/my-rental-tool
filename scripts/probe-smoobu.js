/**
 * What does Smoobu actually send us?
 *
 * Written because a question came up that nothing in this repository can
 * answer: Smoobu has a per-channel markup — the percentage added to your
 * rate to make the price a guest sees on Airbnb or Booking.com — and we
 * needed to know whether the API exposes it, and under what name.
 *
 * The documentation could not be read from the machine this was written
 * on, and guessing at a field name is how you ship a sync that silently
 * reads undefined. So this asks Smoobu directly and prints what comes
 * back.
 *
 * ## It only reads
 *
 * Two GETs against Smoobu and two SELECTs against the database. No
 * writes of any kind, to either. That matters because the sensible way
 * to run it is `railway run`, which points at the production database —
 * see CLAUDE.md. Nothing here can change a rate, a booking or a row.
 *
 *   railway run node scripts/probe-smoobu.js
 *
 * ## What it prints
 *
 * Every key Smoobu returns for an apartment, with anything that looks
 * like a markup, a percentage or a channel setting called out. Then the
 * same for a stored reservation payload, which we keep verbatim in
 * bookings.raw_payload.
 *
 * If the markup is in there, this says what it is called and we can sync
 * it into guest_markup_*. If it is not, the field stays something you
 * type in once, and now we know rather than assume.
 */

const { getAll, getOne, pool } = require('../src/db/database');
const smoobu = require('../src/services/smoobu');
const { getApiKeyForProperty } = require('../src/services/api-key-resolver');

/** Anything whose name suggests a price adjustment or a channel setting. */
const INTERESTING = /markup|mark_up|percent|percentage|commission|channel|surcharge|increase|adjust|fee|price/i;

/** Keys of an object, including nested ones, as dotted paths. */
function paths(value, prefix = '', depth = 0, out = []) {
  if (depth > 3 || value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length) paths(value[0], `${prefix}[0]`, depth + 1, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const leaf = v == null || typeof v !== 'object';
    out.push({ path, leaf, sample: leaf ? v : undefined });
    paths(v, path, depth + 1, out);
  }
  return out;
}

function report(title, payload) {
  console.log(`\n=== ${title} ===`);
  if (!payload) return console.log('  (nothing came back)');

  const all = paths(payload);
  const hits = all.filter((p) => INTERESTING.test(p.path));

  console.log(`  ${all.length} fields in total.`);
  if (hits.length === 0) {
    console.log('  Nothing matching markup / percent / commission / channel / fee / price.');
  } else {
    console.log('  Possibly relevant:');
    for (const h of hits) {
      const shown = h.leaf ? ` = ${JSON.stringify(h.sample)}` : ' (object)';
      console.log(`    ${h.path}${shown}`);
    }
  }
  console.log('  Every top-level key:');
  console.log(`    ${Object.keys(payload).join(', ')}`);
}

async function probe() {
  const properties = await getAll(
    'SELECT id, name, smoobu_id FROM properties WHERE smoobu_id IS NOT NULL ORDER BY id'
  );
  if (properties.length === 0) {
    console.log('No properties with a Smoobu id. Nothing to ask about.');
    return;
  }

  const property = properties[0];
  const apiKey = await getApiKeyForProperty(property.id);
  if (!apiKey) {
    console.log('No Smoobu API key resolved. Set SMOOBU_API_KEY or configure one on the owner.');
    return;
  }

  console.log(`Asking Smoobu about "${property.name}" (apartment ${property.smoobu_id}).`);

  // 1. The apartment list entry.
  try {
    const list = await smoobu.getProperties(apiKey);
    const mine = list.find((a) => String(a.id) === String(property.smoobu_id)) || list[0];
    report('GET /apartments — one entry', mine);
  } catch (err) {
    console.log(`\n=== GET /apartments failed ===\n  ${err.message}`);
  }

  // 2. The apartment in full, which is where a per-channel setting would
  //    most plausibly live.
  try {
    const detail = await smoobu.getPropertyDetails(property.smoobu_id, apiKey);
    report(`GET /apartments/${property.smoobu_id}`, detail);
  } catch (err) {
    console.log(`\n=== GET /apartments/${property.smoobu_id} failed ===\n  ${err.message}`);
  }

  // 3. A reservation as Smoobu sent it. Read from our own table rather
  //    than fetched again — we already keep these verbatim.
  const booking = await getOne(
    `SELECT raw_payload FROM bookings
      WHERE raw_payload IS NOT NULL AND property_id = $1
      ORDER BY check_in DESC LIMIT 1`,
    [property.id]
  );
  report('A stored reservation payload (bookings.raw_payload)', booking && booking.raw_payload);

  console.log(`
Read this looking for a per-channel markup — the percentage Smoobu adds
to your rate to make the price a guest sees. If it appears above, say
what it is called and it can be synced into guest_markup_*. If nothing
resembles it, the API does not expose it and the field stays something
you set once by hand.
`);
}

/**
 * Only when run, never when required.
 *
 * `paths` decides whether this script finds anything, so it is tested —
 * a broken matcher would report "nothing resembling a markup" and we
 * would conclude the API lacks a field it actually has. Importing the
 * file to test that must not fire the probe or open a pool.
 */
if (require.main === module) {
  probe().
  catch((err) => {
    console.error('Probe failed:', err.message);
    process.exitCode = 1;
  }).
  finally(() => pool.end());
}

module.exports = { paths, INTERESTING };
