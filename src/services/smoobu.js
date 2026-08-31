const axios = require('axios');
const { sign } = require('./smoobu-auth');

const BASE_URL = 'https://login.smoobu.com/api';

/**
 * A Smoobu client that signs what it sends.
 *
 * Every call in this app is built here, which is the only reason the
 * move off the `Api-Key` header is a small change: one function, one
 * interceptor, and the twenty call sites are untouched.
 *
 * With a secret configured each request is signed (see smoobu-auth).
 * Without one it falls back to the legacy header, so a deployment that
 * has not been given the new credentials keeps working until 25
 * September rather than failing the moment this ships.
 */
function getClient(apiKey) {
  const key = apiKey || process.env.SMOOBU_API_KEY;
  if (!key) throw new Error('No Smoobu API key available');
  const secret = process.env.SMOOBU_API_SECRET;

  const client = axios.create({
    baseURL: BASE_URL,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!secret) {
    client.defaults.headers['Api-Key'] = key;
    return client;
  }

  client.interceptors.request.use((config) => {
    // The path as the server sees it, which includes the /api prefix
    // baseURL carries — sign what is sent, not what was typed here.
    const path = `/api${config.url}`;
    const { headers } = sign({
      method: config.method,
      path,
      params: config.params,
      body: config.data,
      key,
      secret,
    });
    Object.assign(config.headers, headers);
    return config;
  });

  return client;
}

// Fetch all apartments/properties
async function getProperties(apiKey) {
  const client = getClient(apiKey);
  const res = await client.get('/apartments');
  return res.data.apartments || [];
}

// Fetch all bookings, with optional date filters
async function getBookings({ from, to, page = 1, pageSize = 100 } = {}, apiKey) {
  const client = getClient(apiKey);
  const params = { page, pageSize };
  if (from) params.from = from;
  if (to) params.to = to;
  const res = await client.get('/reservations', { params });
  return res.data;
}

// Fetch a single booking by ID
async function getBooking(bookingId, apiKey) {
  const client = getClient(apiKey);
  const res = await client.get(`/reservations/${bookingId}`);
  return res.data;
}

// Fetch property details (rooms, beds, location, etc.)
async function getPropertyDetails(apartmentId, apiKey) {
  const client = getClient(apiKey);
  const res = await client.get(`/apartments/${apartmentId}`);
  return res.data;
}

// Get rates for a property in a date range
async function getRates(apartmentId, from, to, apiKey) {
  const client = getClient(apiKey);
  // start_date / end_date, not from / to.
  //
  // Smoobu answers `from`/`to` with 422 "Request has wrong structure" —
  // no hint as to which part is wrong. syncRates catches that per
  // property, logs it to a console nobody reads, and reports success for
  // the bookings half of the same run. So daily_rates has been empty in
  // production since the day it was written: every calendar cell showed
  // no price, and the ones that did were invented from base_price.
  const res = await client.get(`/rates`, {
    params: { apartments: [apartmentId], start_date: from, end_date: to },
  });
  return res.data;
}

// Get all bookings across a wide date range for analytics (paginated)
async function getAllBookings({ from, to } = {}, apiKey) {
  let allBookings = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const data = await getBookings({ from, to, page, pageSize: 100 }, apiKey);
    const bookings = data.bookings || [];
    allBookings = allBookings.concat(bookings);
    hasMore = bookings.length >= 100;
    page++;
  }
  return allBookings;
}

/**
 * Write rates back to Smoobu.
 *
 * The shape here is not a guess. Sending `{apartments, from, to, price}`
 * was answered with 422 "Request has wrong structure" for every date of
 * every property, every night, and the caller logged only `err.message`
 * — "Request failed with status code 422" — throwing away the body that
 * explains it. So every price this app calculated stayed in our database
 * and never reached the channel manager.
 *
 * Asked directly, against an apartment id that does not exist so nothing
 * could be written, Smoobu says which shape it wants:
 *
 *   {apartments, from, to, price}                    wrong structure
 *   {apartments, operations:[{dates, price}]}        values are missing
 *   {apartments, operations:[{dates, daily_price}]}  accepted
 *
 * The signature is unchanged — one call per day, as the callers and
 * their tests expect. `dates` takes a list and this passes one, which
 * leaves batching available later without changing anything here.
 */
/**
 * Set one price across an explicit list of nights.
 *
 * `dates` is a list in Smoobu's own payload, so a month of nights is one
 * request. The list form matters beyond tidiness: a range with a booking
 * in the middle is not a range, and the caller filters those out before
 * calling — which a from/to pair cannot express.
 */
async function setRatesForDates(apartmentId, dates, pricePerNight, apiKey, minStay = null) {
  if (!dates || dates.length === 0) return null;
  const client = getClient(apiKey);

  // min_length_of_stay is confirmed, not assumed. Every dry probe hit
  // date validation before field validation, so the only way to tell an
  // honoured field from an ignored one was to write it and read it back:
  // 2027-03-28 went from 4 to 3 and back again.
  const operation = { dates, daily_price: pricePerNight };
  if (minStay != null) operation.min_length_of_stay = minStay;

  const res = await client.post('/rates', {
    apartments: [apartmentId],
    operations: [operation],
  });
  return res.data;
}

async function setRates(apartmentId, from, to, pricePerNight, apiKey) {
  const client = getClient(apiKey);

  // from..to inclusive, walked in UTC.
  //
  // Built from local midnight and read back with toISOString(), every
  // date east of Greenwich comes out as the day before — the rate would
  // be set on the wrong night, quietly, and only somewhere with a
  // positive offset. This runs in SAST.
  const dates = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const res = await client.post('/rates', {
    apartments: [apartmentId],
    operations: [{ dates, daily_price: pricePerNight }],
  });
  return res.data;
}


// Block dates (create a manual booking/block) to prevent new bookings
async function blockDates(apartmentId, from, to, note = '', apiKey) {
  const client = getClient(apiKey);
  const res = await client.post('/reservations', {
    apartmentId,
    arrivalDate: from,
    departureDate: to,
    channelId: 0, // Manual/block
    notice: note || 'Blocked - no cleaner available',
  });
  return res.data;
}

// Unblock dates (cancel a manual block reservation)
async function unblockDates(reservationId, apiKey) {
  const client = getClient(apiKey);
  const res = await client.delete(`/reservations/${reservationId}`);
  return res.data;
}

// Send a message to a guest via Smoobu
async function sendGuestMessage(reservationId, subject, messageBody, apiKey) {
  const client = getClient(apiKey);
  const res = await client.post(`/reservations/${reservationId}/messages`, {
    subject,
    messageBody,
  });
  return res.data;
}

module.exports = {
  setRatesForDates,
  getProperties,
  getPropertyDetails,
  getBookings,
  getAllBookings,
  getBooking,
  getRates,
  setRates,
  blockDates,
  unblockDates,
  sendGuestMessage,
};
