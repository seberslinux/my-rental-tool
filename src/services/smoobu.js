const axios = require('axios');

const BASE_URL = 'https://login.smoobu.com/api';

function getClient() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Api-Key': process.env.SMOOBU_API_KEY,
      'Content-Type': 'application/json',
    },
  });
}

// Fetch all apartments/properties
async function getProperties() {
  const client = getClient();
  const res = await client.get('/apartments');
  return res.data.apartments || [];
}

// Fetch all bookings, with optional date filters
async function getBookings({ from, to, page = 1, pageSize = 100 } = {}) {
  const client = getClient();
  const params = { page, pageSize };
  if (from) params.from = from;
  if (to) params.to = to;
  const res = await client.get('/reservations', { params });
  return res.data;
}

// Fetch a single booking by ID
async function getBooking(bookingId) {
  const client = getClient();
  const res = await client.get(`/reservations/${bookingId}`);
  return res.data;
}

// Fetch property details (rooms, beds, location, etc.)
async function getPropertyDetails(apartmentId) {
  const client = getClient();
  const res = await client.get(`/apartments/${apartmentId}`);
  return res.data;
}

// Get rates for a property in a date range
async function getRates(apartmentId, from, to) {
  const client = getClient();
  const res = await client.get(`/rates`, {
    params: { apartments: [apartmentId], from, to },
  });
  return res.data;
}

// Get all bookings across a wide date range for analytics (paginated)
async function getAllBookings({ from, to } = {}) {
  let allBookings = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const data = await getBookings({ from, to, page, pageSize: 100 });
    const bookings = data.bookings || [];
    allBookings = allBookings.concat(bookings);
    hasMore = bookings.length >= 100;
    page++;
  }
  return allBookings;
}

// Update rates for a property
async function setRates(apartmentId, from, to, pricePerNight) {
  const client = getClient();
  const res = await client.post('/rates', {
    apartments: [apartmentId],
    from,
    to,
    price: pricePerNight,
  });
  return res.data;
}

// Block dates (create a manual booking/block) to prevent new bookings
async function blockDates(apartmentId, from, to, note = '') {
  const client = getClient();
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
async function unblockDates(reservationId) {
  const client = getClient();
  const res = await client.delete(`/reservations/${reservationId}`);
  return res.data;
}

// Send a message to a guest via Smoobu
async function sendGuestMessage(reservationId, subject, messageBody) {
  const client = getClient();
  const res = await client.post(`/reservations/${reservationId}/messages`, {
    subject,
    messageBody,
  });
  return res.data;
}

module.exports = {
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
