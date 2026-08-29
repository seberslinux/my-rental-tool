const { getAll } = require('../db/database');
const smoobu = require('./smoobu');
const { getApiKeyForProperty } = require('./api-key-resolver');

// Apply dynamic pricing rules for all properties
async function runPricingEngine() {
  const properties = await getAll('SELECT * FROM properties WHERE base_price > 0', []);

  const today = new Date();
  const from = today.toISOString().split('T')[0];
  const to = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  for (const property of properties) {
    try {
      await applyPricingForProperty(property, from, to);
    } catch (err) {
      console.error(`Pricing error for ${property.name}:`, err.message);
    }
  }
}

async function applyPricingForProperty(property, from, to) {
  const basePrice = property.base_price;

  // Get existing bookings to identify gaps and blocked dates
  const bookings = await getAll(
    `SELECT * FROM bookings
     WHERE property_id = $1 AND check_out >= $2 AND check_in <= $3 AND status = 'confirmed'
     ORDER BY check_in ASC`,
    [property.id, from, to]
  );

  const blockedDates = (
    await getAll(
      'SELECT date FROM blocked_dates WHERE property_id = $1 AND date >= $2 AND date <= $3',
      [property.id, from, to]
    )
  ).map((r) => r.date);

  const bookedDates = new Set();
  for (const b of bookings) {
    let d = new Date(b.check_in);
    const end = new Date(b.check_out);
    while (d < end) {
      bookedDates.add(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
  }

  const blockedSet = new Set(blockedDates);

  // Identify gap nights between bookings
  const gapNights = new Set();
  for (let i = 0; i < bookings.length - 1; i++) {
    const gapStart = new Date(bookings[i].check_out);
    const gapEnd = new Date(bookings[i + 1].check_in);
    const gapLength = Math.round((gapEnd - gapStart) / (24 * 60 * 60 * 1000));

    if (gapLength >= 1 && gapLength <= 2) {
      let d = new Date(gapStart);
      while (d < gapEnd) {
        gapNights.add(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }
    }
  }

  const today = new Date();
  let current = new Date(from);
  const endDate = new Date(to);

  // price -> the nights that carry it
  const byPrice = new Map();

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0];

    // Skip booked and blocked dates
    if (bookedDates.has(dateStr) || blockedSet.has(dateStr)) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    let price = basePrice;
    const dayOfWeek = current.getDay();
    const daysFromNow = Math.round((current - today) / (24 * 60 * 60 * 1000));

    // Weekend pricing (Fri=5, Sat=6)
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      price = basePrice * 1.3;
    }

    // Last-minute discount: within 5 days and available
    if (daysFromNow >= 0 && daysFromNow <= 5) {
      price = basePrice * 0.85;
    }

    // Gap fill: 1-2 night gap between bookings
    if (gapNights.has(dateStr)) {
      price = basePrice * 0.75;
    }

    // Round to nearest whole number
    price = Math.round(price);

    // Collected rather than sent. Smoobu takes a list of dates per
    // price, so a month is a handful of requests instead of one for
    // every night — and one failure no longer means thirty log lines
    // saying the same thing.
    if (!byPrice.has(price)) byPrice.set(price, []);
    byPrice.get(price).push(dateStr);

    current.setDate(current.getDate() + 1);
  }

  if (byPrice.size === 0) {
    console.log(`No rates to set for ${property.name} — every night is booked or blocked.`);
    return;
  }

  const operations = [...byPrice.entries()].map(([price, dates]) => ({ price, dates }));
  const nights = operations.reduce((n, op) => n + op.dates.length, 0);

  try {
    const apiKey = await getApiKeyForProperty(property.id);
    await smoobu.setRates(property.smoobu_id, operations, apiKey);
    console.log(
      `Set rates for ${property.name}: ${nights} nights, ${operations.length} price(s)`
    );
  } catch (err) {
    // The body, not just the status. "Request failed with status code
    // 422" is what hid this bug for the life of the feature; Smoobu says
    // what is wrong with the request and we were discarding it.
    const detail = err.response && err.response.data ?
    JSON.stringify(err.response.data) :
    err.message;
    console.error(`Failed to set rates for ${property.name}: ${detail}`);
  }
}

module.exports = { runPricingEngine };
