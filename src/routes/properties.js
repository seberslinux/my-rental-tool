const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { scopeProperties } = require('../middleware/auth');

// Apply property scoping to all routes
router.use(scopeProperties);

// Get all properties
router.get('/', (req, res) => {
  const db = getDb();
  let properties;
  if (req.accessiblePropertyIds === null) {
    properties = db.prepare('SELECT * FROM properties ORDER BY name ASC').all();
  } else {
    const ids = req.accessiblePropertyIds;
    if (ids.length === 0) return res.json([]);
    const placeholders = ids.map(() => '?').join(',');
    properties = db.prepare(`SELECT * FROM properties WHERE id IN (${placeholders}) ORDER BY name ASC`).all(...ids);
  }
  res.json(properties);
});

// Get a single property
router.get('/:id', (req, res) => {
  const db = getDb();
  if (req.accessiblePropertyIds !== null && !req.accessiblePropertyIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'Access denied to this property' });
  }
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  res.json(property);
});

// Get property performance summary
router.get('/:id/summary', (req, res) => {
  const db = getDb();
  if (req.accessiblePropertyIds !== null && !req.accessiblePropertyIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'Access denied to this property' });
  }
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const id = req.params.id;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // --- KPIs (last 30 days) ---

  // Revenue: sum of total_price for confirmed bookings overlapping last 30 days
  const revenue30d = db.prepare(`
    SELECT COALESCE(SUM(total_price), 0) AS val FROM bookings
    WHERE property_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ?
  `).get(id, today, thirtyDaysAgo).val;

  // Booked nights in last 30 days
  const bookings30d = db.prepare(`
    SELECT check_in, check_out FROM bookings
    WHERE property_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ?
  `).all(id, today, thirtyDaysAgo);

  let bookedNights = 0;
  for (const b of bookings30d) {
    const start = new Date(Math.max(new Date(b.check_in).getTime(), new Date(thirtyDaysAgo).getTime()));
    const end = new Date(Math.min(new Date(b.check_out).getTime(), new Date(today).getTime()));
    const nights = Math.max(0, Math.round((end - start) / 86400000));
    bookedNights += nights;
  }
  const occupancy30d = Math.min(100, (bookedNights / 30) * 100);

  // Average nightly rate
  const avgRate30d = db.prepare(`
    SELECT COALESCE(AVG(price_per_night), 0) AS val FROM bookings
    WHERE property_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ? AND price_per_night > 0
  `).get(id, today, thirtyDaysAgo).val;

  // Net profit: revenue - expenses in last 30 days
  const expenses30d = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS val FROM expenses
    WHERE property_id = ? AND expense_date >= ? AND expense_date <= ?
  `).get(id, thirtyDaysAgo, today).val;
  const netProfit30d = revenue30d - expenses30d;

  // Cancellation rate
  const totalBookings30d = db.prepare(`
    SELECT COUNT(*) AS val FROM bookings
    WHERE property_id = ? AND check_in <= ? AND check_out >= ?
  `).get(id, today, thirtyDaysAgo).val;
  const cancelledBookings30d = db.prepare(`
    SELECT COUNT(*) AS val FROM bookings
    WHERE property_id = ? AND status = 'cancelled' AND check_in <= ? AND check_out >= ?
  `).get(id, today, thirtyDaysAgo).val;
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

    const mRev = db.prepare(`
      SELECT COALESCE(SUM(total_price), 0) AS revenue, COUNT(*) AS booking_count,
             COALESCE(AVG(CASE WHEN price_per_night > 0 THEN price_per_night END), 0) AS avg_rate
      FROM bookings
      WHERE property_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ?
    `).get(id, monthEnd, monthStart);

    // Occupancy for this month
    const mBookings = db.prepare(`
      SELECT check_in, check_out FROM bookings
      WHERE property_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ?
    `).all(id, monthEnd, monthStart);
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
  const upcomingBookings = db.prepare(`
    SELECT guest_name, check_in, check_out, length_of_stay AS nights, platform, total_price
    FROM bookings
    WHERE property_id = ? AND status = 'confirmed' AND check_in >= ?
    ORDER BY check_in ASC
  `).all(id, today);

  // --- Recent reviews ---
  const recentReviews = db.prepare(`
    SELECT guest_name, rating, comment, review_date, platform
    FROM reviews
    WHERE property_id = ?
    ORDER BY review_date DESC
    LIMIT 5
  `).all(id);

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
router.put('/:id', (req, res) => {
  const db = getDb();
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const fields = ['address','cleaning_hours_required','base_price','base_currency','airbnb_url','airbnb_id','booking_url','booking_id_ext','vrbo_url','vrbo_id','commission_airbnb','commission_booking','commission_vrbo','bank_charge_airbnb','bank_charge_booking','bank_charge_vrbo','vat_rate','property_type','bedrooms','bathrooms','max_guests','location','neighbourhood','wifi_network','wifi_password','access_code','checkin_instructions','checkout_instructions','supply_checklist','emergency_contact'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
