const test = require('node:test');
const assert = require('node:assert/strict');
const { calcDeductions } = require('../src/services/analytics-calc');

// Base booking; individual tests override only the fields they care about.
function b(overrides = {}) {
  return {
    converted_total_price: 1000,
    platform: '',
    prop_commission_airbnb: 0, bank_charge_airbnb: 0, vat_airbnb: 0,
    prop_commission_booking: 0, bank_charge_booking: 0, vat_booking: 0,
    prop_commission_vrbo: 0, bank_charge_vrbo: 0, vat_vrbo: 0,
    property_vat_rate: 0,
    converted_commission: 0,
    ...overrides,
  };
}

// A Direct booking must incur no deductions. Each of the tests below pins a
// distinct short-circuit that could plausibly break: if any of these paths
// ran instead of returning 0, real revenue would be quietly subtracted from
// direct sales.

test('direct booking: property commission rate is ignored', () => {
  // Would fail if the direct short-circuit ran after the commission calc.
  // Applied: 1000 × 15% = 150.
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      prop_commission_airbnb: 15,
    })),
    0
  );
});

test('direct booking: property bank charge is ignored', () => {
  // Would fail if bank calc ran before the direct check.
  // Applied: 1000 × 2% = 20.
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      bank_charge_airbnb: 2,
    })),
    0
  );
});

test('direct booking: per-platform VAT is ignored', () => {
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      vat_airbnb: 15,
    })),
    0
  );
});

test('direct booking: legacy property_vat_rate is ignored', () => {
  // Would fail if the legacy-VAT fallback bypassed the direct check.
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      property_vat_rate: 15,
    })),
    0
  );
});

test('direct booking: Smoobu-reported commission is ignored', () => {
  // Regression guard. Smoobu can report a commission on rows the owner
  // reclassified as direct; the direct short-circuit must run before the
  // `converted_commission` fallback.
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      converted_commission: 75, // would be returned if the fallback path ran
    })),
    0
  );
});

test('direct booking: all deductions inputs stacked → still 0', () => {
  // Belt-and-braces: every input that could cause a nonzero result is
  // present, and the answer must still be 0.
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      prop_commission_airbnb: 15,
      bank_charge_airbnb: 2,
      vat_airbnb: 15,
      property_vat_rate: 15,
      converted_commission: 75,
    })),
    0
  );
});

test('direct booking: recognized across common casings and phrasings', () => {
  // Would fail on a case-sensitive check or a stricter comparison like
  // `platform === 'direct'`.
  for (const p of ['Direct', 'direct', 'DIRECT', 'Direct booking', 'direct-booking']) {
    assert.equal(
      calcDeductions(b({ platform: p, prop_commission_airbnb: 15 })),
      0,
      `expected 0 for platform="${p}"`
    );
  }
});

test('unknown platform with no rates returns 0', () => {
  assert.equal(calcDeductions(b({ platform: 'Something else' })), 0);
});

test('airbnb: commission only (no bank, no VAT)', () => {
  // 1000 * 15% = 150
  assert.equal(
    calcDeductions(b({ platform: 'Airbnb', prop_commission_airbnb: 15 })),
    150
  );
});

test('airbnb: commission + bank + VAT stack correctly', () => {
  // rev=1000, comm=150, bank=20, vat = (150+20) * 15% = 25.5
  // total = 150 + 20 + 25.5 = 195.5
  assert.equal(
    calcDeductions(b({
      platform: 'Airbnb',
      prop_commission_airbnb: 15,
      bank_charge_airbnb: 2,
      vat_airbnb: 15,
    })),
    195.5
  );
});

test('booking.com uses booking-platform rates (not airbnb)', () => {
  assert.equal(
    calcDeductions(b({
      platform: 'Booking.com',
      prop_commission_airbnb: 99, // must be ignored
      prop_commission_booking: 12,
    })),
    120
  );
});

test('vrbo uses vrbo-platform rates', () => {
  assert.equal(
    calcDeductions(b({
      platform: 'VRBO',
      prop_commission_vrbo: 8,
    })),
    80
  );
});

test('VAT falls back to legacy property_vat_rate when per-platform VAT is 0', () => {
  // comm=150, bank=0, vat=150 * 15% = 22.5, total = 172.5
  assert.equal(
    calcDeductions(b({
      platform: 'Airbnb',
      prop_commission_airbnb: 15,
      vat_airbnb: 0,
      property_vat_rate: 15,
    })),
    172.5
  );
});

test('per-platform VAT wins over legacy property_vat_rate', () => {
  // comm=150, vat = 150 * 10% = 15, total = 165 (not the 22.5 from legacy 15%)
  assert.equal(
    calcDeductions(b({
      platform: 'Airbnb',
      prop_commission_airbnb: 15,
      vat_airbnb: 10,
      property_vat_rate: 15,
    })),
    165
  );
});

test('falls back to Smoobu-reported commission when no property commission set', () => {
  // No prop_commission_airbnb → use converted_commission (75). No VAT config.
  assert.equal(
    calcDeductions(b({
      platform: 'Airbnb',
      prop_commission_airbnb: 0,
      converted_commission: 75,
    })),
    75
  );
});

test('property commission wins over Smoobu commission fallback when both are present', () => {
  assert.equal(
    calcDeductions(b({
      platform: 'Airbnb',
      prop_commission_airbnb: 15, // 150
      converted_commission: 999,  // ignored
    })),
    150
  );
});

test('zero-revenue booking with rates returns 0', () => {
  assert.equal(
    calcDeductions(b({
      converted_total_price: 0,
      platform: 'Airbnb',
      prop_commission_airbnb: 15,
      bank_charge_airbnb: 2,
      vat_airbnb: 15,
    })),
    0
  );
});

test('missing converted_total_price treated as 0', () => {
  const booking = b({ platform: 'Airbnb', prop_commission_airbnb: 15 });
  delete booking.converted_total_price;
  assert.equal(calcDeductions(booking), 0);
});

test('platform matching is case-insensitive', () => {
  assert.equal(
    calcDeductions(b({ platform: 'AIRBNB', prop_commission_airbnb: 10 })),
    100
  );
});

test('"Direct booking" is treated as direct even though string contains "booking"', () => {
  // Regression guard: naive substring order would match "booking" first.
  assert.equal(
    calcDeductions(b({
      platform: 'Direct booking',
      prop_commission_booking: 20,
    })),
    0
  );
});
