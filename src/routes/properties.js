const express = require('express');
const router = express.Router();
const { getAll, getOne, run, inParams } = require('../db/database');
const { scopeProperties, denyIfOutOfScope } = require('../middleware/auth');

// Apply property scoping to all routes
router.use(scopeProperties);

// Get all properties
router.get('/', async (req, res) => {
  let properties;
  if (req.accessiblePropertyIds === null) {
    properties = await getAll('SELECT * FROM properties ORDER BY name ASC');
  } else {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json([]);
    const ph = inParams(ids, 1);
    properties = await getAll(`SELECT * FROM properties WHERE id IN (${ph}) ORDER BY name ASC`, ids);
  }
  res.json(properties);
});

// Get a single property
router.get('/:id', async (req, res) => {
  if (req.accessiblePropertyIds !== null && !req.accessiblePropertyIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'Access denied to this property' });
  }
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  res.json(property);
});

// Get property performance summary
router.get('/:id/summary', async (req, res) => {
  if (req.accessiblePropertyIds !== null && !req.accessiblePropertyIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'Access denied to this property' });
  }
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const id = req.params.id;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // --- KPIs (last 30 days) ---

  // Revenue: sum of total_price for confirmed bookings overlapping last 30 days
  const revenue30dRow = await getOne(`
    SELECT COALESCE(SUM(total_price), 0) AS val FROM bookings
    WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);
  const revenue30d = revenue30dRow.val;

  // Booked nights in last 30 days
  const bookings30d = await getAll(`
    SELECT check_in, check_out FROM bookings
    WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);

  let bookedNights = 0;
  for (const b of bookings30d) {
    const start = new Date(Math.max(new Date(b.check_in).getTime(), new Date(thirtyDaysAgo).getTime()));
    const end = new Date(Math.min(new Date(b.check_out).getTime(), new Date(today).getTime()));
    const nights = Math.max(0, Math.round((end - start) / 86400000));
    bookedNights += nights;
  }
  const occupancy30d = Math.min(100, (bookedNights / 30) * 100);

  // Average nightly rate
  const avgRate30dRow = await getOne(`
    SELECT COALESCE(AVG(price_per_night), 0) AS val FROM bookings
    WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3 AND price_per_night > 0
  `, [id, today, thirtyDaysAgo]);
  const avgRate30d = avgRate30dRow.val;

  // Net profit: revenue - expenses in last 30 days
  const expenses30dRow = await getOne(`
    SELECT COALESCE(SUM(amount), 0) AS val FROM expenses
    WHERE property_id = $1 AND expense_date >= $2 AND expense_date <= $3
  `, [id, thirtyDaysAgo, today]);
  const expenses30d = expenses30dRow.val;
  const netProfit30d = revenue30d - expenses30d;

  // Cancellation rate
  const totalBookings30dRow = await getOne(`
    SELECT COUNT(*) AS val FROM bookings
    WHERE property_id = $1 AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);
  const totalBookings30d = totalBookings30dRow.val;
  const cancelledBookings30dRow = await getOne(`
    SELECT COUNT(*) AS val FROM bookings
    WHERE property_id = $1 AND status = 'cancelled' AND check_in <= $2 AND check_out >= $3
  `, [id, today, thirtyDaysAgo]);
  const cancelledBookings30d = cancelledBookings30dRow.val;
  const cancellationRate30d = totalBookings30d > 0 ? (cancelledBookings30d / totalBookings30d) * 100 : 0;

  // --- Monthly data (last 12 months) ---
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const monthStr = `${year}-${month}`;
    const monthStart = `${monthStr}-01`;
    // End of month
    const nextMonth = new Date(year, d.getMonth() + 1, 1);
    const monthEnd = new Date(nextMonth - 86400000).toISOString().slice(0, 10);
    const daysInMonth = new Date(nextMonth - 86400000).getDate();

    const mRev = await getOne(`
      SELECT COALESCE(SUM(total_price), 0) AS revenue, COUNT(*) AS booking_count,
             COALESCE(AVG(CASE WHEN price_per_night > 0 THEN price_per_night END), 0) AS avg_rate
      FROM bookings
      WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
    `, [id, monthEnd, monthStart]);

    // Occupancy for this month
    const mBookings = await getAll(`
      SELECT check_in, check_out FROM bookings
      WHERE property_id = $1 AND status != 'cancelled' AND check_in <= $2 AND check_out >= $3
    `, [id, monthEnd, monthStart]);
    let mNights = 0;
    for (const b of mBookings) {
      const s = new Date(Math.max(new Date(b.check_in).getTime(), new Date(monthStart).getTime()));
      const e = new Date(Math.min(new Date(b.check_out).getTime(), nextMonth.getTime()));
      mNights += Math.max(0, Math.round((e - s) / 86400000));
    }

    monthly.push({
      month: monthStr,
      revenue: mRev.revenue,
      occupancy_pct: Math.min(100, (mNights / daysInMonth) * 100),
      avg_rate: mRev.avg_rate,
      booking_count: mRev.booking_count,
    });
  }

  // --- Upcoming bookings ---
  const upcomingBookings = await getAll(`
    SELECT guest_name, check_in, check_out, length_of_stay AS nights, platform, total_price
    FROM bookings
    WHERE property_id = $1 AND status = 'confirmed' AND check_in >= $2
    ORDER BY check_in ASC
  `, [id, today]);

  // --- Recent reviews ---
  const recentReviews = await getAll(`
    SELECT guest_name, rating, comment, review_date, platform
    FROM reviews
    WHERE property_id = $1
    ORDER BY review_date DESC
    LIMIT 5
  `, [id]);

  res.json({
    property,
    kpis: {
      revenue_30d: revenue30d,
      occupancy_30d: Math.round(occupancy30d * 100) / 100,
      avg_nightly_rate_30d: Math.round(avgRate30d * 100) / 100,
      net_profit_30d: Math.round(netProfit30d * 100) / 100,
      cancellation_rate_30d: Math.round(cancellationRate30d * 100) / 100,
    },
    monthly,
    upcoming_bookings: upcomingBookings,
    recent_reviews: recentReviews,
  });
});

// Update property settings
router.put('/:id', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.id)) return;
  const property = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const fields = ['address','cleaning_hours_required','base_price','base_currency','airbnb_url','airbnb_id','booking_url','booking_id_ext','vrbo_url','vrbo_id','commission_airbnb','commission_booking','commission_vrbo','bank_charge_airbnb','bank_charge_booking','bank_charge_vrbo','vat_rate','vat_airbnb','vat_booking','vat_vrbo','property_type','bedrooms','bathrooms','max_guests','location','neighbourhood','wifi_network','wifi_password','access_code','checkin_instructions','checkout_instructions','supply_checklist','emergency_contact'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${values.length + 1}`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    await run(`UPDATE properties SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  }

  const updated = await getOne('SELECT * FROM properties WHERE id = $1', [req.params.id]);
  res.json(updated);
});

// --- Property Sharing ---

// GET /api/properties/:id/users — list users with access
router.get('/:id/users', async (req, res) => {
  try {
    const rows = await getAll(
      `SELECT up.user_id, up.role, u.name, u.email
       FROM user_properties up JOIN users u ON up.user_id = u.id
       WHERE up.property_id = $1 ORDER BY up.role ASC, u.name ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/properties/:id/share — share property with a user
router.post('/:id/share', async (req, res) => {
  try {
    const propertyId = parseInt(req.params.id);
    const { user_id, role } = req.body;
    if (!user_id || !['manager', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'user_id and role (manager/viewer) required' });
    }

    // Only owner or admin can share
    const isOwner = req.propertyRoles && req.propertyRoles.get(propertyId) === 'owner';
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the property owner can share access' });
    }

    await run(
      `INSERT INTO user_properties (user_id, property_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, property_id) DO UPDATE SET role = EXCLUDED.role`,
      [user_id, propertyId, role]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/properties/:id/share/:userId — remove a user's access
router.delete('/:id/share/:userId', async (req, res) => {
  try {
    const propertyId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);

    // Cannot remove owner
    const existing = await getOne(
      'SELECT role FROM user_properties WHERE user_id = $1 AND property_id = $2',
      [userId, propertyId]
    );
    if (existing && existing.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove the property owner' });
    }

    // Only owner or admin can remove
    const isOwner = req.propertyRoles && req.propertyRoles.get(propertyId) === 'owner';
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the property owner can remove access' });
    }

    await run(
      'DELETE FROM user_properties WHERE user_id = $1 AND property_id = $2',
      [userId, propertyId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
