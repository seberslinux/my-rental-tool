const test = require('node:test');
const assert = require('node:assert/strict');
const { paths, INTERESTING } = require('../scripts/probe-smoobu');

/**
 * The probe has to find the thing it is looking for.
 *
 * It exists to answer one question — does Smoobu send a per-channel
 * markup, and what is it called — and the way it fails is silent: a
 * matcher that misses returns "nothing resembling a markup", and we
 * conclude the API lacks a field it actually has, then ask somebody to
 * type in a number that was available all along.
 *
 * So the walk and the matcher are pinned against the shapes an answer
 * could plausibly arrive in.
 */

test('nested fields are found, not only top-level ones', () => {
  // A per-channel setting would most likely arrive nested under the
  // channel rather than flat on the apartment.
  const payload = {
    id: 42,
    name: 'Hill Top Lodge',
    channels: [{ id: 1, name: 'Airbnb', markup: 14 }],
  };
  const found = paths(payload).map((p) => p.path);
  assert.ok(found.includes('channels[0].markup'), `walked into the array: ${found.join(', ')}`);
});

test('a matching field reports its value, so we learn the name and the number', () => {
  const hit = paths({ price_markup_percent: 14 }).find((p) => p.path === 'price_markup_percent');
  assert.equal(hit.leaf, true);
  assert.equal(hit.sample, 14);
});

test('the shapes a markup could arrive as are all matched', () => {
  for (const name of [
    'markup', 'mark_up', 'markupPercent', 'price_markup',
    'channel_percentage', 'commission', 'priceIncrease', 'surcharge',
    'channelFee',
  ]) {
    assert.ok(INTERESTING.test(name), `${name} should be flagged as worth reading`);
  }
});

test('ordinary fields are not flagged, or the signal drowns', () => {
  for (const name of ['id', 'name', 'timeZone', 'bedrooms', 'latitude']) {
    assert.ok(!INTERESTING.test(name), `${name} should not be flagged`);
  }
});

test('the walk survives nulls, empty arrays and primitives', () => {
  // A real payload has all three, and a probe that throws tells us
  // nothing at all.
  assert.deepEqual(paths(null), []);
  assert.deepEqual(paths(7), []);
  assert.deepEqual(paths([]), []);
  assert.doesNotThrow(() => paths({ a: null, b: [], c: { d: undefined } }));
});

test('it does not descend for ever', () => {
  // Depth-capped, so a payload with a cycle-ish depth cannot hang the
  // probe somebody is running against production.
  let deep = { v: 1 };
  for (let i = 0; i < 12; i++) deep = { nest: deep };
  const found = paths(deep).map((p) => p.path);
  assert.ok(found.length > 0);
  assert.ok(found.every((p) => p.split('.').length <= 5), 'stops a few levels down');
});
