const test = require('node:test');
const assert = require('node:assert/strict');
const { totals, legacyColumns, vatOn } = require('../src/services/channel-fees');
const { calcDeductions } = require('../src/services/analytics-calc');

/**
 * The channel fee table: total fees is the sum, total markup is
 * 1 / (1 − total fees) − 1, and saving it makes analytics deduct exactly
 * the table's total.
 */

const TABLE = [
  ['Airbnb', 'airbnb', { commission: 15, vat_on_commission: 2.25, bank_charges: 0 }, 17.25, 20.85],
  ['Booking.com at 18%', 'booking', { commission: 18, vat_on_commission: 2.7, bank_charges: 2.42 }, 23.12, 30.07],
  ['Booking.com at 15%', 'booking', { commission: 15, vat_on_commission: 2.25, bank_charges: 2.42 }, 19.67, 24.49],
];

for (const [name, , row, fees, markup] of TABLE) {
  test(`${name}: total fees ${fees}%, total markup ${markup}%`, () => {
    assert.deepEqual(totals(row), { total_fees: fees, total_markup: markup });
  });
}

for (const [name, channel, row, fees] of TABLE) {
  test(`${name}: analytics deducts exactly the table's total`, () => {
    const l = legacyColumns(row, 15);
    const b = {
      converted_total_price: 10000, platform: channel === 'airbnb' ? 'Airbnb' : 'Booking.com',
      [`prop_commission_${channel}`]: l.commission, [`bank_charge_${channel}`]: l.bank, [`vat_${channel}`]: l.vat,
      property_vat_rate: 15, converted_commission: 9999,
    };
    assert.ok(Math.abs(calcDeductions(b) - 10000 * fees / 100) < 0.5, `${calcDeductions(b)} vs ${10000 * fees / 100}`);
  });
}

test('VAT on commission is 15% of the commission', () => {
  assert.equal(vatOn(15, 15), 2.25);
  assert.equal(vatOn(18, 15), 2.7);
});
