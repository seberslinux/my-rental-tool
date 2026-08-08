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

/**
 * Template sends are recorded separately: app-initiated messages must be
 * templates, so a test asserting "the cleaner was messaged" has to check
 * this list and not `sent`.
 */
const templates = [];

function resetTemplates(behaviour = 'ok') {
  templates.length = 0;
  whatsapp.sendTemplateMessage = async (to, name, components) => {
    templates.push({ to, name, components });
    if (behaviour === 'fail') {
      const err = new Error('send failed');
      err.response = { data: { error: { message: 'Session has expired' } } };
      throw err;
    }
    return { ok: true, id: `wa-t-${templates.length}` };
  };
}

resetTemplates();

module.exports.templates = templates;
module.exports.resetTemplates = resetTemplates;
