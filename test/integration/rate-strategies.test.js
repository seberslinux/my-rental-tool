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

/**
 * A plan that prices every kind of night the same.
 *
 * Every category, always — not because each is interesting, but because
 * a night with no rule for its category produces no row at all, and
 * which category a date falls into depends on live holiday data.
 *
 * That is not hypothetical. This suite priced only weekdays and weekends
 * for the orphan-gap test, which passed wherever the school-holiday
 * lookup was unavailable and failed in CI, where it succeeds: the night
 * in question is a Saturday inside a South African school break, so it
 * categorised as school_holiday, had no rule, and never appeared. The
 * test is about the gap rule; pricing everything keeps the calendar out
 * of it.
 */
async function flatPlan(agent, property, price = 1000, minStay) {
  const rule = minStay ? { price, min_stay: minStay } : { price };
  await agent.put(`/api/properties/${property.id}/rate-plan`).send({
    plan: {
      weekday: rule, weekend: rule, school_holiday: rule,
      public_holiday: rule, long_weekend: rule,
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

test('preview prices a plan that has not been saved', async () => {
  // The rates screen edits the plan, the channel percentages and the
  // rules in one place, and shows what all of it would do before any of
  // it is written. A plan that only previews once saved would mean
  // typing a number to see it, then typing it back.
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 1000);

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from: inDays(40), to: inDays(42),
      plan: {
        weekday: { price: 1500 }, weekend: { price: 1500 },
        school_holiday: { price: 1500 }, public_holiday: { price: 1500 },
        long_weekend: { price: 1500 },
      },
    }).expect(200);

  assert.ok(res.body.rows.every((r) => r.new_price === 1500), 'priced at what was sent');

  // And the saved plan is untouched by looking.
  const saved = await agent.get(`/api/properties/${property.id}/rate-plan`).expect(200);
  assert.equal(saved.body.plan.weekday.price, 1000);
});

test('a plan that would be refused on save is refused on preview too', async () => {
  // One definition of a valid plan, so a rate that cannot be stored
  // cannot quietly be priced either.
  const { property, agent } = await ownerWithProperty();
  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from: inDays(40), to: inDays(42), plan: { weekday: { price: -5 } } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /positive rate/);
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
  await flatPlan(agent, property, 1000, 3);

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

test('a gap inside a school holiday is still priced', async () => {
  /**
   * The failure CI caught and this machine could not.
   *
   * Which category a night falls into depends on live holiday data, and
   * a night whose category has no rule produces no row at all. The gap
   * test above priced only weekdays and weekends, so it passed wherever
   * the school-holiday lookup was unavailable — as it is here, where
   * egress to the API is blocked — and failed in CI, where the lookup
   * succeeds and the night in question is a Saturday inside a South
   * African school break.
   *
   * Seeding the cache reproduces that here. School holidays are read
   * cache-first, so a row is enough to make the night categorise as one
   * without the API being reachable.
   */
  await resetDb();
  const owner = await seedUser({ role: 'admin' });
  const property = await seedProperty({ owner, base_price: 1000 });
  const agent = await getAgent();
  await loginAs(agent, owner);
  await flatPlan(agent, property, 1000, 3);

  const gapStart = inDays(40);
  await pool.query(
    `INSERT INTO holidays (country, year, date, end_date, name, kind, source)
     VALUES ($1, $2, $3, $4, 'Spring break', 'school', 'test')`,
    ['ZA', Number(gapStart.slice(0, 4)), inDays(35), inDays(45)]
  );

  await seedBooking({ property, check_in: inDays(30), check_out: gapStart });
  await seedBooking({ property, check_in: inDays(42), check_out: inDays(50) });

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({
      from: gapStart, to: inDays(41),
      strategies: {
        orphan_gap: { enabled: true, params: { max_gap: 2, discount: 25, release_min_stay: true } },
      },
    }).expect(200);

  const night = res.body.rows.find((r) => r.date === gapStart);
  assert.ok(night, 'a school-holiday night is priced like any other');
  assert.equal(night.label, 'School holidays', 'and categorised as one');
  assert.equal(night.new_price, 750, 'the gap rule still applies to it');
  assert.equal(night.new_min_stay, 2);
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

// --- whose price is it ---------------------------------------------------

test('every night comes back as your rate, the guest price and what you keep', async () => {
  // Airbnb's split fee: a little off the host, a lot on top of the guest.
  // One percentage cannot say that, which is why there are two fields.
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 2000);
  await agent.put(`/api/properties/${property.id}`).send({
    commission_airbnb: 3, guest_markup_airbnb: 14,
    vat_rate: 0, vat_airbnb: 0, bank_charge_airbnb: 0,
  }).expect(200);

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from: inDays(40), to: inDays(42) }).expect(200);

  const row = res.body.rows[0];
  assert.equal(row.new_price, 2000, 'what you set, and what gets sent');
  assert.equal(row.views.channels.airbnb.guest, 2280, 'what the guest is charged');
  assert.equal(row.views.channels.airbnb.net, 1940, 'what reaches you');
});

test('the markup is a way of looking, never what gets sent', async () => {
  // Applying it to the rate pushed to Smoobu would charge the guest the
  // channel fee twice.
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 2000);
  await agent.put(`/api/properties/${property.id}`)
    .send({ guest_markup_airbnb: 14 }).expect(200);

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from: inDays(40), to: inDays(42) }).expect(200);

  assert.ok(res.body.rows.every((r) => r.new_price === 2000),
    'the rate itself is untouched by the markup');
});

test('the channels name themselves, with what each charges', async () => {
  const { property, agent } = await ownerWithProperty();
  await flatPlan(agent, property, 2000);
  await agent.put(`/api/properties/${property.id}`)
    .send({ guest_markup_airbnb: 14, commission_airbnb: 3 }).expect(200);

  const res = await agent.post(`/api/properties/${property.id}/rate-plan/preview`)
    .send({ from: inDays(40), to: inDays(42) }).expect(200);

  const airbnb = res.body.channels.find((c) => c.key === 'airbnb');
  assert.equal(airbnb.label, 'Airbnb');
  assert.equal(airbnb.markup, 14);
  assert.equal(airbnb.commission, 3);
});

// --- reading the markup off real bookings --------------------------------

test('the markup is read back from what guests were actually charged', async () => {
  // Smoobu decides what a guest pays; this only notices what it has been
  // deciding, so the field is not filled in from memory.
  const { property, agent } = await ownerWithProperty();
  const from = inDays(40);
  const nights = [inDays(40), inDays(41), inDays(42)];
  for (const d of nights) {
    await pool.query(
      'INSERT INTO daily_rates (property_id, date, price, min_stay) VALUES ($1,$2,$3,1)',
      [property.id, d, 1000]
    );
  }
  // Three nights asked at 1000; the guest paid 3420. That is +14%.
  await seedBooking({
    property, check_in: from, check_out: inDays(43),
    platform: 'Airbnb', total_price: 3420,
  });

  const res = await agent.get(`/api/properties/${property.id}/observed-markup`).expect(200);
  assert.equal(res.body.observed.airbnb.markup, 14);
  assert.equal(res.body.observed.airbnb.bookings, 1);
  assert.equal(res.body.observed.airbnb.nights, 3);
});

test('a property with no synced rates says nothing rather than zero', async () => {
  // Absent means "no idea"; zero would read as "no markup".
  const { property, agent } = await ownerWithProperty();
  const res = await agent.get(`/api/properties/${property.id}/observed-markup`).expect(200);
  assert.deepEqual(res.body.observed, {});
  assert.equal(res.body.rated_nights, 0);
});

test('observing a markup does not set it', async () => {
  // It is a suggestion on a screen. Nothing writes the field but a person.
  const { property, agent } = await ownerWithProperty();
  await pool.query(
    'INSERT INTO daily_rates (property_id, date, price, min_stay) VALUES ($1,$2,$3,1)',
    [property.id, inDays(40), 1000]
  );
  await seedBooking({
    property, check_in: inDays(40), check_out: inDays(41),
    platform: 'Airbnb', total_price: 1140,
  });

  await agent.get(`/api/properties/${property.id}/observed-markup`).expect(200);

  const { rows } = await pool.query(
    'SELECT guest_markup_airbnb FROM properties WHERE id = $1', [property.id]
  );
  assert.equal(Number(rows[0].guest_markup_airbnb), 0, 'untouched until somebody says so');
});

test('another owner cannot read what your bookings imply', async () => {
  const { property } = await ownerWithProperty();
  const stranger = await seedUser({ role: 'property_manager' });
  await seedProperty({ owner: stranger });
  const agent = await getAgent();
  await loginAs(agent, stranger);

  assert.equal((await agent.get(`/api/properties/${property.id}/observed-markup`)).status, 403);
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
