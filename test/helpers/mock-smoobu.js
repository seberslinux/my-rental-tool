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
// { [apartmentId]: { 'YYYY-MM-DD': { price, available } } } — what getRates answers.
let dailyRatesFixture = {};
// Guest conversations: { [bookingId]: [{ id, type, message, messageHtml, subject }] },
// and the thread list Smoobu would return.
let messagesFixture = {};
let threadsFixture = [];

// Every mocked side-effectful call is appended here so tests can assert on
// what was invoked. Reset per test via `mockSmoobu.reset()`.
const calls = {
  setRates: [],
  setRatesForDates: [],
  blockDates: [],
  unblockDates: [],
  sendGuestMessage: [],
  sendMessageToGuest: [],
};

function reset() {
  bookingsQueue = [];
  propertiesFixture = [];
  propertyDetailsFixture = {};
  dailyRatesFixture = {};
  messagesFixture = {};
  threadsFixture = [];
  failWith = null;
  calls.setRates.length = 0;
  calls.setRatesForDates.length = 0;
  calls.blockDates.length = 0;
  calls.unblockDates.length = 0;
  calls.sendGuestMessage.length = 0;
  calls.sendMessageToGuest.length = 0;
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
  smoobu.getRates = async (apartmentId) => {
    if (failWith && (!failWith.name || failWith.name === 'getRates')) throw failWith.error;
    // Nested under `data`, which is the shape the real client returns for
    // this endpoint. A fixture keyed at the top level would let a reader
    // that only handles one shape pass.
    return { data: { [apartmentId]: dailyRatesFixture[apartmentId] || {} } };
  };
  smoobu.setRatesForDates = async (apartmentId, dates, price, apiKey, minStay = null) => {
    calls.setRatesForDates.push({ apartmentId, dates, price, minStay });
    return { ok: true };
  };

  smoobu.setRates = async (apartmentId, from, to, price) => {
    calls.setRates.push({ apartmentId, from, to, price });
    return { ok: true };
  };
  smoobu.blockDates = async (apartmentId, from, to, note) => {
    calls.blockDates.push({ apartmentId, from, to, note });
    return { id: 999999 };
  };
  smoobu.unblockDates = async (reservationId) => {
    calls.unblockDates.push({ reservationId });
    return { ok: true };
  };
  smoobu.getThreads = async ({ apartments = [] } = {}) => {
    if (failWith && (!failWith.name || failWith.name === 'getThreads')) throw failWith.error;
    const wanted = new Set(apartments.map(String));
    const threads = threadsFixture.filter((t) => !wanted.size || wanted.has(String(t.apartment.id)));
    return { page_number: 1, page_count: 1, total_threads: threads.length, threads };
  };
  smoobu.getMessages = async (reservationId) => {
    if (failWith && (!failWith.name || failWith.name === 'getMessages')) throw failWith.error;
    const messages = messagesFixture[reservationId] || [];
    return { page: 1, page_count: 1, total_items: messages.length, messages };
  };
  smoobu.sendMessageToGuest = async (reservationId, { subject = '', messageBody }) => {
    if (failWith && (!failWith.name || failWith.name === 'sendMessageToGuest')) throw failWith.error;
    calls.sendMessageToGuest.push({ reservationId, subject, messageBody });
    // What Smoobu would now hold: the reply on the end of the thread.
    const list = messagesFixture[reservationId] || (messagesFixture[reservationId] = []);
    const nextId = list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    list.push({ id: nextId, type: 2, subject, message: messageBody, messageHtml: '' });
    return { status: 201, title: 'Resource created successfully', detail: '' };
  };
  smoobu.sendGuestMessage = async (reservationId, subject, messageBody) => {
    calls.sendGuestMessage.push({ reservationId, subject, messageBody });
    return { ok: true };
  };
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

/**
 * What getRates answers, per apartment: `{ apartmentId: { date: {price} } }`.
 *
 * Separate from `calls.setRates`, which records writes. This is the read
 * side — the nightly rates Smoobu holds — and the two were easy to
 * confuse by name alone.
 */
function setDailyRates(map) {
  dailyRatesFixture = map || {};
}

/** A booking's conversation, as getMessages answers it. */
function setMessages(map) {
  messagesFixture = map || {};
}

/** The inbox, as getThreads answers it. */
function setThreads(list) {
  threadsFixture = list || [];
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
  setDailyRates,
  setMessages,
  setThreads,
  setProperties,
  setPropertyDetails,
  makeFail,
  restore,
  calls,
};
