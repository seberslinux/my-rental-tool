const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const smoobu = require('../services/smoobu');
const { requireRole, scopeProperties } = require('../middleware/auth');
const { detectCurrency } = require('../services/currency-detect');
const { bulkConvert, getDisplayCurrency } = require('../services/exchange-rates');

// Sync routes — admin only
router.post('/sync/properties', requireRole('admin'), async (req, res) => {
  try {
    const apartments = await smoobu.getProperties();
    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO properties (smoobu_id, name)
      VALUES (?, ?)
      ON CONFLICT(smoobu_id) DO UPDATE SET name = excluded.name
    `);

    const transaction = db.transaction((apartments) => {
      for (const apt of apartments) {
        upsert.run(apt.id, apt.name);
      }
    });

    transaction(apartments);
    res.json({ synced: apartments.length, properties: apartments });
  } catch (err) {
    console.error('Property sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sync bookings from Smoobu into local DB
router.post('/sync/bookings', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const to = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    let allBookings = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await smoobu.getBookings({ from, to, page });
      const bookings = data.bookings || [];
      allBookings = allBookings.concat(bookings);
      hasMore = bookings.length >= 100;
      page++;
    }

    // Build property base_currency map for fallback
    const propCurrencyMap = {};
    const props = db.prepare('SELECT smoobu_id, base_currency FROM properties').all();
    for (const p of props) propCurrencyMap[p.smoobu_id] = p.base_currency || 'ZAR';

    const upsert = db.prepare(`
      INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, created_at, lead_time_days, length_of_stay, price_per_night, currency)
      VALUES (?, (SELECT id FROM properties WHERE smoobu_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(smoobu_id) DO UPDATE SET
        guest_name = excluded.guest_name,
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        platform = excluded.platform,
        total_price = excluded.total_price,
        status = excluded.status,
        num_guests = excluded.num_guests,
        created_at = excluded.created_at,
        lead_time_days = excluded.lead_time_days,
        length_of_stay = excluded.length_of_stay,
        price_per_night = excluded.price_per_night,
        currency = excluded.currency
    `);

    const transaction = db.transaction((bookings) => {
      for (const b of bookings) {
        const platform = b['channel']?.name || b.channel || '';
        const checkIn = b.arrival || b.arrivalDate;
        const checkOut = b.departure || b.departureDate;
        const createdAt = b['created-at'] || b.createdAt || '';
        const los = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (24 * 60 * 60 * 1000)));
        const price = b.price || 0;
        const ppn = los > 0 ? Math.round((price / los) * 100) / 100 : 0;
        const leadTime = createdAt ? Math.max(0, Math.round((new Date(checkIn) - new Date(createdAt)) / (24 * 60 * 60 * 1000))) : 0;
        const aptId = b['apartment']?.id || b.apartmentId;
        const currency = detectCurrency(b) || propCurrencyMap[aptId] || 'ZAR';

        upsert.run(
          b.id,
          aptId,
          b['guest-name'] || b.guestName || '',
          checkIn,
          checkOut,
          platform,
          price,
          b.type === 'cancellation' ? 'cancelled' : 'confirmed',
          b['adults'] || b.adults || 1,
          createdAt,
          leadTime,
          los,
          ppn,
          currency
        );
      }
    });

    transaction(allBookings);

    // Run cleaner assignment after syncing bookings
    const { runAssignmentForAllCheckouts } = require('../services/cleaner-assignment');
    await runAssignmentForAllCheckouts();

    res.json({ synced: allBookings.length });
  } catch (err) {
    console.error('Booking sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all bookings from local DB
router.get('/bookings', scopeProperties, async (req, res) => {
  const db = getDb();
  let bookings;
  if (req.accessiblePropertyIds === null) {
    bookings = db.prepare(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id ORDER BY b.check_in ASC`
    ).all();
  } else {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json({ bookings: [], display_currency: getDisplayCurrency() });
    const ph = ids.map(() => '?').join(',');
    bookings = db.prepare(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.property_id IN (${ph}) ORDER BY b.check_in ASC`
    ).all(...ids);
  }
  const displayCurrency = getDisplayCurrency();
  await bulkConvert(bookings, displayCurrency);
  res.json({ bookings, display_currency: displayCurrency });
});

// Get dashboard stats
router.get('/dashboard/stats', scopeProperties, async (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Upcoming checkouts in next 48 hours
  let checkoutQuery = `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.check_out >= ? AND b.check_out <= ? AND b.status = 'confirmed'`;
  let checkoutParams = [today, in48h];
  if (req.accessiblePropertyIds !== null) {
    if (req.accessiblePropertyIds.length === 0) return res.json({ upcoming_checkouts: [], occupancy: [], gaps: [], pending_cleaning_jobs: [] });
    const ph = req.accessiblePropertyIds.map(() => '?').join(',');
    checkoutQuery += ` AND b.property_id IN (${ph})`;
    checkoutParams.push(...req.accessiblePropertyIds);
  }
  checkoutQuery += ' ORDER BY b.check_out ASC';
  const upcomingCheckouts = db.prepare(checkoutQuery).all(...checkoutParams);

  // Occupancy rate per property (next 30 days)
  let properties;
  if (req.accessiblePropertyIds === null) {
    properties = db.prepare('SELECT * FROM properties').all();
  } else {
    const ph = req.accessiblePropertyIds.map(() => '?').join(',');
    properties = db.prepare(`SELECT * FROM properties WHERE id IN (${ph})`).all(...req.accessiblePropertyIds);
  }
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const occupancy = properties.map((p) => {
    const bookings = db
      .prepare(
        `SELECT * FROM bookings
         WHERE property_id = ? AND check_out >= ? AND check_in <= ? AND status = 'confirmed'
         AND platform NOT LIKE 'Blocked%'`
      )
      .all(p.id, today, thirtyDaysOut);

    let bookedNights = 0;
    for (const b of bookings) {
      const start = new Date(Math.max(new Date(b.check_in), new Date(today)));
      const end = new Date(Math.min(new Date(b.check_out), new Date(thirtyDaysOut)));
      bookedNights += Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
    }
    const rate = Math.round((bookedNights / 30) * 100);
    return { property_id: p.id, name: p.name, occupancy_rate: rate, booked_nights: bookedNights };
  });

  // Gap detection: 1-3 night gaps between bookings
  const gaps = [];
  for (const p of properties) {
    const pBookings = db
      .prepare(
        `SELECT * FROM bookings
         WHERE property_id = ? AND check_out >= ? AND status = 'confirmed'
         AND platform NOT LIKE 'Blocked%'
         ORDER BY check_in ASC`
      )
      .all(p.id, today);

    for (let i = 0; i < pBookings.length - 1; i++) {
      const gapStart = pBookings[i].check_out;
      const gapEnd = pBookings[i + 1].check_in;
      const nights = Math.round(
        (new Date(gapEnd) - new Date(gapStart)) / (24 * 60 * 60 * 1000)
      );
      if (nights >= 1 && nights <= 3) {
        gaps.push({
          property_id: p.id,
          property_name: p.name,
          gap_start: gapStart,
          gap_end: gapEnd,
          nights,
        });
      }
    }
  }

  // Cleaning jobs
  const pendingJobs = db
    .prepare(
      `SELECT cj.*, p.name as property_name, c.name as cleaner_name
       FROM cleaning_jobs cj
       JOIN properties p ON cj.property_id = p.id
       LEFT JOIN cleaners c ON cj.cleaner_id = c.id
       WHERE cj.cleaning_date >= ? AND cj.status != 'completed'
       ORDER BY cj.cleaning_date ASC`
    )
    .all(today);

  const displayCurrency = getDisplayCurrency();
  await bulkConvert(upcomingCheckouts, displayCurrency);

  res.json({
    upcoming_checkouts: upcomingCheckouts,
    occupancy,
    gaps,
    pending_cleaning_jobs: pendingJobs,
    display_currency: displayCurrency,
  });
});

module.exports = router;
