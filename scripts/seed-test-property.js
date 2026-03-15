#!/usr/bin/env node
/**
 * Seed a realistic test property: "Seaforth Cottage" in Simon's Town.
 * A cozy 1-bed cottage near Boulders Beach — budget-friendly, popular with couples.
 * Data is intentionally different from Hill Top Lodge and The Loft.
 * Safe to run multiple times (cleans up previous test data first).
 */

require('dotenv').config();
const { getDb, closeDb } = require('../src/db/database');
const { runMigrations } = require('../src/db/migrations');

runMigrations();
const db = getDb();

const SMOOBU_ID = 9999999;
const PROPERTY_NAME = 'Seaforth Cottage';

// --- Clean up ALL previous test data ---
const existing = db.prepare('SELECT id FROM properties WHERE smoobu_id = ?').get(SMOOBU_ID);
if (existing) {
  db.prepare('DELETE FROM bookings WHERE property_id = ?').run(existing.id);
  db.prepare('DELETE FROM reviews WHERE property_id = ?').run(existing.id);
  db.prepare('DELETE FROM expenses WHERE property_id = ?').run(existing.id);
  db.prepare('DELETE FROM cleaning_jobs WHERE property_id = ?').run(existing.id);
  db.prepare('DELETE FROM daily_rates WHERE property_id = ?').run(existing.id);
  db.prepare('DELETE FROM property_costs WHERE property_id = ?').run(existing.id);
  db.prepare('DELETE FROM properties WHERE id = ?').run(existing.id);
  console.log('Cleaned up previous test data.');
}
// Also remove old "Oceanview Cottage (Test)" if it exists
const oldTest = db.prepare("SELECT id FROM properties WHERE name LIKE '%Oceanview%Test%'").get();
if (oldTest) {
  db.prepare('DELETE FROM bookings WHERE property_id = ?').run(oldTest.id);
  db.prepare('DELETE FROM reviews WHERE property_id = ?').run(oldTest.id);
  db.prepare('DELETE FROM expenses WHERE property_id = ?').run(oldTest.id);
  db.prepare('DELETE FROM cleaning_jobs WHERE property_id = ?').run(oldTest.id);
  db.prepare('DELETE FROM daily_rates WHERE property_id = ?').run(oldTest.id);
  db.prepare('DELETE FROM property_costs WHERE property_id = ?').run(oldTest.id);
  db.prepare('DELETE FROM properties WHERE id = ?').run(oldTest.id);
  console.log('Cleaned up old Oceanview test property.');
}

// --- Create property ---
// Distinct from Hill Top (R2100 base, 4-bed hilltop) and The Loft (R2400 base, 2-bed loft)
// Seaforth: R950 base, 1-bed cottage, budget segment, shorter stays, higher turnover
db.prepare(`
  INSERT INTO properties (smoobu_id, name, address, base_price, base_currency, cleaning_hours_required,
    property_type, bedrooms, bathrooms, max_guests, location, neighbourhood,
    commission_airbnb, commission_booking, commission_vrbo,
    bank_charge_airbnb, bank_charge_booking, bank_charge_vrbo, vat_rate,
    wifi_network, wifi_password, access_code,
    checkin_instructions, checkout_instructions, emergency_contact)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  SMOOBU_ID, PROPERTY_NAME,
  '7 Seaforth Road, Simon\'s Town, Cape Town 7975',
  950, 'ZAR', 1.5,
  'cottage', 1, 1, 2,
  'Simon\'s Town, Cape Town', 'Seaforth',
  18, 15, 8,
  0, 2.1, 0, 14,
  'SeaforthGuest', 'penguins2025!', '7788',
  'Check-in from 14:00. Use keypad code 7788 on front door. Street parking available.',
  'Check-out by 11:00. Please take out rubbish bins, lock all windows, and leave keypad locked.',
  'Property manager: Mike 082 555 1234'
);

const propId = db.prepare('SELECT id FROM properties WHERE smoobu_id = ?').get(SMOOBU_ID).id;
console.log(`Created property: ${PROPERTY_NAME} (id=${propId})`);

// --- Helpers ---
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max) { return Math.round((Math.random() * (max - min) + min) * 100) / 100; }

// --- Booking generation ---
// Different profile from other properties:
// - Lower price point (R850-R1400/night vs R2000-R3500)
// - Shorter stays (mostly 2-3 nights, couples)
// - Higher proportion of Booking.com (it's the budget traveller platform)
// - More international guests
// - More last-minute bookings

const platforms = [
  { name: 'Airbnb', weight: 35, commRate: 0.178 },
  { name: 'Booking.com', weight: 45, commRate: 0.15 },
  { name: 'Direct booking', weight: 12, commRate: 0 },
  { name: 'VRBO / HomeAway', weight: 8, commRate: 0.08 },
];

function pickPlatform() {
  const r = Math.random() * 100;
  let cum = 0;
  for (const p of platforms) { cum += p.weight; if (r < cum) return p; }
  return platforms[0];
}

// Distinct guest names (no overlap with real data)
const guests = [
  'Thomas Berger', 'Amélie Fontaine', 'Nomsa Zulu', 'Henrik Johansson', 'Priya Patel',
  'Bongani Sithole', 'Claudia Braun', 'Akira Sato', 'Zanele Mthembu', 'Dirk Venter',
  'Louise Moreau', 'Takeshi Yamamoto', 'Palesa Mokoena', 'Florian Keller', 'Mai Nguyen',
  'Sipho Mabaso', 'Eva Schneider', 'Raj Sharma', 'Lindiwe Maseko', 'Karl Zimmermann',
  'Yoko Ishida', 'Mpho Tau', 'Andreas Fuchs', 'Nalini Govender', 'Oscar Nilsson',
  'Busisiwe Mkhize', 'Jakob Richter', 'Sakura Ito', 'Themba Nkosi', 'Hilde Bakker',
  'Mandla Dube', 'Katarina Horvat', 'Ravi Mehta', 'Nosipho Cele', 'Tobias Werner',
  'Ayesha Cassim', 'Gustaf Lund', 'Zinhle Ngcobo', 'Philippe Lambert', 'Nokukhanya Zwane',
];

// Seasonal nightly rate — lower price segment
function nightlyRate(month) {
  const rates = {
    1: 1350, 2: 1300, 3: 1100, 4: 950, 5: 850,
    6: 800, 7: 850, 8: 900, 9: 950, 10: 1050,
    11: 1200, 12: 1500,
  };
  return rates[month] || 950;
}

// Length of stay distribution — shorter stays, budget travellers
function pickLos() {
  const r = Math.random();
  if (r < 0.35) return 2;  // 35% 2-night stays
  if (r < 0.65) return 3;  // 30% 3-night stays
  if (r < 0.80) return 4;  // 15% 4-night stays
  if (r < 0.90) return 5;  // 10% 5-night stays
  if (r < 0.95) return 1;  // 5% single night
  return randomInt(6, 10);  // 5% longer stays
}

const bookingInsert = db.prepare(`
  INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, created_at, lead_time_days, length_of_stay, price_per_night, commission, currency, language, guest_country)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let smoobuBookingId = 80000000;
let bookingCount = 0;
let cancelCount = 0;

const languages = ['en', 'de', 'fr', 'nl', 'ja', 'af', 'pt', 'es', 'it', 'ko'];
const countries = ['South Africa', 'Germany', 'United Kingdom', 'Netherlands', 'France', 'Japan', 'United States', 'Australia', 'Switzerland', 'Brazil'];

let cursor = new Date('2024-10-01');
const endDate = new Date('2026-05-31');

while (cursor < endDate) {
  const month = cursor.getMonth() + 1;
  const year = cursor.getFullYear();
  const daysInMonth = new Date(year, month, 0).getDate();

  // Target occupancy (different from other properties — higher in summer due to beach location)
  const occTarget = month === 12 || month === 1 ? 0.90 : month === 2 ? 0.85 : month >= 6 && month <= 8 ? 0.40 : 0.65;
  let dayPointer = 1;

  while (dayPointer <= daysInMonth) {
    const los = pickLos();
    if (dayPointer + los > daysInMonth + 3) break; // don't spill too far

    const checkIn = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(dayPointer, daysInMonth)).padStart(2, '0')}`;
    const coDate = new Date(year, month - 1, dayPointer + los);
    const checkOut = coDate.toISOString().split('T')[0];
    const plat = pickPlatform();
    const ppn = nightlyRate(month) + randomInt(-100, 150);
    const cleaningFee = 400;
    const totalPrice = ppn * los + cleaningFee;
    const numGuests = randomInt(1, 2);
    // Shorter lead times — more last-minute bookings for budget property
    const leadTime = Math.random() < 0.3 ? randomInt(0, 3) : randomInt(4, 60);
    const createdAt = new Date(new Date(checkIn).getTime() - leadTime * 24 * 60 * 60 * 1000);
    const createdAtStr = createdAt.toISOString().replace('T', ' ').substring(0, 16);
    const guest = guests[randomInt(0, guests.length - 1)];
    const commission = Math.round(totalPrice * plat.commRate * 100) / 100;
    const lang = languages[randomInt(0, languages.length - 1)];
    const country = countries[randomInt(0, countries.length - 1)];

    // ~10% cancellation rate (higher than premium properties)
    const isCancelled = Math.random() < 0.10;

    // Occupancy check — skip if we've filled enough
    const filledSoFar = dayPointer / daysInMonth;
    if (filledSoFar > occTarget && Math.random() > 0.3) {
      dayPointer += randomInt(2, 5);
      continue;
    }

    smoobuBookingId++;
    bookingInsert.run(
      smoobuBookingId, propId, guest, checkIn, checkOut, plat.name,
      totalPrice, isCancelled ? 'cancelled' : 'confirmed',
      numGuests, createdAtStr, leadTime, los, ppn, commission, 'ZAR',
      lang, country
    );

    if (isCancelled) cancelCount++;
    bookingCount++;
    dayPointer += los + randomInt(0, 2);
  }

  cursor = new Date(year, month, 1);
}

console.log(`Created ${bookingCount} bookings (${cancelCount} cancelled)`);

// --- Reviews ---
const reviewInsert = db.prepare(`
  INSERT INTO reviews (property_id, platform, guest_name, rating, comment, review_date, response, external_id, language, sentiment)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const comments5 = [
  'Such a lovely little cottage! The penguin colony is a short walk away and the views are incredible. Perfect for a romantic weekend.',
  'Absolutely charming! Small but beautifully done. We spent every morning having coffee on the patio watching the ocean. Highly recommended.',
  'Best budget find in Simon\'s Town. Clean, cozy, and the location near Boulders Beach is amazing. Will book again!',
  'We loved this little cottage. Everything was spotless, the bed was super comfortable, and the host was very responsive.',
  'What a wonderful stay! The cottage has everything you need and the neighbourhood is quiet and safe. The penguins are a bonus!',
  'Perfect base for exploring the peninsula. We visited Boulders Beach, Cape Point, and the harbour — all within easy reach.',
  'Incredible value. The cottage is small but perfectly formed. Beautiful views, great location, and very clean.',
  'A hidden gem! The patio is lovely for sundowners and the walk to Seaforth Beach is just 5 minutes.',
];

const comments4 = [
  'Nice cottage in a great location. A bit compact for longer stays but perfect for a weekend. Good WiFi.',
  'Good value for the area. The cottage could use a second fan for summer but otherwise very comfortable.',
  'Lovely spot near Boulders Beach. Parking was a bit tight but the host was helpful with directions.',
  'Clean and well-equipped. The shower is small but water pressure is good. Great location for exploring.',
];

const comments3 = [
  'Location is great but the cottage is quite small. Okay for a night or two. Could use better kitchen equipment.',
  'Average stay. The mattress was a bit soft for our liking. Views make up for it though.',
];

const responses = [
  'Thank you so much! We\'re glad you enjoyed the penguins — they\'re our favourite neighbours!',
  'So happy you had a great stay! You\'re welcome back anytime.',
  'Thanks for the kind review! We love hosting guests who appreciate the area.',
  'We appreciate your feedback and are always looking to improve. Hope to see you again!',
  '',
  '',
];

const pastBookings = db.prepare(`
  SELECT smoobu_id, guest_name, check_out, platform, language FROM bookings
  WHERE property_id = ? AND status = 'confirmed' AND check_out < date('now')
  ORDER BY check_out ASC
`).all(propId);

let reviewCount = 0;
for (const b of pastBookings) {
  if (Math.random() > 0.55) continue; // 55% review rate

  const ratingRoll = Math.random();
  let rating, commentPool;
  if (ratingRoll < 0.60) { rating = 5; commentPool = comments5; }
  else if (ratingRoll < 0.85) { rating = 4; commentPool = comments4; }
  else { rating = 3; commentPool = comments3; }

  const comment = commentPool[randomInt(0, commentPool.length - 1)];
  const response = responses[randomInt(0, responses.length - 1)];
  const reviewDate = new Date(new Date(b.check_out).getTime() + randomInt(1, 10) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sentiment = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';

  reviewInsert.run(propId, b.platform, b.guest_name, rating, comment, reviewDate, response, `test_${b.smoobu_id}`, b.language || 'en', sentiment);
  reviewCount++;
}
console.log(`Created ${reviewCount} reviews`);

// --- Expenses ---
const expenseInsert = db.prepare(`
  INSERT INTO expenses (property_id, category, amount, description, expense_date, recurring, recurring_frequency, currency)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let expenseCount = 0;

// Monthly recurring — lower than premium properties
const monthlyExp = [
  { category: 'Electricity', amount: 680, desc: 'Prepaid electricity' },
  { category: 'Water', amount: 320, desc: 'Municipal water rates' },
  { category: 'Insurance', amount: 520, desc: 'Rental property insurance' },
  { category: 'Supplies', amount: 250, desc: 'Cleaning supplies & toiletries restock' },
];

let expMonth = new Date('2024-10-01');
while (expMonth < new Date('2026-04-01')) {
  const dateStr = expMonth.toISOString().split('T')[0];
  for (const e of monthlyExp) {
    const amount = e.amount + randomInt(-50, 80);
    expenseInsert.run(propId, e.category, amount, e.desc, dateStr, 1, 'monthly', 'ZAR');
    expenseCount++;
  }
  expMonth = new Date(expMonth.getFullYear(), expMonth.getMonth() + 1, 1);
}

// One-off expenses
const oneOffs = [
  { category: 'Repair & Maintenance', amount: 1800, desc: 'Hot water geyser repair', date: '2024-11-20' },
  { category: 'Supplies', amount: 650, desc: 'New towel set (4 bath, 4 hand)', date: '2025-01-08' },
  { category: 'Improvements', amount: 3200, desc: 'Patio furniture and umbrella', date: '2025-03-15' },
  { category: 'Repair & Maintenance', amount: 950, desc: 'Drain unblocking - shower', date: '2025-05-22' },
  { category: 'Cleaning', amount: 1500, desc: 'Deep clean after long-term guest', date: '2025-07-10' },
  { category: 'Improvements', amount: 2800, desc: 'Keypad lock installation', date: '2025-09-01' },
  { category: 'Supplies', amount: 480, desc: 'Kitchen utensil replacement', date: '2025-11-12' },
  { category: 'Repair & Maintenance', amount: 2100, desc: 'Roof leak patch + paint touch-up', date: '2026-02-05' },
];

for (const e of oneOffs) {
  expenseInsert.run(propId, e.category, e.amount, e.desc, e.date, 0, '', 'ZAR');
  expenseCount++;
}
console.log(`Created ${expenseCount} expenses`);

// --- Summary ---
const stats = db.prepare(`
  SELECT COUNT(*) as cnt, ROUND(AVG(total_price)) as avg_price, ROUND(AVG(length_of_stay),1) as avg_los, ROUND(AVG(price_per_night)) as avg_ppn
  FROM bookings WHERE property_id = ? AND status = 'confirmed'
`).get(propId);

console.log(`\n=== ${PROPERTY_NAME} Created ===`);
console.log(`Property ID: ${propId} | Smoobu ID: ${SMOOBU_ID}`);
console.log(`Bookings: ${bookingCount} (${cancelCount} cancelled)`);
console.log(`Reviews: ${reviewCount}`);
console.log(`Expenses: ${expenseCount}`);
console.log(`\nStats: avg price R${stats.avg_price} | avg LOS ${stats.avg_los} nights | avg PPN R${stats.avg_ppn}`);
console.log(`\nCompare with real properties:`);

const all = db.prepare(`
  SELECT p.name, COUNT(b.id) as bookings, ROUND(AVG(b.total_price)) as avg_price,
    ROUND(AVG(b.length_of_stay),1) as avg_los, ROUND(AVG(b.price_per_night)) as avg_ppn
  FROM bookings b JOIN properties p ON b.property_id = p.id
  WHERE b.status = 'confirmed' AND b.platform NOT LIKE 'Blocked%'
  GROUP BY p.id
`).all();
console.table(all);
console.log(`\nAssign this property to a test user via User Management.`);

closeDb();
