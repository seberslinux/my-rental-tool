const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sign, canonicalString, canonicalQuery, sha256Hex } = require('../src/services/smoobu-auth');

/**
 * The signature is only worth anything if both sides build the same
 * bytes. These pin the shape of the string that gets hashed, because a
 * silent change to it fails every Smoobu call at once — and the failure
 * looks like "unauthorised", which reads as a credential problem rather
 * than a code one.
 */

const KEY = 'usr_live_test';
const SECRET = 'shhh';
const TS = '2026-09-01T12:00:00Z';
const NONCE = '550e8400-e29b-41d4-a716-446655440000';

test('the canonical string is seven lines in a fixed order', () => {
  const s = canonicalString({
    method: 'get', path: '/api/apartments', params: {}, timestamp: TS, nonce: NONCE, body: null, key: KEY,
  });
  assert.deepEqual(s.split('\n'), [
    'GET',                  // upper-cased
    '/api/apartments',
    '',                     // no query
    TS,
    NONCE,
    sha256Hex(''),          // no body is the hash of the empty string
    KEY,
  ]);
});

test('query parameters are sorted, so both sides agree on the bytes', () => {
  // axios does not promise an order, and the server rebuilds this from
  // what arrived. Sorting is what makes the two match.
  assert.equal(canonicalQuery({ b: 2, a: 1 }), 'a=1&b=2');
  assert.equal(canonicalQuery({ a: 1, b: 2 }), 'a=1&b=2');
});

test('arrays are repeated the way axios sends them', () => {
  // apartments[]=1&apartments[]=2, not apartments=1,2 — the signed
  // string has to match the wire.
  assert.equal(
    canonicalQuery({ apartments: [2500823, 2297844] }),
    'apartments%5B%5D=2297844&apartments%5B%5D=2500823'
  );
});

test('nothing and empty are the same thing', () => {
  assert.equal(canonicalQuery(), '');
  assert.equal(canonicalQuery({}), '');
  assert.equal(canonicalQuery({ a: undefined, b: null }), '');
});

test('a body is hashed, so the signature covers what is being sent', () => {
  const body = { apartments: [1], operations: [{ dates: ['2026-09-20'], daily_price: 2400 }] };
  const withBody = canonicalString({
    method: 'POST', path: '/api/rates', params: {}, timestamp: TS, nonce: NONCE, body, key: KEY,
  });
  assert.ok(withBody.includes(sha256Hex(JSON.stringify(body))));

  // Change one rand and the signed bytes change.
  const other = { ...body, operations: [{ dates: ['2026-09-20'], daily_price: 2401 }] };
  assert.notEqual(
    canonicalString({ method: 'POST', path: '/api/rates', params: {}, timestamp: TS, nonce: NONCE, body: other, key: KEY }),
    withBody
  );
});

test('the signature is a base64 HMAC-SHA256 of exactly that string', () => {
  const { canonical, headers } = sign({
    method: 'GET', path: '/api/apartments', params: {}, body: null,
    key: KEY, secret: SECRET, timestamp: TS, nonce: NONCE,
  });
  const expected = crypto.createHmac('sha256', SECRET).update(canonical, 'utf8').digest('base64');
  assert.equal(headers['X-Signature'], expected);
  assert.equal(headers['X-API-Key'], KEY);
  assert.equal(headers['X-Timestamp'], TS);
  assert.equal(headers['X-Nonce'], NONCE);
});

test('a fresh timestamp and nonce each time', () => {
  // Both are single-use inside a five-minute window; reusing either is
  // how a run of calls starts failing after the first.
  const a = sign({ method: 'GET', path: '/api/apartments', key: KEY, secret: SECRET });
  const b = sign({ method: 'GET', path: '/api/apartments', key: KEY, secret: SECRET });
  assert.notEqual(a.headers['X-Nonce'], b.headers['X-Nonce']);
  assert.match(a.headers['X-Timestamp'], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'no milliseconds');
});
