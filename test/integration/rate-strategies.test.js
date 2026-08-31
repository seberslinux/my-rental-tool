const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, seedBooking, loginAs } = require('../helpers/seed');
const { inDays, todayISO } = require('../helpers/dates');
const { pool } = require('../../src/db/database');

/**
 * Choosing algorithms, trying them, and only then sending them.
 *
 * The rate plan says what a night is worth by what kind of night it is.
 * These are the rules that read the diary on top of it — and the page
 * they serve exists so somebody can try one, see what it would do, and
 * change their mind before anything reaches Smoobu.
 *
 * So the endpoint that matters most here is preview with a config that
 * has not been saved.
 */

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

async function ownerWithProperty() {
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, base_price: 1000 });
  const agent = await getAgent();
  await loginAs(agent, owner);
  return { owner, property, agent };
}

/** A plan that prices every kind of night the same, so the strategies are
 *  the only thing moving a number. */
async function flatPlan(agent, property, price = 1000) {
  await agent.put(`/api/properties/${property.id}/rate-plan`).send({
    plan: {
      weekday: { price }, weekend: { price }, school_holiday: { price },
      public_holiday: { price }, long_weekend: { price },
    },
  }).expect(200);
}

// --- the catalogue -------------------------------------------------------

test('the catalogue describes itself, so a new algorithm needs no client change', async () => {
  const { property, agent } = await ownerWithProperty();
  const res = await agent.get(`/api/properties/${property.id}/rate-strategies`).expect(200);

  assert.deepEqual(res.body.catalogue.map((s) => s.key),
    ['orphan_gap', 'lead_time', 'pace', 'floor']);
  for (const s of res.body.catalogue) {
    assert.ok(s.label, `${s.key} has a name`);
    assert.ok(s.blurb, `${s.key} says what it does`);
    assert.ok(s.params.length > 0, `${s.key} declares its own parameters`);
  }
});

test('an unconfigured property comes back with every algorithm off and filled in', async () => {
  // Turning one on must not require setting every field first.
  const { property, agent } = await ownerWithProperty();
  const res = await agent.get(`/api/properties/${property.id}/rate-strategies`).expect(200);

  assert.equal(res.body.config.orphan_gap.enabled, false);
  assert.equal(res.body.config.orphan_gap.params.discount, 25, 'a default, not a blank');
  assert.equal(res.body.config.orphan_gap.params.max_gap, 2);
});

// --- saving --------------------------------------------------------------

test('a chosen set of algorithms is saved and read back', async () => {
  const { property, agent } = await ownerWithProperty();
  await agent.put(`/api/properties/${property.id}/rate-strategies`).send({
    config: {
      orphan_gap: { enabled: true, params: { max_gap: 3, discount: 30 } },
      lead_time: { enabled: false, params: {} },
    },
  }).expect(200);

  const res = await agent.get(`/api/properties/${property.id}/rate-strategies`).expect(200);
  assert.equal(res.body.config.orphan_gap.enabled, true);
  assert.equal(res.body.config.orphan_gap.params.max_gap, 3);
  assert.equal(res.body.config.orphan_gap.params.discount, 30);
  assert.equal(res.body.config.lead_time.enabled, false);
});

test('a number typed past its bounds is stored as the bound', async () => {
  // Clamped once, on the way in, rather than differently by every later
  // reader.
  const { property, agent } = await ownerWithProperty();
  await agent.put(`/api/properties/${property.id}/rate-strategies`).send({
    config: { orphan_gap: { enabled: true, params: { discount: 900 } } },
  }).expect(200);

  const { rows } = await pool.query(
    'SELECT params FROM rate_strategies WHERE property_id = $1 AND strategy = $2',
    [property.id, 'orphan_gap']
  );
  assert.equal(rows[0].params.discount, 60, 'the maximum, not 900');
});

test('an algorithm nobody has heard of is refused', async () => {
  const { property, agent } = await ownerWithProperty();
  const res = await agent.put(`/api/properties/${property.id}/rate-strategies`).send({
    config: { make_it_free: { enabled: true, params: {} } },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /make_it_free/);
});

// --- trying one without saving it ---------------------------------------

test('preview runs a config that has not been saved', async () => {
  // The whole point of the page: change a number, see what it does,
  // change it back, and nothing has been committed to anywhere.
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 1000);

  const from = inDays(40);
  const to = inDays(50);

  const plain = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from, to }).expect(200);
  assert.ok(plain.body.rows.every((r) => r.new_price === 1000), 'nothing switched on');

  const tried = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from, to,
      strategies: { pace: { enabled: true, params: { target: 60, max_adjust: 20 } } },
    }).expect(200);

  assert.ok(tried.body.rows.every((r) => r.new_price < 1000),
    'an empty window against a 60% target comes down');

  // And nothing was saved by looking.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM rate_strategies');
  assert.equal(rows[0].n, 0);
});

test('every night says why it costs what it costs', async () => {
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 1000);

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from: inDays(40), to: inDays(45),
      strategies: { pace: { enabled: true, params: { target: 60, max_adjust: 20 } } },
    }).expect(200);

  const row = res.body.rows[0];
  assert.equal(row.plan_price, 1000, 'what the plan said is kept beside what came out');
  assert.equal(row.trail[0].why, 'the rate plan');
  assert.match(row.trail[1].why, /booked against a 60% target/);
});

test('an orphan gap is discounted and made bookable', async () => {
  // The case the old engine could not fix: it cut the price and left the
  // minimum stay at three, so nobody could book the two nights anyway.
  const { property, agent } = await ownerWithProperty();
  await agent.put(`/api/properties/${property.id}/rate-plan`).send({
    plan: { weekday: { price: 1000, min_stay: 3 }, weekend: { price: 1000, min_stay: 3 } },
  }).expect(200);

  await seedBooking({ property, check_in: inDays(30), check_out: inDays(40) });
  await seedBooking({ property, check_in: inDays(42), check_out: inDays(50) });

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from: inDays(40), to: inDays(41),
      strategies: {
        orphan_gap: { enabled: true, params: { max_gap: 2, discount: 25, release_min_stay: true } },
      },
    }).expect(200);

  const gapNight = res.body.rows.find((r) => r.date === inDays(40));
  assert.ok(gapNight, 'the first night of the gap is priced');
  assert.equal(gapNight.new_price, 750);
  assert.equal(gapNight.new_min_stay, 2, 'short enough to actually fit the gap');
});

test('the preview totals it in money, not just in nights that moved', async () => {
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 1000);

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from: inDays(40), to: inDays(44),
      strategies: { pace: { enabled: true, params: { target: 60, max_adjust: 20 } } },
    }).expect(200);

  assert.equal(res.body.totals.plan, 5000, 'five nights at the plan price');
  assert.ok(res.body.totals.strategies < res.body.totals.plan);
  assert.equal(typeof res.body.occupancy, 'number');
});

test('booked nights are never repriced, whatever is switched on', async () => {
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 1000);
  await seedBooking({ property, check_in: inDays(40), check_out: inDays(43) });

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from: inDays(40), to: inDays(44),
      strategies: { lead_time: { enabled: true, params: { start_days: 120, max_discount: 50 } } },
    }).expect(200);

  const dates = res.body.rows.map((r) => r.date);
  assert.ok(!dates.includes(inDays(40)), 'the guest paid what they paid');
  assert.ok(!dates.includes(inDays(42)));
  assert.ok(dates.includes(inDays(43)), 'the night they leave is for sale again');
});

// --- who may touch it ----------------------------------------------------

test('another owner cannot read or change your algorithms', async () => {
  const { property } = await ownerWithProperty();
  const stranger = await seedUser({ role: 'property_manager' });
  await seedProperty({ owner: stranger });
  const agent = await getAgent();
  await loginAs(agent, stranger);

  assert.equal((await agent.get(`/api/properties/${property.id}/rate-strategies`)).status, 403);
  assert.equal((await agent.put(`/api/properties/${property.id}/rate-strategies`)
    .send({ config: { orphan_gap: { enabled: true, params: {} } } })).status, 403);
  assert.equal((await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from: todayISO(), to: inDays(3) })).status, 403);
});
