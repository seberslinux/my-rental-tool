const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { daysAgo } = require('../helpers/dates');

test.before(async () => { await getApp(); });
test.beforeEach(async () => { await resetDb(); });
test.after(() => closePool());

test('a booking Smoobu has no price for is price unknown, not valued at the minimum price', async () => {
  const admin = await seedUser({ role: 'admin' });
  // The Loft's Smoobu minimum price is 80: it must never turn into revenue.
  const p = await seedProperty({ owner: admin, name: 'The loft', base_price: 80 });
  await seedBooking({ property: p, check_in: daysAgo(20), check_out: daysAgo(18), platform: 'Airbnb', total_price: 6000, length_of_stay: 2 });
  await seedBooking({ property: p, check_in: daysAgo(12), check_out: daysAgo(9), platform: 'VRBO / HomeAway', total_price: 0, length_of_stay: 3 });
  const agent = await getAgent();
  await loginAs(agent, admin);

  const { body } = await agent.get(`/api/analytics/data?from=${daysAgo(60)}&to=${daysAgo(1)}`).expect(200);
  assert.equal(body.summary.total_revenue, 6000, 'no R80 × 3 added');
  assert.equal(body.summary.avg_adr, 3000, 'ADR over the priced nights only');
  assert.equal(body.summary.price_unknown.bookings, 1);
  assert.equal(body.summary.price_unknown.nights, 3);
  assert.equal(body.summary.has_imputed_revenue, false);
  const vrbo = body.channel_stats.find((c) => /vrbo/i.test(c.channel));
  assert.ok(vrbo, 'the channel still shows');
  assert.equal(vrbo.price_unknown, 1);
  assert.equal(vrbo.revenue, 0);
});
