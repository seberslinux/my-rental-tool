const express = require('express');
const router = express.Router();
const { getAll, getOne, run, transaction, inParams } = require('../db/database');
const smoobu = require('../services/smoobu');
const { requireRole, scopeProperties, enforcePropertyScope } = require('../middleware/auth');

// Parse ?property_id= query param — comma-separated list or 'all' → null.
// Returns null for "no explicit filter" (server-side scoping will still apply).
function parsePropertyIds(raw) {
  if (!raw || raw === 'all') return null;
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}
const { detectCurrency } = require('../services/currency-detect');
const { bulkConvert, getDisplayCurrency } = require('../services/exchange-rates');
const { getApiKeyForUser } = require('../services/api-key-resolver');
const { occupancyByProperty, forwardOccupancy, detectGaps, addDays } = require('../services/dashboard-calc');
// All revenue figures resolve through this one module — see its header for
// the attribution rule. Analytics uses the same functions.
const { revenueEarned, revenueComing, avgRateEarned } = require('../services/revenue');
const { getUpcomingHolidays } = require('../services/holidays-store');
const { getUpcomingSchoolHolidays } = require('../services/school-holidays');
// One mapper for every Smoobu write path — see its header for why.
const { mapSmoobuBooking } = require('../services/smoobu-mapper');

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
        const row = mapSmoobuBooking(b, { propertyCurrencyBySmoobuId: propCurrencyMap });

        await client.query(
          `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out,
             platform, total_price, status, num_guests, created_at, lead_time_days,
             length_of_stay, price_per_night, currency, modified_at, commission,
             children, language, guest_country, raw_payload)
           VALUES ($1, (SELECT id FROM properties WHERE smoobu_id = $2), $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
             modified_at = excluded.modified_at,
             commission = excluded.commission,
             children = excluded.children,
             language = excluded.language,
             guest_country = excluded.guest_country,
             raw_payload = excluded.raw_payload`,
          [
            row.smoobu_id, row.apartment_smoobu_id, row.guest_name, row.check_in,
            row.check_out, row.platform, row.total_price, row.status, row.num_guests,
            row.created_at, row.lead_time_days, row.length_of_stay, row.price_per_night,
            row.currency, row.modified_at, row.commission, row.children, row.language,
            row.guest_country, row.raw_payload,
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

  // Occupancy rate per property (next 30 days) and 1-3 night gap detection.
  // Single scoped query for all bookings from today onwards; JS derivations
  // via dashboard-calc so the same code path is covered by unit tests.
  let properties;
  if (req.accessiblePropertyIds === null) {
    properties = await getAll('SELECT * FROM properties');
  } else {
    const ph = inParams(req.accessiblePropertyIds, 1);
    properties = await getAll(`SELECT * FROM properties WHERE id IN (${ph})`, req.accessiblePropertyIds);
  }
  const thirtyDaysOut = addDays(today, 30);

  // Fetch all future-relevant bookings for the scoped properties in one query.
  const propertyIds = properties.map((p) => p.id);
  let futureBookings = [];
  if (propertyIds.length > 0) {
    const ph = inParams(propertyIds, 2);
    futureBookings = await getAll(
      `SELECT property_id, check_in, check_out, platform, status
         FROM bookings
        WHERE status = 'confirmed'
          AND check_out >= $1
          AND property_id IN (${ph})
        ORDER BY check_in ASC`,
      [today, ...propertyIds]
    );
  }

  const propertyNamesById = new Map(properties.map((p) => [p.id, p.name]));
  const occupancy = occupancyByProperty(futureBookings, propertyIds, today, 30).map((row) => ({
    property_id: row.property_id,
    name: propertyNamesById.get(row.property_id),
    occupancy_rate: row.occupancy_rate,
    booked_nights: row.booked_nights,
  }));

  const gaps = detectGaps(futureBookings, today, { minNights: 1, maxNights: 3 }).map((g) => ({
    ...g,
    property_name: propertyNamesById.get(g.property_id),
  }));

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

  // Two kinds of holiday answer different questions, so each contributes
  // only where it means something:
  //
  //   ZA public — cleaner availability and local weekend demand
  //   ZA school — domestic family travel
  //   DE school — inbound demand, split into Hamburg and Bavaria rather
  //      than aggregated: the sixteen states stagger deliberately, so a
  //      national view smears into "sometime in summer" and prices nothing.
  //
  // Neither lookup may take down the dashboard.
  let holidays = [];
  try {
    const [publicDays, schoolBreaks] = await Promise.all([
      getUpcomingHolidays(today, { countries: ['ZA'], days: 90 }),
      getUpcomingSchoolHolidays(today, { days: 150 }),
    ]);

    holidays = [
      ...publicDays.map((h) => ({
        start: h.date,
        end: h.date,
        name: h.name,
        label: h.country_name,
        is_local: h.is_local,
        kind: 'public',
      })),
      ...schoolBreaks.map((h) => ({
        start: h.start,
        end: h.end,
        name: h.name,
        label: h.region,
        is_local: h.country === 'ZA',
        kind: 'school',
      })),
    ].sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
  } catch (err) {
    console.error('Holiday lookup failed:', err.message);
  }

  res.json({
    upcoming_checkouts: upcomingCheckouts,
    occupancy,
    gaps,
    holidays,
    pending_cleaning_jobs: pendingJobs,
    display_currency: displayCurrency,
    last_synced_at: lastSyncedRow?.value || null,
  });
});

// Dashboard KPIs (currency-corrected, server-side).
//
// Response shape:
//   {
//     display_currency: 'ZAR',
//     revenue_earned:   { value, prior_value, change_pct },
//     revenue_coming:   { value },
//     avg_rate:         { value, prior_value, change_pct },
//     occupancy:        { value, prior_value, change_pct },
//   }
//
// "Earned" = confirmed non-blocked stays whose check_out is in the last 30
// days. "Coming" = check_out in the future (in-progress + not-yet-arrived).
// Sums use `converted_total_price` so mixed-currency portfolios are safe.
router.get('/dashboard/kpis', scopeProperties, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const displayCurrency = await getDisplayCurrency();

    // Property scope. Two inputs:
    //   1. User's accessible properties (from scopeProperties middleware).
    //   2. Requested property_id filter from the query string.
    // enforcePropertyScope intersects them: honours the filter when
    // present, denies out-of-scope requests, and falls through to full
    // user scope when no filter is set.
    const requested = parsePropertyIds(req.query.property_id);
    const scopedIds = enforcePropertyScope(req, requested);

    const emptyKpis = {
      display_currency: displayCurrency,
      revenue_earned: { value: 0, prior_value: 0, change_pct: 0 },
      revenue_coming: { value: 0 },
      avg_rate:       { value: 0, prior_value: 0, change_pct: 0 },
      occupancy:      { value: 0, prior_value: 0, change_pct: 0 },
      forward_occupancy: [],
    };

    let properties;
    if (scopedIds === null) {
      // Admin, no filter — every property in the system.
      properties = await getAll('SELECT * FROM properties');
    } else if (scopedIds.length === 0) {
      // User has no accessible properties, or requested only properties
      // they don't own → nothing to compute.
      return res.json(emptyKpis);
    } else {
      const ph = inParams(scopedIds, 1);
      properties = await getAll(`SELECT * FROM properties WHERE id IN (${ph})`, scopedIds);
    }

    // Fetch every confirmed booking whose stay overlaps the 60-day earned
    // window OR is in the future. One scoped query, JS math via the
    // dashboard-calc helpers. Joins in the per-property fee rates so
    // calcDeductions can compute net revenue.
    const priorFrom = addDays(today, -60);
    const propertyIds = properties.map((p) => p.id);
    let bookings = [];
    if (propertyIds.length > 0) {
      const ph = inParams(propertyIds, 2);
      bookings = await getAll(
        `SELECT b.check_in, b.check_out, b.total_price, b.price_per_night, b.currency,
                b.platform, b.status, b.property_id, b.commission,
                p.vat_rate                 AS property_vat_rate,
                p.commission_airbnb        AS prop_commission_airbnb,
                p.commission_booking       AS prop_commission_booking,
                p.commission_vrbo          AS prop_commission_vrbo,
                p.bank_charge_airbnb, p.bank_charge_booking, p.bank_charge_vrbo,
                p.vat_airbnb, p.vat_booking, p.vat_vrbo
           FROM bookings b
           JOIN properties p ON b.property_id = p.id
          WHERE b.status = 'confirmed'
            AND b.check_out >= $1
            AND b.property_id IN (${ph})`,
        [priorFrom, ...propertyIds]
      );
    }
    // Fill in converted_total_price / converted_price_per_night /
    // converted_commission on each row.
    await bulkConvert(bookings, displayCurrency);

    const NET = { net: true };
    const priorToday = addDays(today, -30);

    const earned = revenueEarned(bookings, today, 30);
    const earnedNet = revenueEarned(bookings, today, 30, NET);
    const priorEarnedNet = revenueEarned(bookings, priorToday, 30, NET);
    const coming = revenueComing(bookings, today);
    const comingNet = revenueComing(bookings, today, NET);
    const avgRate = avgRateEarned(bookings, today, 30);
    const priorAvgRate = avgRateEarned(bookings, priorToday, 30);

    // Occupancy uses the /dashboard/stats math to stay consistent with the
    // "Occupancy per property" list on the same page.
    const nowOcc = occupancyByProperty(bookings, propertyIds, today, 30);
    const priorOcc = occupancyByProperty(bookings, propertyIds, addDays(today, -30), 30);
    const avgOccupancy = nowOcc.length > 0
      ? Math.round(nowOcc.reduce((s, o) => s + o.occupancy_rate, 0) / nowOcc.length)
      : 0;
    const priorOccupancy = priorOcc.length > 0
      ? Math.round(priorOcc.reduce((s, o) => s + o.occupancy_rate, 0) / priorOcc.length)
      : 0;

    // Forward occupancy over the booking window (see dashboard-calc for why
    // three months). Uses the same booking set — the query has no upper
    // bound on check_out, so every future stay is already loaded.
    const outlook = forwardOccupancy(bookings, properties.length, today, 3);

    const pctChange = (now, prior) => (prior > 0 ? Math.round(((now - prior) / prior) * 100) : 0);

    // `value` on revenue_earned / revenue_coming is NET (after commission +
    // bank + VAT). Gross is exposed alongside so the UI can show both.
    res.json({
      display_currency: displayCurrency,
      revenue_earned: {
        value: Math.round(earnedNet),
        gross: Math.round(earned),
        prior_value: Math.round(priorEarnedNet),
        change_pct: pctChange(earnedNet, priorEarnedNet),
      },
      revenue_coming: {
        value: Math.round(comingNet),
        gross: Math.round(coming),
      },
      avg_rate: {
        value: avgRate,
        prior_value: priorAvgRate,
        change_pct: pctChange(avgRate, priorAvgRate),
      },
      occupancy: {
        value: avgOccupancy,
        prior_value: priorOccupancy,
        change_pct: pctChange(avgOccupancy, priorOccupancy),
      },
      forward_occupancy: outlook,
    });
  } catch (err) {
    console.error('KPI computation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
