const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The shape Smoobu wants for a rates request.
 *
 * It answers `from`/`to` with 422 "Request has wrong structure" and no
 * indication of which part is wrong. syncRates catches that per property,
 * logs to a console nobody reads, and the same sync call reports success
 * for the bookings half — so daily_rates was empty in production from the
 * day the feature was written, and the only symptom was blank cells,
 * which read as "no price set" rather than "this has never worked".
 *
 * Pinned as a unit test because it is one word, it is invisible when
 * wrong, and nothing else in the suite would notice.
 */

test('rates are asked for with start_date and end_date', async () => {
  const smoobu = require('../src/services/smoobu');
  const axios = require('axios');

  let seen = null;
  const originalCreate = axios.create;
  axios.create = () => ({
    get: async (url, config) => { seen = { url, params: config.params }; return { data: {} }; },
  });

  try {
    // Re-require with the stub in place.
    delete require.cache[require.resolve('../src/services/smoobu')];
    const fresh = require('../src/services/smoobu');
    await fresh.getRates(12345, '2026-08-10', '2026-08-17', 'key');
  } finally {
    axios.create = originalCreate;
    delete require.cache[require.resolve('../src/services/smoobu')];
  }

  assert.equal(seen.url, '/rates');
  assert.deepEqual(seen.params.apartments, [12345]);
  assert.equal(seen.params.start_date, '2026-08-10', 'not "from"');
  assert.equal(seen.params.end_date, '2026-08-17', 'not "to"');
  assert.ok(!('from' in seen.params), 'from is what Smoobu rejects');
  assert.ok(!('to' in seen.params));
});
