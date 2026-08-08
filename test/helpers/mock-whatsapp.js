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
  // Stubbing the transport means simulating a channel that is switched
  // on. notify() checks isConfigured() before it attempts anything, and
  // that reads the environment, so the environment has to agree — a test
  // asserting "the message went out" would otherwise assert against a
  // WhatsApp that is turned off.
  process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || 'test-phone-id';
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
