/**
 * Stubs the whatsapp service so tests never send real messages.
 *
 * The stub records every call in `sent` so tests can assert on what was
 * sent (recipient, body). `reset()` clears the log between tests.
 *
 * Usage:
 *   const mockWa = require('../helpers/mock-whatsapp');
 *   test.beforeEach(() => mockWa.reset());
 *   ...
 *   assert.equal(mockWa.sent.length, 1);
 *   assert.equal(mockWa.sent[0].to, '+27...');
 */

const whatsapp = require('../../src/services/whatsapp');

const sent = [];

function reset() {
  sent.length = 0;
  whatsapp.sendMessage = async (to, message) => {
    sent.push({ to, message, at: sent.length });
    return { ok: true, id: `wa-${sent.length}` };
  };
}

reset();

module.exports = { reset, sent };
