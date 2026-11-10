const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The shape of a conversation request.
 *
 * `onlyRelatedToGuest: true` returns only what the guest wrote. Every
 * reply was missing from the app — four guest messages in a row,
 * answering somebody who was not on the screen — and nothing else in
 * the suite would notice, because the mock does not read query strings.
 * One word, invisible when wrong: pinned here.
 */

function withAxiosStub(run) {
  const axios = require('axios');
  const originalCreate = axios.create;
  const seen = [];
  axios.create = () => ({
    get: async (url, config) => { seen.push({ method: 'get', url, params: config.params }); return { data: {} }; },
    post: async (url, body) => { seen.push({ method: 'post', url, body }); return { data: {} }; },
    defaults: { headers: {} },
    interceptors: { request: { use() {} } },
  });
  delete require.cache[require.resolve('../src/services/smoobu')];
  const fresh = require('../src/services/smoobu');
  return run(fresh).then(() => seen).finally(() => {
    axios.create = originalCreate;
    delete require.cache[require.resolve('../src/services/smoobu')];
  });
}

test('a conversation is asked for with both sides of it', async () => {
  const seen = await withAxiosStub((s) => s.getMessages(900001, { page: 1 }, 'key'));
  assert.equal(seen[0].url, '/reservations/900001/messages');
  assert.equal(seen[0].params.onlyRelatedToGuest, false, 'true returns only what the guest wrote');
  assert.equal(seen[0].params.page, 1);
});

test('a reply goes to the documented send path', async () => {
  const seen = await withAxiosStub((s) =>
    s.sendMessageToGuest(900001, { messageBody: 'Hello' }, 'key'));
  assert.equal(seen[0].method, 'post');
  assert.equal(seen[0].url, '/reservations/900001/messages/send-message-to-guest');
  assert.equal(seen[0].body.messageBody, 'Hello');
});

test('the inbox is asked for by apartment', async () => {
  const seen = await withAxiosStub((s) => s.getThreads({ apartments: [2297844] }, 'key'));
  assert.equal(seen[0].url, '/threads');
  assert.deepEqual(seen[0].params.apartments, [2297844]);
});
