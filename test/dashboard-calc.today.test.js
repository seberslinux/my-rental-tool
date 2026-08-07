const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inHouseOn,
  arrivalsOn,
  departuresOn,
  upcomingArrivals,
  upcomingDepartures,
  nextArrivalByProperty,
  activeBlockOn,
  occupiesOn,
  arrivesOn,
  departsOn,
  isCancelled,
  isBlocked,
} = require('../src/services/dashboard-calc');

// Booking factory. Defaults to a confirmed Airbnb booking on property 1.
function bk(overrides = {}) {
  return {
    id: 1,
    property_id: 1,
    check_in: '2025-06-10',
    check_out: '2025-06-13',
    platform: 'Airbnb',
    status: 'confirmed',
    guest_name: 'A',
    ...overrides,
  };
}

// --- Predicates -----------------------------------------------------------

test('isCancelled: true only for status="cancelled"', () => {
  assert.equal(isCancelled(bk()), false);
  assert.equal(isCancelled(bk({ status: 'cancelled' })), true);
  assert.equal(isCancelled(bk({ status: 'confirmed' })), false);
});

test('isBlocked: matches case-insensitive "block" substring in platform', () => {
  assert.equal(isBlocked(bk({ platform: 'Airbnb' })), false);
  assert.equal(isBlocked(bk({ platform: 'Blocked channel' })), true);
  assert.equal(isBlocked(bk({ platform: 'blocked' })), true);
  assert.equal(isBlocked(bk({ platform: null })), false);
});

test('occupiesOn: check-in day counts as occupied', () => {
  // Guest arrives on the 10th, that night they are in the property.
  assert.equal(occupiesOn(bk({ check_in: '2025-06-10', check_out: '2025-06-13' }), '2025-06-10'), true);
});

test('occupiesOn: check-out day does NOT count as occupied', () => {
  // Guest leaves on the 13th, that night the property is available.
  // (Half-open [check_in, check_out) window.)
  assert.equal(occupiesOn(bk({ check_in: '2025-06-10', check_out: '2025-06-13' }), '2025-06-13'), false);
});

test('occupiesOn: mid-stay date counts as occupied', () => {
  assert.equal(occupiesOn(bk({ check_in: '2025-06-10', check_out: '2025-06-13' }), '2025-06-11'), true);
});

test('occupiesOn: day before check-in not occupied', () => {
  assert.equal(occupiesOn(bk({ check_in: '2025-06-10', check_out: '2025-06-13' }), '2025-06-09'), false);
});

test('arrivesOn / departsOn: exact-day matches', () => {
  const b = bk({ check_in: '2025-06-10', check_out: '2025-06-13' });
  assert.equal(arrivesOn(b, '2025-06-10'), true);
  assert.equal(arrivesOn(b, '2025-06-11'), false);
  assert.equal(departsOn(b, '2025-06-13'), true);
  assert.equal(departsOn(b, '2025-06-12'), false);
});

// --- inHouseOn ------------------------------------------------------------

test('inHouseOn: returns bookings whose window covers today', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }), // in
    bk({ id: 2, check_in: '2025-06-05', check_out: '2025-06-10' }), // out (checked out on 10th)
    bk({ id: 3, check_in: '2025-06-13', check_out: '2025-06-16' }), // arriving today - actually on same-day turnover the new guest is checking in TODAY (the 13th of an earlier stay). Wait - reread: property_id defaults to 1 so different bookings on same property. Fine, we want check_in <= today < check_out.
  ];
  // On 2025-06-11: booking 1 is mid-stay (in), booking 2 already left, booking 3 not arrived
  const result = inHouseOn(bookings, '2025-06-11');
  assert.deepEqual(result.map(b => b.id), [1]);
});

test('inHouseOn: on check-in day, guest counts as in-house', () => {
  const bookings = [bk({ id: 1, check_in: '2025-06-11', check_out: '2025-06-15' })];
  assert.deepEqual(inHouseOn(bookings, '2025-06-11').map(b => b.id), [1]);
});

test('inHouseOn: on check-out day, guest is NOT in-house', () => {
  const bookings = [bk({ id: 1, check_in: '2025-06-05', check_out: '2025-06-11' })];
  assert.deepEqual(inHouseOn(bookings, '2025-06-11').map(b => b.id), []);
});

test('inHouseOn: excludes cancelled bookings', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-05', check_out: '2025-06-15' }),
    bk({ id: 2, check_in: '2025-06-05', check_out: '2025-06-15', status: 'cancelled' }),
  ];
  assert.deepEqual(inHouseOn(bookings, '2025-06-10').map(b => b.id), [1]);
});

test('inHouseOn: excludes blocked bookings (owner blocks are not guests)', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-05', check_out: '2025-06-15' }),
    bk({ id: 2, check_in: '2025-06-05', check_out: '2025-06-15', platform: 'Blocked channel' }),
  ];
  assert.deepEqual(inHouseOn(bookings, '2025-06-10').map(b => b.id), [1]);
});

test('inHouseOn: empty input returns empty', () => {
  assert.deepEqual(inHouseOn([], '2025-06-10'), []);
});

// --- arrivalsOn / departuresOn -------------------------------------------

test('arrivalsOn: returns only bookings with check_in === today', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }), // arrival
    bk({ id: 2, check_in: '2025-06-09', check_out: '2025-06-13' }), // yesterday
    bk({ id: 3, check_in: '2025-06-11', check_out: '2025-06-14' }), // tomorrow
  ];
  assert.deepEqual(arrivalsOn(bookings, '2025-06-10').map(b => b.id), [1]);
});

test('arrivalsOn: excludes cancelled and blocked', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-10', check_out: '2025-06-13' }),
    bk({ id: 2, check_in: '2025-06-10', check_out: '2025-06-13', status: 'cancelled' }),
    bk({ id: 3, check_in: '2025-06-10', check_out: '2025-06-13', platform: 'Blocked' }),
  ];
  assert.deepEqual(arrivalsOn(bookings, '2025-06-10').map(b => b.id), [1]);
});

test('departuresOn: returns only bookings with check_out === today', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-05', check_out: '2025-06-10' }), // leaving today
    bk({ id: 2, check_in: '2025-06-05', check_out: '2025-06-11' }), // leaves tomorrow
    bk({ id: 3, check_in: '2025-06-05', check_out: '2025-06-09' }), // left yesterday
  ];
  assert.deepEqual(departuresOn(bookings, '2025-06-10').map(b => b.id), [1]);
});

test('same-day turnover: guest A departing and guest B arriving on the same day', () => {
  // Regression guard: this is the most common source of dashboard bugs —
  // one departure and one arrival on the same date must both appear.
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-05', check_out: '2025-06-10', guest_name: 'A' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-10', check_out: '2025-06-15', guest_name: 'B' }),
  ];
  assert.deepEqual(departuresOn(bookings, '2025-06-10').map(b => b.id), [1]);
  assert.deepEqual(arrivalsOn(bookings, '2025-06-10').map(b => b.id), [2]);
  // At any instant on the 10th, no one is "in-house" per the half-open window.
  // (Real handover happens at a specific time; the dashboard shows the arrival
  // as the current occupant from that moment.)
  assert.deepEqual(inHouseOn(bookings, '2025-06-10').map(b => b.id), [2]);
});

// --- upcomingArrivals / upcomingDepartures --------------------------------

test('upcomingArrivals: rolling 7-day window includes today', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-10' }),   // today
    bk({ id: 2, check_in: '2025-06-13' }),   // in 3 days
    bk({ id: 3, check_in: '2025-06-16' }),   // in 6 days (edge of 7-day window)
    bk({ id: 4, check_in: '2025-06-17' }),   // in 7 days (just past)
    bk({ id: 5, check_in: '2025-06-09' }),   // yesterday
  ];
  const out = upcomingArrivals(bookings, '2025-06-10', 7);
  assert.deepEqual(out.map(b => b.id), [1, 2, 3]);
});

test('upcomingArrivals: results are sorted by check_in ascending', () => {
  const bookings = [
    bk({ id: 1, check_in: '2025-06-15' }),
    bk({ id: 2, check_in: '2025-06-11' }),
    bk({ id: 3, check_in: '2025-06-13' }),
  ];
  const out = upcomingArrivals(bookings, '2025-06-10', 7);
  assert.deepEqual(out.map(b => b.id), [2, 3, 1]);
});

test('upcomingDepartures: rolling 7-day window includes today', () => {
  const bookings = [
    bk({ id: 1, check_out: '2025-06-10' }),
    bk({ id: 2, check_out: '2025-06-16' }),
    bk({ id: 3, check_out: '2025-06-17' }),  // past window
    bk({ id: 4, check_out: '2025-06-09' }),  // yesterday
  ];
  const out = upcomingDepartures(bookings, '2025-06-10', 7);
  assert.deepEqual(out.map(b => b.id), [1, 2]);
});

// --- nextArrivalByProperty ------------------------------------------------

test('nextArrivalByProperty: returns first strictly-future arrival per property', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-15' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-20' }),
    bk({ id: 3, property_id: 2, check_in: '2025-06-12' }),
    bk({ id: 4, property_id: 2, check_in: '2025-06-25' }),
  ];
  const map = nextArrivalByProperty(bookings, '2025-06-10');
  assert.equal(map.get(1).id, 1);
  assert.equal(map.get(2).id, 3);
});

test('nextArrivalByProperty: STRICTLY after today (today itself excluded)', () => {
  // Property 1 has a booking arriving today, property 2 has one tomorrow.
  // "Next arrival" is what comes after today's activity — a same-day arrival
  // shows up in `arrivalsOn`, not `nextArrivalByProperty`.
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-10' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-14' }),
    bk({ id: 3, property_id: 2, check_in: '2025-06-11' }),
  ];
  const map = nextArrivalByProperty(bookings, '2025-06-10');
  assert.equal(map.get(1).id, 2);
  assert.equal(map.get(2).id, 3);
});

test('nextArrivalByProperty: property with no future arrival is omitted', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-05-01' }), // in the past
  ];
  const map = nextArrivalByProperty(bookings, '2025-06-10');
  assert.equal(map.has(1), false);
  assert.equal(map.size, 0);
});

test('nextArrivalByProperty: excludes cancelled and blocked', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-15', status: 'cancelled' }),
    bk({ id: 2, property_id: 1, check_in: '2025-06-20' }),
    bk({ id: 3, property_id: 2, check_in: '2025-06-14', platform: 'Blocked channel' }),
  ];
  const map = nextArrivalByProperty(bookings, '2025-06-10');
  assert.equal(map.get(1).id, 2);
  assert.equal(map.has(2), false);
});

// --- activeBlockOn --------------------------------------------------------

test('activeBlockOn: returns the block covering today, or null', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-05', check_out: '2025-06-15', platform: 'Blocked channel' }),
    bk({ id: 2, property_id: 2, check_in: '2025-06-05', check_out: '2025-06-15', platform: 'Airbnb' }),
  ];
  assert.equal(activeBlockOn(bookings, 1, '2025-06-10').id, 1);
  assert.equal(activeBlockOn(bookings, 2, '2025-06-10'), null); // real booking, not a block
});

test('activeBlockOn: on the block\'s check-out day, block is no longer active', () => {
  const bookings = [
    bk({ id: 1, property_id: 1, check_in: '2025-06-05', check_out: '2025-06-10', platform: 'Blocked' }),
  ];
  assert.equal(activeBlockOn(bookings, 1, '2025-06-10'), null);
});
