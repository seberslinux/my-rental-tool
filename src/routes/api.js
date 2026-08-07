const express = require('express');
const router = express.Router();
const { getAll, getOne, run, transaction, inParams } = require('../db/database');
const smoobu = require('../services/smoobu');
const { requireRole, scopeProperties } = require('../middleware/auth');
const { detectCurrency } = require('../services/currency-detect');
const { bulkConvert, getDisplayCurrency } = require('../services/exchange-rates');
const { getApiKeyForUser } = require('../services/api-key-resolver');

// Sync properties — uses the requesting user's API key (or env var fallback)
router.post('/sync/properties', requireRole('admin'), async (req, res) => {
  try {
    const apiKey = await getApiKeyForUser(req.user.id);
    if (!apiKey) return res.status(400).json({ error: 'No Smoobu API key configured' });

    const apartments = await smoobu.getProperties(apiKey);

    // Fetch detailed info for each property
    const detailedApts = [];
    for (const apt of apartments) {
      try {
        const details = await smoobu.getPropertyDetails(apt.id, apiKey);
        detailedApts.push({ ...apt, details });
      } catch (e) {
        detailedApts.push({ ...apt, details: null });
      }
    }

    await transaction(async (client) => {
      for (const apt of detailedApts) {
        const d = apt.details || {};
        const loc = d.location || {};
        const rooms = d.rooms || {};
        const price = d.price || {};
        const address = [loc.street, loc.zip, loc.city, loc.country].filter(Boolean).join(', ');
        const basePrice = price.minimal || 0;
        const currency = d.currency || 'ZAR';
        const bedrooms = rooms.bedrooms || 1;
        const bathrooms = rooms.bathrooms || 1;
        const maxGuests = rooms.maxOccupancy || 2;
        const propertyType = d.type?.name || 'apartment';
        const neighbourhood = loc.city || '';
        const locationStr = loc.latitude && loc.longitude ? `${loc.latitude},${loc.longitude}` : '';

        await client.query(
          `INSERT INTO properties (smoobu_id, name, owner_user_id, address, base_price, base_currency, bedrooms, bathrooms, max_guests, property_type, neighbourhood, location)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT(smoobu_id) DO UPDATE SET
             name = excluded.name,
             owner_user_id = CASE WHEN properties.owner_user_id IS NULL THEN excluded.owner_user_id ELSE properties.owner_user_id END,
             address = CASE WHEN excluded.address != '' THEN excluded.address ELSE properties.address END,
             base_price = CASE WHEN excluded.base_price > 0 THEN excluded.base_price ELSE properties.base_price END,
             base_currency = CASE WHEN excluded.base_currency != 'ZAR' OR properties.base_currency = '' OR properties.base_currency IS NULL THEN excluded.base_currency ELSE properties.base_currency END,
             bedrooms = excluded.bedrooms,
             bathrooms = excluded.bathrooms,
             max_guests = excluded.max_guests,
             property_type = excluded.property_type,
             neighbourhood = CASE WHEN excluded.neighbourhood != '' THEN excluded.neighbourhood ELSE properties.neighbourhood END,
             location = CASE WHEN excluded.location != '' THEN excluded.location ELSE properties.location END`,
          [apt.id, apt.name, req.user.id, address, basePrice, currency, bedrooms, bathrooms, maxGuests, propertyType, neighbourhood, locationStr]
        );

        // Ensure owner has access in user_properties
        const prop = await client.query('SELECT id FROM properties WHERE smoobu_id = $1', [apt.id]);
        if (prop.rows.length > 0) {
          await client.query(
            `INSERT INTO user_properties (user_id, property_id, role)
             VALUES ($1, $2, 'owner')
             ON CONFLICT (user_id, property_id) DO NOTHING`,
            [req.user.id, prop.rows[0].id]
          );
        }
      }
    });

    res.json({ synced: apartments.length, properties: apartments });
  } catch (err) {
    console.error('Property sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sync bookings from Smoobu into local DB
router.post('/sync/bookings', requireRole('admin'), async (req, res) => {
  try {
    const apiKey = await getApiKeyForUser(req.user.id);
    if (!apiKey) return res.status(400).json({ error: 'No Smoobu API key configured' });

    const today = new Date();
    const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const to = new Date(today.getTime() + 180 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    let allBookings = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await smoobu.getBookings({ from, to, page }, apiKey);
      const bookings = data.bookings || [];
      allBookings = allBookings.concat(bookings);
      hasMore = bookings.length >= 100;
      page++;
    }

    // Build property base_currency map for fallback
    const propCurrencyMap = {};
    const props = await getAll('SELECT smoobu_id, base_currency FROM properties');
    for (const p of props) propCurrencyMap[p.smoobu_id] = p.base_currency || 'ZAR';

    await transaction(async (client) => {
      // Delete all bookings in the sync window — Smoobu is the source of truth.
      // cleaning_jobs.booking_id uses smoobu_id, so the link survives re-insert.
      await client.query(
        `DELETE FROM bookings WHERE check_in >= $1 AND check_in <= $2`,
        [from, to]
      );

      for (const b of allBookings) {
        const platform = b['channel']?.name || b.channel || '';
        const checkIn = b.arrival || b.arrivalDate;
        const checkOut = b.departure || b.departureDate;
        const createdAt = b['created-at'] || b.createdAt || '';
        const modifiedAt = b['modified-at'] || b.modifiedAt || '';
        const los = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (24 * 60 * 60 * 1000)));
        const price = b.price || 0;
        const ppn = los > 0 ? Math.round((price / los) * 100) / 100 : 0;
        const leadTime = createdAt ? Math.max(0, Math.round((new Date(checkIn) - new Date(createdAt)) / (24 * 60 * 60 * 1000))) : 0;
        const aptId = b['apartment']?.id || b.apartmentId;
        const currency = detectCurrency(b) || propCurrencyMap[aptId] || 'ZAR';

        await client.query(
          `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, created_at, lead_time_days, length_of_stay, price_per_night, currency, modified_at)
           VALUES ($1, (SELECT id FROM properties WHERE smoobu_id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT(smoobu_id) DO UPDATE SET
             guest_name = CASE WHEN excluded.guest_name = '' THEN bookings.guest_name ELSE excluded.guest_name END,
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
             currency = excluded.currency,
             modified_at = excluded.modified_at`,
          [
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
            currency,
            modifiedAt
          ]
        );
      }
    });

    // Run cleaner assignment after syncing bookings
    const { runAssignmentForAllCheckouts } = require('../services/cleaner-assignment');
    await runAssignmentForAllCheckouts();

    // Record when this sync completed so the UI can show "Synced X ago"
    await run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_synced_at', NOW()::text, NOW())
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      []
    );

    res.json({ synced: allBookings.length });
  } catch (err) {
    console.error('Booking sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all bookings from local DB
router.get('/bookings', scopeProperties, async (req, res) => {
  let bookings;
  if (req.accessiblePropertyIds === null) {
    bookings = await getAll(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id ORDER BY b.check_in ASC`
    );
  } else {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json({ bookings: [], display_currency: await getDisplayCurrency() });
    const ph = inParams(ids, 1);
    bookings = await getAll(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.property_id IN (${ph}) ORDER BY b.check_in ASC`,
      ids
    );
  }
  const displayCurrency = await getDisplayCurrency();
  await bulkConvert(bookings, displayCurrency);
  res.json({ bookings, display_currency: displayCurrency });
});

// Get dashboard stats
router.get('/dashboard/stats', scopeProperties, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  // Upcoming checkouts in next 48 hours
  let checkoutQuery = `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.check_out >= $1 AND b.check_out <= $2 AND b.status = 'confirmed'`;
  let checkoutParams = [today, in48h];
  if (req.accessiblePropertyIds !== null) {
    if (req.accessiblePropertyIds.length === 0) return res.json({ upcoming_checkouts: [], occupancy: [], gaps: [], pending_cleaning_jobs: [] });
    const ph = inParams(req.accessiblePropertyIds, 3);
    checkoutQuery += ` AND b.property_id IN (${ph})`;
    checkoutParams.push(...req.accessiblePropertyIds);
  }
  checkoutQuery += ' ORDER BY b.check_out ASC';
  const upcomingCheckouts = await getAll(checkoutQuery, checkoutParams);

  // Occupancy rate per property (next 30 days)
  let properties;
  if (req.accessiblePropertyIds === null) {
    properties = await getAll('SELECT * FROM properties');
  } else {
    const ph = inParams(req.accessiblePropertyIds, 1);
    properties = await getAll(`SELECT * FROM properties WHERE id IN (${ph})`, req.accessiblePropertyIds);
  }
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const occupancy = [];
  for (const p of properties) {
    const bookings = await getAll(
      `SELECT * FROM bookings
       WHERE property_id = $1 AND check_out >= $2 AND check_in <= $3 AND status = 'confirmed'
       AND platform NOT LIKE 'Blocked%'`,
      [p.id, today, thirtyDaysOut]
    );

    let bookedNights = 0;
    for (const b of bookings) {
      const start = new Date(Math.max(new Date(b.check_in), new Date(today)));
      const end = new Date(Math.min(new Date(b.check_out), new Date(thirtyDaysOut)));
      bookedNights += Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
    }
    const rate = Math.round((bookedNights / 30) * 100);
    occupancy.push({ property_id: p.id, name: p.name, occupancy_rate: rate, booked_nights: bookedNights });
  }

  // Gap detection: 1-3 night gaps between bookings
  const gaps = [];
  for (const p of properties) {
    const pBookings = await getAll(
      `SELECT * FROM bookings
       WHERE property_id = $1 AND check_out >= $2 AND status = 'confirmed'
       AND platform NOT LIKE 'Blocked%'
       ORDER BY check_in ASC`,
      [p.id, today]
    );

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

  // Cleaning jobs (scoped to accessible properties)
  let jobQuery = `SELECT cj.*, p.name as property_name, c.name as cleaner_name
     FROM cleaning_jobs cj
     JOIN properties p ON cj.property_id = p.id
     LEFT JOIN cleaners c ON cj.cleaner_id = c.id
     WHERE cj.cleaning_date >= $1 AND cj.status != 'completed'`;
  const jobParams = [today];
  if (req.accessiblePropertyIds !== null) {
    if (req.accessiblePropertyIds.length === 0) {
      jobQuery += ' AND 1=0';
    } else {
      const ph = inParams(req.accessiblePropertyIds, 2);
      jobQuery += ` AND cj.property_id IN (${ph})`;
      jobParams.push(...req.accessiblePropertyIds);
    }
  }
  jobQuery += ' ORDER BY cj.cleaning_date ASC';
  const pendingJobs = await getAll(jobQuery, jobParams);

  const displayCurrency = await getDisplayCurrency();
  await bulkConvert(upcomingCheckouts, displayCurrency);

  const lastSyncedRow = await getOne("SELECT value FROM app_settings WHERE key = 'last_synced_at'", []);

  res.json({
    upcoming_checkouts: upcomingCheckouts,
    occupancy,
    gaps,
    pending_cleaning_jobs: pendingJobs,
    display_currency: displayCurrency,
    last_synced_at: lastSyncedRow?.value || null,
  });
});

module.exports = router;
