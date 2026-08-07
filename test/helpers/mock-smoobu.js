/**
 * Test-only replacement for the Smoobu HTTP client.
 *
 * Every function on `require('../../src/services/smoobu')` is stubbed to
 * either return a fixture or throw a fixture error, so integration tests can
 * exercise sync/webhook routes without any network calls.
 *
 * Usage:
 *
 *   const mock = require('../helpers/mock-smoobu');
 *
 *   test.beforeEach(() => mock.reset());
 *
 *   test('...', async () => {
 *     mock.setBookings([{ id: 1, arrival: '2025-06-10', ... }]);
 *     await request(app).post('/api/sync/bookings').expect(200);
 *   });
 *
 * Because CommonJS caches modules by resolved path, mutating the exports
 * object here affects every caller — including the route handlers.
 */

const smoobu = require('../../src/services/smoobu');

const original = { ...smoobu };

let bookingsQueue = [];   // array of pages returned in order
let propertiesFixture = [];
let propertyDetailsFixture = {};
let failWith = null;       // { name?: 'getBookings', error: Error } — throws when set

function reset() {
  bookingsQueue = [];
  propertiesFixture = [];
  propertyDetailsFixture = {};
  failWith = null;
  // Re-install stubs each reset in case a previous test replaced them.
  smoobu.getBookings = async ({ page = 1 } = {}) => {
    if (failWith && (!failWith.name || failWith.name === 'getBookings')) throw failWith.error;
    const bookings = bookingsQueue[page - 1] || [];
    return { bookings };
  };
  smoobu.getAllBookings = async () => {
    if (failWith && (!failWith.name || failWith.name === 'getAllBookings')) throw failWith.error;
    return bookingsQueue.flat();
  };
  smoobu.getBooking = async (id) => {
    if (failWith) throw failWith.error;
    return bookingsQueue.flat().find((b) => b.id === id) || null;
  };
  smoobu.getProperties = async () => {
    if (failWith && (!failWith.name || failWith.name === 'getProperties')) throw failWith.error;
    return propertiesFixture;
  };
  smoobu.getPropertyDetails = async (id) => {
    if (failWith && (!failWith.name || failWith.name === 'getPropertyDetails')) throw failWith.error;
    return propertyDetailsFixture[id] || null;
  };
  smoobu.getRates = async () => ({});
  smoobu.setRates = async () => ({ ok: true });
  smoobu.blockDates = async () => ({ id: 999999 });
  smoobu.unblockDates = async () => ({ ok: true });
  smoobu.sendGuestMessage = async () => ({ ok: true });
}

/**
 * Set the bookings the mock returns. Pass one array (single page) or an
 * array of arrays (multi-page pagination).
 */
function setBookings(pages) {
  if (pages.length === 0 || !Array.isArray(pages[0])) {
    bookingsQueue = [pages];
  } else {
    bookingsQueue = pages;
  }
}

function setProperties(apartments) {
  propertiesFixture = apartments;
}

function setPropertyDetails(map) {
  propertyDetailsFixture = map;
}

/**
 * Make the next call to `name` (or any call if no name given) throw `error`.
 * The stub throws on every subsequent call until `reset()` clears it.
 */
function makeFail(errorOrOptions, name = null) {
  if (errorOrOptions instanceof Error) {
    failWith = { name, error: errorOrOptions };
  } else {
    failWith = { name: errorOrOptions.name || null, error: errorOrOptions.error };
  }
}

function restore() {
  Object.assign(smoobu, original);
}

// Install stubs immediately so any test that forgets `beforeEach(reset)` still
// gets a mocked client rather than a real one.
reset();

module.exports = {
  reset,
  setBookings,
  setProperties,
  setPropertyDetails,
  makeFail,
  restore,
};
