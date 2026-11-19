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
