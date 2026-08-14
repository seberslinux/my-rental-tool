const express = require('express');
const router = express.Router();
const { getAll, getOne, run, transaction, inParams } = require('../db/database');
const smoobu = require('../services/smoobu');
// The front page, answered once — see that module for what earns a place.
const { buildToday } = require('../services/today');
const { loadAvailability, cleanerDayStatus } = require('../services/availability');
// Whether the channel is switched on at all — see that module for why
// "off" and "broken" must not look the same.
const whatsapp = require('../services/whatsapp');
const { requireRole, scopeProperties, enforcePropertyScope, denyIfOutOfScope } = require('../middleware/auth');

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
const { syncRates } = require('../services/rate-sync');
// Net is computed in exactly one place — calcDeductions — which revenue.js
// and the analytics page also call. The calendar joins that path rather
// than growing its own, so a booking cannot be worth one number here and
// another in a report.
const { calcDeductions } = require('../services/analytics-calc');
const { recent: recentNotifications } = require('../services/notify');
const { STILL_ON_SQL } = require('../services/job-life');

/**
 * calcDeductions' input contract, as SQL.
 *
 * It reads per-property, per-platform commission, bank-charge and VAT
 * rates off the booking row, so every query feeding it must join the same
 * columns. Spelling them out per query meant a new fee column reached some
 * callers and not others — the deductions would then silently differ
 * between two screens showing the same booking.
 */
const FEE_COLUMNS = `
  p.vat_rate                 AS property_vat_rate,
  p.commission_airbnb        AS prop_commission_airbnb,
  p.commission_booking       AS prop_commission_booking,
  p.commission_vrbo          AS prop_commission_vrbo,
  p.bank_charge_airbnb, p.bank_charge_booking, p.bank_charge_vrbo,
  p.vat_airbnb, p.vat_booking, p.vat_vrbo`;

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

    // Rates come down in the same pass. They were previously synced only by
    // an endpoint nothing called, so daily_rates sat empty and the calendar
    // fell back to inventing prices from base_price. Failures here are
    // reported, not thrown: the bookings are already committed and are the
    // more important half.
    const rates = await syncRates({ apiKeyForProperty: () => apiKey });

    // A sync that half worked should say so.
    //
    // Rates failing per property returned in the response body and were
    // logged to a console nobody reads, while the same call reported
    // "Synced" for the bookings half. Smoobu answered every rate request
    // with 422 for months and the only symptom was empty cells — which
    // reads as "no price set", not as "this has never worked".
    if (rates.failures.length) {
      await notify({
        event: 'sync_incomplete',
        title: `Rates did not sync for ${rates.failures.length} propert${rates.failures.length === 1 ? 'y' : 'ies'}`,
        body: rates.failures.map((f) => `${f.property}: ${f.error}`).join(' · '),
        link: '/smoobu',
      });
    }

    // Record when this sync completed so the UI can show "Synced X ago"
    await run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_synced_at', NOW()::text, NOW())
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      []
    );

    res.json({
      synced: allBookings.length,
      rates_synced: rates.synced,
      rate_failures: rates.failures,
    });
  } catch (err) {
    console.error('Booking sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * The activity feed.
 *
 * In-app is the baseline channel: everything the app decides is worth
 * saying lands here whether or not anybody chose to be messaged as well.
 * Scoped to the properties the caller can see, so a manager with one
 * property does not read about another.
 */
/**
 * The front page, answered once.
 *
 * What needs somebody, and what is happening, from one pass over the
 * same rows. The screen used to compute both from four separate places —
 * a board, an attention list, a property card and a badge — which is how
 * a cleaner who had accepted a job showed as "No cleaner".
 */
router.get('/dashboard/today', scopeProperties, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);

  const scoped = req.accessiblePropertyIds;
  const properties = await getAll(
    scoped === null ? 'SELECT * FROM properties ORDER BY name' : 'SELECT * FROM properties WHERE id = ANY($1) ORDER BY name',
    scoped === null ? [] : [scoped]
  );
  if (properties.length === 0) return res.json({ needs: [], board: [] });
  const ids = properties.map((p) => p.id);

  const [stays, jobs, issues, blocks, supplies] = await Promise.all([
    getAll(
      `SELECT * FROM bookings WHERE property_id = ANY($1) AND check_out >= $2 AND check_in <= $3`,
      [ids, since, horizon]
    ),
    getAll(
      `SELECT cj.*, c.name AS cleaner_name FROM cleaning_jobs cj
         LEFT JOIN cleaners c ON c.id = cj.cleaner_id
        WHERE cj.property_id = ANY($1) AND cj.cleaning_date >= $2 AND cj.cleaning_date <= $3`,
      [ids, since, horizon]
    ),
    getAll(
      `SELECT id, property_id, title FROM maintenance_issues
        WHERE property_id = ANY($1) AND status = 'open' ORDER BY reported_date DESC LIMIT 5`,
      [ids]
    ),
    getAll(
      `SELECT * FROM blocked_dates WHERE property_id = ANY($1) AND released_at IS NULL`,
      [ids]
    ),
    // Both joins outer, for the same reason the cleaner's own list needs
    // them: added_by is null for a PIN cleaner and added_by_cleaner_id is
    // null for a user, so an inner join on either drops half the list.
    //
    // Rows with no property at all are left out rather than shown to
    // everybody. Scoping cannot prove one is yours, and this page is
    // behind property scoping precisely so it cannot show somebody
    // another owner's business.
    getAll(
      `SELECT s.id, s.property_id, s.item_name, s.quantity, s.unit, s.notes, s.created_at,
              COALESCE(u.name, c.name) AS added_by_name
         FROM shopping_list s
         LEFT JOIN users u ON u.id = s.added_by
         LEFT JOIN cleaners c ON c.id = s.added_by_cleaner_id
        WHERE s.property_id = ANY($1) AND s.status = 'needed'
        ORDER BY s.created_at ASC`,
      [ids]
    ),
  ]);

  // The same answer assignment uses, rather than a second opinion.
  const cleanerIds = [...new Set(jobs.map((j) => j.cleaner_id).filter(Boolean))];
  const av = await loadAvailability(cleanerIds);
  const isFree = (cleanerId, date) => cleanerDayStatus(av, cleanerId, date).available;

  // The clock, so a checkout that has already happened does not keep
  // announcing itself in the future tense.
  const now = new Date().toTimeString().slice(0, 5);
  // Why the next thirty nights might sell. Never allowed to take the
  // page down — the same rule the stats endpoint applies.
  let holidays = [];
  try {
    const [publicDays, schoolBreaks] = await Promise.all([
      getUpcomingHolidays(today, { countries: ['ZA'], days: 40 }),
      getUpcomingSchoolHolidays(today, { days: 40 }),
    ]);
    holidays = [
      ...publicDays.map((h) => ({
        start: h.date, end: h.date, name: h.name,
        label: h.country_name, kind: 'public',
      })),
      ...schoolBreaks.map((h) => ({
        start: h.start, end: h.end, name: h.name,
        label: h.region, kind: 'school',
      })),
    ];
  } catch (err) {
    console.error('Holiday lookup failed for /dashboard/today:', err.message);
  }

  res.json(buildToday({ properties, stays, jobs, issues, blocks, supplies, isFree, today, now, holidays }));
});

/**
 * The whole list, bought ones included.
 *
 * The front page carries what is outstanding, because that is what you
 * can still act on. This is the other question — "what has been asked
 * for, and did anybody get it" — and it needs the history the card
 * deliberately leaves out.
 *
 * The join on properties is inner, which drops rows with no property.
 * That is the same call the front page makes: scoping cannot prove such
 * a row is yours, so it fails closed rather than showing it to everyone.
 */
router.get('/supplies', scopeProperties, async (req, res) => {
  const scoped = req.accessiblePropertyIds;
  if (scoped !== null && scoped.length === 0) return res.json([]);

  const rows = await getAll(
    `SELECT s.id, s.property_id, p.name AS property, s.item_name, s.quantity, s.unit,
            s.notes, s.status, s.created_at, s.purchased_at,
            COALESCE(u.name, c.name) AS added_by_name
       FROM shopping_list s
       JOIN properties p ON p.id = s.property_id
       LEFT JOIN users u ON u.id = s.added_by
       LEFT JOIN cleaners c ON c.id = s.added_by_cleaner_id
      ${scoped === null ? '' : 'WHERE s.property_id = ANY($1)'}
      ORDER BY s.created_at DESC`,
    scoped === null ? [] : [scoped]
  );
  res.json(rows);
});

/**
 * Bought it.
 *
 * The cleaner portal has had a route for this since the list existed, but
 * it takes an id and updates it — no scoping at all — which is safe
 * enough among cleaners who only ever reach their own list and not safe
 * at all as the owner's button. This one checks the item's property is
 * one the caller can see before touching it.
 *
 * An item with no property is refused rather than allowed through: there
 * is nothing to check it against, and the scoping here fails closed by
 * design.
 */
router.patch('/supplies/:id/purchased', scopeProperties, async (req, res) => {
  const item = await getOne('SELECT id, property_id FROM shopping_list WHERE id = $1', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not on the list' });
  if (!item.property_id) {
    return res.status(403).json({ error: 'That item is not tied to a property' });
  }
  if (denyIfOutOfScope(req, res, item.property_id)) return;

  await run(
    "UPDATE shopping_list SET status = 'purchased', purchased_at = NOW() WHERE id = $1",
    [item.id]
  );
  res.json({ ok: true });
});

router.get('/notifications', scopeProperties, async (req, res) => {
  const rows = await recentNotifications({
    limit: req.query.limit,
    propertyIds: req.accessiblePropertyIds,
  });
  const unread = rows.filter((n) => !n.read_at).length;
  res.json({ notifications: rows, unread });
});

/**
 * Clear one, once it has been dealt with.
 *
 * "Mark all read" left every message on screen, greyer. A feed that only
 * grows is a feed people stop opening, and the one that mattered is then
 * the tenth item down.
 */
router.delete('/notifications/:id', scopeProperties, async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for cleaner sessions' });
  await run(
    `UPDATE notifications SET dismissed_at = NOW()
      WHERE id = $1 AND audience = 'owner'`,
    [req.params.id]
  );
  res.json({ ok: true });
});

/** Clear everything already read, in one go. */
router.post('/notifications/clear-read', scopeProperties, async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for cleaner sessions' });
  const rows = await getAll(
    `UPDATE notifications SET dismissed_at = NOW()
      WHERE audience = 'owner' AND read_at IS NOT NULL AND dismissed_at IS NULL
      RETURNING id`
  );
  res.json({ cleared: rows.length });
});

/** Mark one as read. */
router.post('/notifications/:id/read', scopeProperties, async (req, res) => {
  await run('UPDATE notifications SET read_at = NOW() WHERE id = $1 AND read_at IS NULL', [req.params.id]);
  res.json({ ok: true });
});

/** Mark everything read — the only humane option on a busy feed. */
router.post('/notifications/read-all', scopeProperties, async (req, res) => {
  await run('UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL');
  res.json({ ok: true });
});

/**
 * How this person wants to hear about things.
 *
 * In-app cannot be turned off, so it is not offered as a choice — the
 * feed is the record. WhatsApp is the decision, and it is per person
 * rather than per installation: an owner who wants their phone buzzing
 * and a manager who does not are both reasonable.
 */
router.get('/notifications/preferences', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for cleaner sessions' });
  const row = await getOne('SELECT phone, notify_whatsapp FROM users WHERE id = $1', [req.user.id]);
  res.json({
    whatsapp: !!(row && row.notify_whatsapp),
    // Turning it on without a number would be a setting that silently
    // does nothing, so the client is told.
    has_phone: !!(row && row.phone && row.phone.trim()),
    // And neither does turning it on while the channel itself is off.
    // Offering a switch that cannot do anything is how people conclude
    // the app is broken rather than that a feature is not set up.
    whatsapp_available: whatsapp.isConfigured(),
  });
});

router.put('/notifications/preferences', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for cleaner sessions' });
  const wanted = req.body.whatsapp ? 1 : 0;
  if (wanted) {
    const row = await getOne('SELECT phone FROM users WHERE id = $1', [req.user.id]);
    if (!row || !row.phone || !row.phone.trim()) {
      return res.status(400).json({ error: 'Add your phone number first, otherwise there is nowhere to send.' });
    }
  }
  await run('UPDATE users SET notify_whatsapp = $1 WHERE id = $2', [wanted, req.user.id]);
  res.json({ whatsapp: !!wanted });
});

/** Your own phone number, which is what WhatsApp alerts need. */
router.put('/notifications/phone', async (req, res) => {
  if (!req.user) return res.status(403).json({ error: 'Not available for cleaner sessions' });
  const phone = String(req.body.phone || '').trim();
  if (phone && !/^\+\d{10,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Use the full international form, e.g. +27821234567' });
  }
  await run('UPDATE users SET phone = $1 WHERE id = $2', [phone || null, req.user.id]);
  res.json({ phone: phone || null });
});

// Get all bookings from local DB
// The fee columns ride along so net payout can be computed here rather than
// in the client. The calendar was showing gross under the label "Total
// Payout" — R6,025 on a booking that actually pays out R4,951.
const BOOKING_FEE_COLUMNS = `p.name as property_name, ${FEE_COLUMNS}`;

router.get('/bookings', scopeProperties, async (req, res) => {
  let bookings;
  if (req.accessiblePropertyIds === null) {
    bookings = await getAll(
      `SELECT b.*, ${BOOKING_FEE_COLUMNS} FROM bookings b
       JOIN properties p ON b.property_id = p.id ORDER BY b.check_in ASC`
    );
  } else {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json({ bookings: [], display_currency: await getDisplayCurrency() });
    const ph = inParams(ids, 1);
    bookings = await getAll(
      `SELECT b.*, ${BOOKING_FEE_COLUMNS} FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.property_id IN (${ph}) ORDER BY b.check_in ASC`,
      ids
    );
  }
  const displayCurrency = await getDisplayCurrency();
  await bulkConvert(bookings, displayCurrency);

  // calcDeductions reads converted_* fields, so this must follow bulkConvert.
  for (const b of bookings) {
    const gross = b.converted_total_price || 0;
    const deductions = calcDeductions(b);
    b.deductions = Math.round(deductions * 100) / 100;
    b.net_payout = Math.round((gross - deductions) * 100) / 100;
  }

  res.json({ bookings, display_currency: displayCurrency });
});

/**
 * Nightly rates for the calendar's open days.
 *
 * Only days Smoobu has actually published are returned; the calendar draws
 * nothing where a day is missing. `available: 0` is Smoobu's own block flag,
 * which is not the same thing as a "Blocked channel" booking — a day can be
 * closed to arrivals without a block booking existing.
 */
router.get('/calendar/rates', scopeProperties, async (req, res) => {
  const from = req.query.from || new Date().toISOString().split('T')[0];
  const to = req.query.to || addDays(from, 180);

  const params = [from, to];
  let scope = '';
  if (req.accessiblePropertyIds !== null) {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json({ rates: [] });
    scope = ` AND property_id IN (${inParams(ids, 3)})`;
    params.push(...ids);
  }

  const rates = await getAll(
    `SELECT property_id, date, price, min_stay, available
       FROM daily_rates
      WHERE date >= $1 AND date <= $2${scope}
      ORDER BY property_id, date`,
    params
  );
  res.json({ rates });
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
     WHERE cj.cleaning_date >= $1 AND cj.${STILL_ON_SQL}`;
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
                ${FEE_COLUMNS}
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
