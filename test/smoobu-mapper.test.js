const test = require('node:test');
const assert = require('node:assert/strict');
const { mapSmoobuBooking, countryFromPhone } = require('../src/services/smoobu-mapper');

/**
 * Smoobu payload → bookings row.
 *
 * Smoobu's data is correct; everything that went wrong went wrong on the
 * way in. Three write paths each carried their own column list and drifted,
 * and because the routine sync deletes and re-inserts its window, a field
 * one path forgot was actively erased from rows another had filled.
 *
 * These tests pin the mapping so that can't recur silently.
 */

// A full payload in Smoobu's kebab-case dialect, shaped like a real one.
const KEBAB = {
  id: 150611526,
  'reference-id': '5075623517',
  type: 'reservation',
  arrival: '2026-08-08',
  departure: '2026-08-10',
  'created-at': '2026-08-07 13:30',
  'modified-at': '2026-08-07 13:30:25',
  apartment: { id: 2500823, name: 'Hill Top Lodge' },
  channel: { id: 3697514, channel_id: 14, name: 'Booking.com' },
  'guest-name': 'Siba Daki',
  email: 'sdaki.847237@guest.booking.com',
  phone: '+27 73 394 0102',
  adults: 2,
  children: 2,
  'check-in': '15:00',
  'check-out': '10:00',
  price: 5158.24,
  'price-details': 'Cleaning fee - ZAR 600',
  'commission-included': 773.74,
  language: 'en',
};

// --- field mapping -------------------------------------------------------

test('kebab-case payload maps every column', () => {
  const r = mapSmoobuBooking(KEBAB);
  assert.equal(r.smoobu_id, 150611526);
  assert.equal(r.apartment_smoobu_id, 2500823);
  assert.equal(r.guest_name, 'Siba Daki');
  assert.equal(r.check_in, '2026-08-08');
  assert.equal(r.check_out, '2026-08-10');
  assert.equal(r.platform, 'Booking.com');
  assert.equal(r.total_price, 5158.24);
  assert.equal(r.status, 'confirmed');
  assert.equal(r.length_of_stay, 2);
  assert.equal(r.price_per_night, 2579.12);
  assert.equal(r.currency, 'ZAR');
  assert.equal(r.commission, 773.74);
  assert.equal(r.language, 'en');
  assert.equal(r.guest_country, 'South Africa');
});

test('camelCase payload maps to the same columns', () => {
  const r = mapSmoobuBooking({
    id: 1, apartmentId: 42, guestName: 'Bob', arrivalDate: '2026-03-01',
    departureDate: '2026-03-05', channel: 'Airbnb', price: 4000, adults: 2,
    createdAt: '2026-02-01', modifiedAt: '2026-02-02 10:00',
    commissionIncluded: 500, guestPhone: '+49 30 123456',
  });
  assert.equal(r.apartment_smoobu_id, 42);
  assert.equal(r.guest_name, 'Bob');
  assert.equal(r.check_in, '2026-03-01');
  assert.equal(r.platform, 'Airbnb');
  assert.equal(r.commission, 500);
  assert.equal(r.guest_country, 'Germany');
});

// --- the fields that were being dropped ---------------------------------

test('adults and children stay separate — a party of four is not recorded as two', () => {
  const r = mapSmoobuBooking(KEBAB);
  assert.equal(r.num_guests, 2, 'num_guests holds adults');
  assert.equal(r.children, 2);
});

test('commission is carried through — it is already inside total_price', () => {
  const r = mapSmoobuBooking(KEBAB);
  assert.equal(r.total_price, 5158.24, 'gross is what the guest paid');
  assert.equal(r.commission, 773.74, 'what the channel keeps');
});

test('language and guest_country survive — both were silently lost', () => {
  const r = mapSmoobuBooking(KEBAB);
  assert.equal(r.language, 'en');
  assert.equal(r.guest_country, 'South Africa');
});

// --- record everything ---------------------------------------------------

test('the entire payload is retained verbatim', () => {
  // Smoobu serves a limited window, so a field not captured now cannot be
  // fetched later. Anything unmapped must still be recoverable from here.
  const r = mapSmoobuBooking(KEBAB);
  assert.deepEqual(r.raw_payload, KEBAB);
});

test('unmapped fields are recoverable from the raw payload', () => {
  const r = mapSmoobuBooking(KEBAB);
  // None of these have columns today; all are worth having later.
  assert.equal(r.raw_payload['reference-id'], '5075623517');
  assert.equal(r.raw_payload.email, 'sdaki.847237@guest.booking.com');
  assert.equal(r.raw_payload['check-in'], '15:00', 'guest arrival time');
  assert.equal(r.raw_payload.channel.channel_id, 14);
});

// --- derived values ------------------------------------------------------

test('length_of_stay floors at 1 so the nightly rate never divides by zero', () => {
  const r = mapSmoobuBooking({ id: 1, arrival: '2026-03-01', departure: '2026-03-01', price: 500 });
  assert.equal(r.length_of_stay, 1);
  assert.equal(r.price_per_night, 500);
});

test('price_per_night rounds to two decimals', () => {
  const r = mapSmoobuBooking({ id: 1, arrival: '2026-03-01', departure: '2026-03-04', price: 1000 });
  assert.equal(r.price_per_night, 333.33);
});

test('lead_time_days clamps at 0 for a booking made after arrival', () => {
  const r = mapSmoobuBooking({
    id: 1, arrival: '2026-03-01', departure: '2026-03-04', 'created-at': '2026-03-10',
  });
  assert.equal(r.lead_time_days, 0);
});

test('a cancellation payload maps to cancelled status', () => {
  const r = mapSmoobuBooking({ ...KEBAB, type: 'cancellation' });
  assert.equal(r.status, 'cancelled');
});

test('currency falls back to the property default, then ZAR', () => {
  const noCurrency = { id: 1, apartment: { id: 7 }, arrival: '2026-03-01', departure: '2026-03-02' };
  assert.equal(
    mapSmoobuBooking(noCurrency, { propertyCurrencyBySmoobuId: { 7: 'EUR' } }).currency,
    'EUR'
  );
  assert.equal(mapSmoobuBooking(noCurrency).currency, 'ZAR');
});

test('missing fields get defaults rather than null', () => {
  const r = mapSmoobuBooking({ id: 1, arrival: '2026-03-01', departure: '2026-03-02' });
  assert.equal(r.guest_name, '');
  assert.equal(r.platform, '');
  assert.equal(r.total_price, 0);
  assert.equal(r.num_guests, 1);
  assert.equal(r.children, 0);
  assert.equal(r.commission, 0);
  assert.equal(r.language, '');
  assert.equal(r.guest_country, '');
});

// --- countryFromPhone ----------------------------------------------------

test('countryFromPhone matches the longest dialling code first', () => {
  // '27' must not shadow '271'-style longer codes.
  assert.equal(countryFromPhone('+27 73 394 0102'), 'South Africa');
  assert.equal(countryFromPhone('+351 21 000 0000'), 'Portugal');
  assert.equal(countryFromPhone('+1 415 555 0100'), 'United States');
});

test('countryFromPhone ignores formatting', () => {
  assert.equal(countryFromPhone('+49 (30) 123-456'), 'Germany');
});

test('countryFromPhone returns empty for missing or non-international numbers', () => {
  assert.equal(countryFromPhone(''), '');
  assert.equal(countryFromPhone(null), '');
  assert.equal(countryFromPhone('073 394 0102'), '', 'no + prefix means no country');
  assert.equal(countryFromPhone('+999 000'), '', 'unknown code');
});
