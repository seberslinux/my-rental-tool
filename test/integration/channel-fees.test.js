const test = require('node:test');
const assert = require('node:assert/strict');
const { getApp, getAgent, resetDb, closePool } = require('../helpers/harness');
const { seedUser, seedProperty, loginAs } = require('../helpers/seed');
const { pool } = require('../../src/db/database');

test.before(() => getApp());
test.beforeEach(() => resetDb());
test.after(() => closePool());

test('the fee table saves, totals itself, and becomes what analytics deducts', async () => {
  const admin = await seedUser({ role: 'admin' });
  const lodge = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  await pool.query('UPDATE properties SET guest_markup_airbnb = 20.5, guest_markup_booking = 25 WHERE id = $1', [lodge.id]);
  const agent = await getAgent();
  await loginAs(agent, admin);

  const { body } = await agent.put(`/api/properties/${lodge.id}/channel-fees`).send({ channels: [
    { channel: 'airbnb', commission: 15, bank_charges: 0 },
    { channel: 'booking', commission: 18, bank_charges: 2.42 },
  ] }).expect(200);
  const by = Object.fromEntries(body.channels.map((c) => [c.channel, c]));
  assert.equal(by.airbnb.vat_on_commission, 2.25, '15% VAT on the commission');
  assert.equal(by.airbnb.total_fees, 17.25);
  assert.equal(by.airbnb.total_markup, 20.85);
  assert.equal(by.booking.total_fees, 23.12);
  assert.equal(by.booking.total_markup, 30.07);
  assert.equal(by.booking.smoobu_markup, 25);
  assert.equal(by.booking.payout, Math.round(1.25 * (1 - 0.2312) * 10000) / 10000, 'per rand of base at today\'s markup');
  assert.equal(by.vrbo.total_fees, null, 'a channel not filled in stays empty');

  const p = (await pool.query('SELECT commission_booking, vat_booking, bank_charge_booking FROM properties WHERE id = $1', [lodge.id])).rows[0];
  assert.equal(Number(p.commission_booking), 18);
  assert.ok(Math.abs(Number(p.vat_booking) - 15) < 1e-6);
  assert.ok(Math.abs(Number(p.bank_charge_booking) - 2.42 / 1.15) < 1e-4);

  await agent.put(`/api/properties/${lodge.id}/channel-fees`).send({ channels: [{ channel: 'airbnb', commission: 70 }] }).expect(400);
  await agent.put(`/api/properties/${lodge.id}/channel-fees`).send({ channels: [{ channel: 'expedia', commission: 15 }] }).expect(400);
});

test('each booking takes the fees in force on the day it was made', async () => {
  const { BOOKING_FEE_SQL } = require('../../src/services/channel-fees');
  const { daysAgo, todayISO, inDays } = require('../helpers/dates');
  const admin = await seedUser({ role: 'admin' });
  const lodge = await seedProperty({ owner: admin, name: 'Hill Top Lodge' });
  await pool.query('UPDATE properties SET vat_rate = 15 WHERE id = $1', [lodge.id]);
  const agent = await getAgent();
  await loginAs(agent, admin);
  // 15% from the start; 18% from ten days ago.
  await agent.put(`/api/properties/${lodge.id}/channel-fees`).send({ channels: [
    { channel: 'booking', commission: 15, bank_charges: 2.42 },
    { channel: 'booking', valid_from: daysAgo(10), commission: 18, bank_charges: 2.42 },
  ] }).expect(200);
  const book = (id, made) => pool.query(
    `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status,
                           num_guests, length_of_stay, price_per_night, currency, lead_time_days, created_at)
     VALUES ($1, $2, 'Guest', $3, $4, 'Booking.com', 10000, 'confirmed', 2, 2, 5000, 'ZAR', 30, $5)`,
    [id, lodge.id, inDays(30), inDays(32), made]
  );
  await book(770001, daysAgo(40));
  await book(770002, daysAgo(10));
  await book(770003, todayISO());
  const { rows } = await pool.query(
    `SELECT b.smoobu_id, ${BOOKING_FEE_SQL} FROM bookings b JOIN properties p ON p.id = b.property_id ORDER BY b.smoobu_id`
  );
  const fee = Object.fromEntries(rows.map((r) => [r.smoobu_id, Math.round(Number(r.fee_total_pct) * 100) / 100]));
  assert.equal(fee[770001], 19.67, 'made before the change: 15% + VAT + 2.42%');
  assert.equal(fee[770002], 23.12, 'made on the day of the change: 18% + VAT + 2.42%');
  assert.equal(fee[770003], 23.12);

  const { body } = await agent.get(`/api/properties/${lodge.id}/channel-fees`).expect(200);
  const booking = body.channels.find((c) => c.channel === 'booking');
  assert.equal(booking.commission, 18, 'the row in force today');
  assert.equal(booking.valid_from, daysAgo(10));
  assert.deepEqual(booking.history.map((h) => [h.valid_from, h.commission]), [[daysAgo(10), 18], [null, 15]]);
  const p = (await pool.query('SELECT commission_booking FROM properties WHERE id = $1', [lodge.id])).rows[0];
  assert.equal(Number(p.commission_booking), 18, 'the property columns follow the row in force today');

  // Removing the dated row brings the old one back, for every booking.
  await agent.delete(`/api/properties/${lodge.id}/channel-fees/booking/${daysAgo(10)}`).expect(200);
  const again = await pool.query(`SELECT b.smoobu_id, ${BOOKING_FEE_SQL} FROM bookings b JOIN properties p ON p.id = b.property_id WHERE b.smoobu_id = 770003`);
  assert.equal(Math.round(Number(again.rows[0].fee_total_pct) * 100) / 100, 19.67);
});
