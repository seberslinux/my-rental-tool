const test = require('node:test');
const assert = require('node:assert/strict');
const { feeFrom, windows } = require('../src/services/peer-cleaning');

/**
 * Measuring a cleaning fee from three all-in quotes: two back-to-back
 * stays carry it twice, the same nights as one stay once.
 */

test('the fee is what two short stays cost over one long one', () => {
  assert.deepEqual(feeFrom(6444, 6444, 11988), { fee: 900, note: null });
  assert.deepEqual(feeFrom(8700, 9000, 17700), { fee: 0, note: null }, 'no cleaning fee');
  assert.deepEqual(feeFrom(5000, 5000, 10020), { fee: 0, note: null }, 'a few rand of rounding is nothing');
});

test('a result that cannot be a cleaning fee is refused, with the reason', () => {
  assert.equal(feeFrom(101156, 72129, 87301).fee, null, 'monthly discount, not cleaning');
  assert.equal(feeFrom(5000, 5000, 10500).fee, null, 'the long stay dearer');
  assert.equal(feeFrom(null, 7300, 14300).fee, null, 'a quote missing');
  assert.match(feeFrom(null, 7300, 14300).note, /empty/);
});

test('a window is four open nights (twice the minimum stay), a week ahead or more', () => {
  const day = (i, available = true, min = 2) => ({ date: `2027-01-${String(i).padStart(2, '0')}`, available, min_nights: min });
  const cal = [day(1), day(2), day(3, false), day(4), day(5), day(6), day(7), day(8), day(9), day(10)];
  assert.deepEqual(windows(cal, '2027-01-01', 1), [{ checkIn: '2027-01-04', nights: 2 }], 'skips the taken 3rd');
  const longMin = cal.map((c) => ({ ...c, available: true, min_nights: 3 }));
  assert.deepEqual(windows(longMin, '2027-01-01', 1), [{ checkIn: '2027-01-01', nights: 3 }], 'three and three when the minimum is three');
  const monthly = cal.map((c) => ({ ...c, available: true, min_nights: 30 }));
  assert.deepEqual(windows(monthly, '2027-01-01'), [], 'never with a monthly minimum');
  const four = cal.map((c) => ({ ...c, available: true, min_nights: 4 }));
  assert.deepEqual(windows(four, '2027-01-01'), [], 'nor four and four: eight nights earns a weekly discount');
});
