const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const smoobu = require('../services/smoobu');

// Helper: parse property_id param (supports comma-separated IDs or 'all')
function parsePropertyIds(raw) {
  if (!raw || raw === 'all') return null; // null means no filter
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function addPropertyFilter(propIds, column, params) {
  if (!propIds) return '';
  const placeholders = propIds.map(() => '?').join(',');
  propIds.forEach(id => params.push(id));
  return ` AND ${column} IN (${placeholders})`;
}

// Sync rates from Smoobu for analytics (GET only, no writes to Smoobu)
router.post('/sync-rates', async (req, res) => {
  try {
    const db = getDb();
    const properties = db.prepare('SELECT * FROM properties').all();
    const today = new Date().toISOString().split('T')[0];
    const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    let totalSynced = 0;

    const upsert = db.prepare(`
      INSERT INTO daily_rates (property_id, date, price, min_stay, available)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(property_id, date) DO UPDATE SET
        price = excluded.price,
        min_stay = excluded.min_stay,
        available = excluded.available,
        fetched_at = datetime('now')
    `);

    for (const p of properties) {
      try {
        const ratesData = await smoobu.getRates(p.smoobu_id, today, sixtyDaysOut);
        // Smoobu returns rates keyed by apartment ID
        const apartmentRates = ratesData?.data?.[p.smoobu_id] || ratesData?.[p.smoobu_id] || {};

        const transaction = db.transaction((rates) => {
          for (const [date, info] of Object.entries(rates)) {
            const price = info?.price || info?.daily_price || 0;
            const minStay = info?.min_length_of_stay || info?.minLengthOfStay || 1;
            const available = info?.available !== undefined ? (info.available ? 1 : 0) : 1;
            upsert.run(p.id, date, price, minStay, available);
            totalSynced++;
          }
        });

        transaction(apartmentRates);
      } catch (err) {
        console.error(`Rate sync failed for ${p.name}:`, err.message);
      }
    }

    res.json({ synced: totalSynced });
  } catch (err) {
    console.error('Rate sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sync historical bookings (wider range for analytics)
router.post('/sync-history', async (req, res) => {
  try {
    const db = getDb();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const threeMonthsOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const allBookings = await smoobu.getAllBookings({ from: oneYearAgo, to: threeMonthsOut });

    const upsert = db.prepare(`
      INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, created_at, lead_time_days, length_of_stay, price_per_night)
      VALUES (?, (SELECT id FROM properties WHERE smoobu_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(smoobu_id) DO UPDATE SET
        guest_name = excluded.guest_name, check_in = excluded.check_in,
        check_out = excluded.check_out, platform = excluded.platform,
        total_price = excluded.total_price, status = excluded.status,
        num_guests = excluded.num_guests, created_at = excluded.created_at,
        lead_time_days = excluded.lead_time_days, length_of_stay = excluded.length_of_stay,
        price_per_night = excluded.price_per_night
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

        upsert.run(
          b.id,
          b['apartment']?.id || b.apartmentId,
          b['guest-name'] || b.guestName || '',
          checkIn, checkOut, platform, price,
          b.type === 'cancellation' ? 'cancelled' : 'confirmed',
          b['adults'] || b.adults || 1,
          createdAt, leadTime, los, ppn
        );
      }
    });

    transaction(allBookings);
    res.json({ synced: allBookings.length });
  } catch (err) {
    console.error('History sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get full analytics data
router.get('/data', (req, res) => {
  const db = getDb();
  const properties = db.prepare('SELECT * FROM properties').all();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const { property_id, from, to } = req.query;
  const propIds = parsePropertyIds(property_id);

  // Build dynamic filter
  let bookingFilters = '';
  const bookingParams = [];
  bookingFilters += addPropertyFilter(propIds, 'b.property_id', bookingParams);
  if (from) {
    bookingFilters += ' AND b.check_in >= ?';
    bookingParams.push(from);
  }
  if (to) {
    bookingFilters += ' AND b.check_in <= ?';
    bookingParams.push(to);
  }

  // All confirmed bookings
  const allBookings = db
    .prepare(
      `SELECT b.*, p.name as property_name FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.status = 'confirmed'${bookingFilters}
       ORDER BY b.check_in ASC`
    )
    .all(...bookingParams);

  // --- Revenue by month ---
  const revenueByMonth = {};
  for (const b of allBookings) {
    const month = b.check_in.substring(0, 7); // YYYY-MM
    if (!revenueByMonth[month]) revenueByMonth[month] = { month, total: 0, bookings: 0, nights: 0 };
    revenueByMonth[month].total += b.total_price || 0;
    revenueByMonth[month].bookings += 1;
    revenueByMonth[month].nights += b.length_of_stay || 1;
  }
  const revenueTimeline = Object.values(revenueByMonth).sort((a, b) => a.month.localeCompare(b.month));

  // --- Revenue by property ---
  const revenueByProperty = {};
  for (const b of allBookings) {
    const key = b.property_name;
    if (!revenueByProperty[key]) revenueByProperty[key] = { property: key, property_id: b.property_id, total: 0, bookings: 0, nights: 0 };
    revenueByProperty[key].total += b.total_price || 0;
    revenueByProperty[key].bookings += 1;
    revenueByProperty[key].nights += b.length_of_stay || 1;
  }

  // --- Channel performance ---
  const channelStats = {};
  for (const b of allBookings) {
    const ch = normalizePlatform(b.platform);
    if (!channelStats[ch]) channelStats[ch] = { channel: ch, revenue: 0, bookings: 0, nights: 0, avg_ppn: 0, avg_los: 0, avg_lead_time: 0, total_ppn: 0, total_lead: 0 };
    channelStats[ch].revenue += b.total_price || 0;
    channelStats[ch].bookings += 1;
    channelStats[ch].nights += b.length_of_stay || 1;
    channelStats[ch].total_ppn += b.price_per_night || 0;
    channelStats[ch].total_lead += b.lead_time_days || 0;
  }
  for (const ch of Object.values(channelStats)) {
    ch.avg_ppn = ch.bookings > 0 ? Math.round(ch.total_ppn / ch.bookings) : 0;
    ch.avg_los = ch.bookings > 0 ? Math.round((ch.nights / ch.bookings) * 10) / 10 : 0;
    ch.avg_lead_time = ch.bookings > 0 ? Math.round(ch.total_lead / ch.bookings) : 0;
    delete ch.total_ppn;
    delete ch.total_lead;
  }

  // --- Occupancy by month per property ---
  const occupancyByMonth = {};
  for (const p of properties) {
    const pBookings = allBookings.filter((b) => b.property_id === p.id);
    for (const b of pBookings) {
      let d = new Date(b.check_in);
      const end = new Date(b.check_out);
      while (d < end) {
        const month = d.toISOString().substring(0, 7);
        const key = `${p.id}-${month}`;
        if (!occupancyByMonth[key]) occupancyByMonth[key] = { property_id: p.id, property: p.name, month, nights: 0 };
        occupancyByMonth[key].nights += 1;
        d.setDate(d.getDate() + 1);
      }
    }
  }
  const occupancyTimeline = Object.values(occupancyByMonth).sort((a, b) =>
    a.month.localeCompare(b.month) || a.property.localeCompare(b.property)
  );

  // Add days_in_month and rate
  for (const o of occupancyTimeline) {
    const [y, m] = o.month.split('-').map(Number);
    o.days_in_month = new Date(y, m, 0).getDate();
    o.occupancy_rate = Math.round((o.nights / o.days_in_month) * 100);
  }

  // --- ADR (Average Daily Rate) by month ---
  const adrByMonth = {};
  for (const b of allBookings) {
    const month = b.check_in.substring(0, 7);
    if (!adrByMonth[month]) adrByMonth[month] = { month, total_revenue: 0, total_nights: 0 };
    adrByMonth[month].total_revenue += b.total_price || 0;
    adrByMonth[month].total_nights += b.length_of_stay || 1;
  }
  const adrTimeline = Object.entries(adrByMonth)
    .map(([month, d]) => ({ month, adr: d.total_nights > 0 ? Math.round(d.total_revenue / d.total_nights) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // --- Day-of-week analysis ---
  const dowStats = Array.from({ length: 7 }, (_, i) => ({ day: i, bookings_starting: 0, revenue: 0, nights: 0 }));
  for (const b of allBookings) {
    const dow = new Date(b.check_in).getDay();
    dowStats[dow].bookings_starting += 1;
    dowStats[dow].revenue += b.total_price || 0;
    dowStats[dow].nights += b.length_of_stay || 1;
  }

  // --- Length of stay distribution ---
  const losDistribution = {};
  for (const b of allBookings) {
    const los = b.length_of_stay || 1;
    const bucket = los >= 7 ? '7+' : String(los);
    if (!losDistribution[bucket]) losDistribution[bucket] = { nights: bucket, count: 0, revenue: 0 };
    losDistribution[bucket].count += 1;
    losDistribution[bucket].revenue += b.total_price || 0;
  }

  // --- Lead time distribution ---
  const leadTimeDistribution = {};
  const leadBuckets = [[0, 1, '0-1 days'], [2, 7, '2-7 days'], [8, 14, '8-14 days'], [15, 30, '15-30 days'], [31, 60, '31-60 days'], [61, 9999, '60+ days']];
  for (const b of allBookings) {
    const lt = b.lead_time_days || 0;
    for (const [min, max, label] of leadBuckets) {
      if (lt >= min && lt <= max) {
        if (!leadTimeDistribution[label]) leadTimeDistribution[label] = { bucket: label, count: 0, avg_ppn: 0, total_ppn: 0 };
        leadTimeDistribution[label].count += 1;
        leadTimeDistribution[label].total_ppn += b.price_per_night || 0;
        break;
      }
    }
  }
  for (const lt of Object.values(leadTimeDistribution)) {
    lt.avg_ppn = lt.count > 0 ? Math.round(lt.total_ppn / lt.count) : 0;
    delete lt.total_ppn;
  }

  // --- Cancellation rate ---
  let cancelFilters = '';
  const cancelParams = [];
  cancelFilters += addPropertyFilter(propIds, 'property_id', cancelParams);
  if (from) {
    cancelFilters += ' AND check_in >= ?';
    cancelParams.push(from);
  }
  if (to) {
    cancelFilters += ' AND check_in <= ?';
    cancelParams.push(to);
  }
  const allBookingsIncCancelled = db
    .prepare(`SELECT status, platform FROM bookings WHERE 1=1${cancelFilters}`)
    .all(...cancelParams);
  const totalBookings = allBookingsIncCancelled.length;
  const cancelled = allBookingsIncCancelled.filter((b) => b.status === 'cancelled').length;
  const cancellationRate = totalBookings > 0 ? Math.round((cancelled / totalBookings) * 100) : 0;

  const cancellationsByChannel = {};
  for (const b of allBookingsIncCancelled) {
    const ch = normalizePlatform(b.platform);
    if (!cancellationsByChannel[ch]) cancellationsByChannel[ch] = { channel: ch, total: 0, cancelled: 0 };
    cancellationsByChannel[ch].total += 1;
    if (b.status === 'cancelled') cancellationsByChannel[ch].cancelled += 1;
  }
  for (const c of Object.values(cancellationsByChannel)) {
    c.rate = c.total > 0 ? Math.round((c.cancelled / c.total) * 100) : 0;
  }

  // --- Price trends (daily_rates table) ---
  const priceTrends = db
    .prepare(
      `SELECT dr.date, dr.price, dr.available, p.name as property_name, p.id as property_id
       FROM daily_rates dr
       JOIN properties p ON dr.property_id = p.id
       ORDER BY dr.date ASC`
    )
    .all();

  // --- RevPAR by month (Revenue Per Available Room-night) ---
  const revparByMonth = {};
  for (const entry of revenueTimeline) {
    const [y, m] = entry.month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const totalAvailableNights = daysInMonth * properties.length;
    revparByMonth[entry.month] = {
      month: entry.month,
      revpar: totalAvailableNights > 0 ? Math.round(entry.total / totalAvailableNights) : 0,
      revenue: entry.total,
    };
  }

  // --- Revenue prediction (simple 3-month moving average) ---
  const predictions = [];
  if (revenueTimeline.length >= 3) {
    const lastThree = revenueTimeline.slice(-3);
    const avgRevenue = Math.round(lastThree.reduce((sum, r) => sum + r.total, 0) / 3);
    const avgBookings = Math.round(lastThree.reduce((sum, r) => sum + r.bookings, 0) / 3);
    const avgNights = Math.round(lastThree.reduce((sum, r) => sum + r.nights, 0) / 3);

    for (let i = 1; i <= 3; i++) {
      const futureDate = new Date(today);
      futureDate.setMonth(futureDate.getMonth() + i);
      const month = futureDate.toISOString().substring(0, 7);
      predictions.push({ month, predicted_revenue: avgRevenue, predicted_bookings: avgBookings, predicted_nights: avgNights });
    }
  }

  // --- Future pipeline (confirmed bookings from today onwards) ---
  const futureBookings = allBookings.filter((b) => b.check_in >= todayStr);
  const futureRevenue = futureBookings.reduce((sum, b) => sum + (b.total_price || 0), 0);
  const futureNights = futureBookings.reduce((sum, b) => sum + (b.length_of_stay || 0), 0);

  // --- Reviews ---
  let reviewFilters = '';
  const reviewParams = [];
  reviewFilters += addPropertyFilter(propIds, 'r.property_id', reviewParams);
  if (from) {
    reviewFilters += ' AND r.review_date >= ?';
    reviewParams.push(from);
  }
  if (to) {
    reviewFilters += ' AND r.review_date <= ?';
    reviewParams.push(to);
  }
  const reviews = db
    .prepare(
      `SELECT r.*, p.name as property_name FROM reviews r
       JOIN properties p ON r.property_id = p.id
       WHERE 1=1${reviewFilters}
       ORDER BY r.review_date DESC`
    )
    .all(...reviewParams);

  const reviewsByProperty = {};
  for (const r of reviews) {
    if (!reviewsByProperty[r.property_name]) reviewsByProperty[r.property_name] = { property: r.property_name, count: 0, avg_rating: 0, total_rating: 0 };
    reviewsByProperty[r.property_name].count += 1;
    reviewsByProperty[r.property_name].total_rating += r.rating || 0;
  }
  for (const rv of Object.values(reviewsByProperty)) {
    rv.avg_rating = rv.count > 0 ? Math.round((rv.total_rating / rv.count) * 10) / 10 : 0;
    delete rv.total_rating;
  }

  // --- Summary KPIs ---
  const totalRevenue = allBookings.reduce((sum, b) => sum + (b.total_price || 0), 0);
  const totalNights = allBookings.reduce((sum, b) => sum + (b.length_of_stay || 0), 0);
  const avgAdr = totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0;
  const avgLos = allBookings.length > 0 ? Math.round((totalNights / allBookings.length) * 10) / 10 : 0;
  const avgLeadTime = allBookings.length > 0 ? Math.round(allBookings.reduce((sum, b) => sum + (b.lead_time_days || 0), 0) / allBookings.length) : 0;

  res.json({
    summary: {
      total_revenue: totalRevenue,
      total_bookings: allBookings.length,
      total_nights: totalNights,
      avg_adr: avgAdr,
      avg_los: avgLos,
      avg_lead_time: avgLeadTime,
      cancellation_rate: cancellationRate,
      future_revenue: futureRevenue,
      future_bookings: futureBookings.length,
      future_nights: futureNights,
      properties_count: properties.length,
    },
    revenue_timeline: revenueTimeline,
    revenue_by_property: Object.values(revenueByProperty),
    channel_stats: Object.values(channelStats),
    occupancy_timeline: occupancyTimeline,
    adr_timeline: adrTimeline,
    revpar_timeline: Object.values(revparByMonth),
    dow_stats: dowStats,
    los_distribution: Object.values(losDistribution),
    lead_time_distribution: Object.values(leadTimeDistribution),
    cancellations_by_channel: Object.values(cancellationsByChannel),
    price_trends: priceTrends,
    predictions,
    reviews_by_property: Object.values(reviewsByProperty),
    recent_reviews: reviews.slice(0, 20),
  });
});

// --- Reviews CRUD (manual entry since Smoobu has no reviews API) ---
router.get('/reviews', (req, res) => {
  const db = getDb();
  const reviews = db
    .prepare(
      `SELECT r.*, p.name as property_name FROM reviews r
       JOIN properties p ON r.property_id = p.id
       ORDER BY r.review_date DESC`
    )
    .all();
  res.json(reviews);
});

router.post('/reviews', (req, res) => {
  const db = getDb();
  const { property_id, booking_id, platform, guest_name, rating, comment, review_date, response } = req.body;

  if (!property_id || !review_date) {
    return res.status(400).json({ error: 'property_id and review_date are required' });
  }

  const sentiment = analyzeSentiment(comment);

  const result = db
    .prepare(
      `INSERT INTO reviews (property_id, booking_id, platform, guest_name, rating, comment, review_date, response, sentiment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(property_id, booking_id || null, platform || '', guest_name || '', rating || null, comment || '', review_date, response || '', sentiment);

  res.status(201).json({ id: result.lastInsertRowid, sentiment });
});

router.delete('/reviews/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Seasonality endpoint ---
router.get('/seasonality', (req, res) => {
  try {
    const db = getDb();
    const { property_id, from, to } = req.query;
    const propIds = parsePropertyIds(property_id);
    const properties = db.prepare('SELECT * FROM properties').all();

    let filters = '';
    const params = [];
    filters += addPropertyFilter(propIds, 'b.property_id', params);
    if (from) {
      filters += ' AND b.check_in >= ?';
      params.push(from);
    }
    if (to) {
      filters += ' AND b.check_in <= ?';
      params.push(to);
    }

    const bookings = db
      .prepare(
        `SELECT b.*, p.name as property_name FROM bookings b
         JOIN properties p ON b.property_id = p.id
         WHERE b.status = 'confirmed'${filters}
         ORDER BY b.check_in ASC`
      )
      .all(...params);

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Group by calendar month across all years
    const monthlyData = {};
    for (let m = 1; m <= 12; m++) {
      monthlyData[m] = { month_num: m, month_name: monthNames[m - 1], total_revenue: 0, total_nights: 0, total_available: 0, booking_count: 0, total_lead_time: 0, years: new Set() };
    }

    // Count occupied nights per month
    const propCount = (property_id && property_id !== 'all') ? 1 : properties.length;
    for (const b of bookings) {
      let d = new Date(b.check_in);
      const end = new Date(b.check_out);
      while (d < end) {
        const m = d.getMonth() + 1;
        const yr = d.getFullYear();
        monthlyData[m].total_nights += 1;
        monthlyData[m].years.add(yr);
        d.setDate(d.getDate() + 1);
      }
      const checkInMonth = new Date(b.check_in).getMonth() + 1;
      monthlyData[checkInMonth].total_revenue += b.total_price || 0;
      monthlyData[checkInMonth].booking_count += 1;
      monthlyData[checkInMonth].total_lead_time += b.lead_time_days || 0;
    }

    // Compute available nights per month across all years seen
    const allYears = new Set();
    for (const md of Object.values(monthlyData)) {
      for (const y of md.years) allYears.add(y);
    }
    const yearCount = Math.max(allYears.size, 1);

    for (let m = 1; m <= 12; m++) {
      // Average days in this month across years
      let totalDays = 0;
      for (const y of allYears) {
        totalDays += new Date(y, m, 0).getDate();
      }
      monthlyData[m].total_available = totalDays > 0 ? totalDays * propCount : 30 * propCount * yearCount;
    }

    const monthly_avg_occupancy = [];
    for (let m = 1; m <= 12; m++) {
      const md = monthlyData[m];
      const avgOccupancy = md.total_available > 0 ? Math.round((md.total_nights / md.total_available) * 100) : 0;
      const avgRevenue = yearCount > 0 ? Math.round(md.total_revenue / yearCount) : 0;
      const totalNightsForAdr = md.booking_count > 0 ? md.total_nights : 1;
      const avgAdr = md.total_revenue > 0 ? Math.round(md.total_revenue / md.total_nights) : 0;
      monthly_avg_occupancy.push({
        month: m,
        month_num: m,
        month_name: monthNames[m - 1],
        avg_occupancy: avgOccupancy,
        avg_revenue: avgRevenue,
        avg_adr: avgAdr
      });
    }

    // Yearly comparison
    const yearlyMap = {};
    for (const b of bookings) {
      const d = new Date(b.check_in);
      const yr = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${yr}-${m}`;
      if (!yearlyMap[key]) yearlyMap[key] = { year: yr, month: m, revenue: 0, nights: 0, bookings: 0 };
      yearlyMap[key].revenue += b.total_price || 0;
      yearlyMap[key].nights += b.length_of_stay || 1;
      yearlyMap[key].bookings += 1;
    }

    const yearlyGrouped = {};
    for (const entry of Object.values(yearlyMap)) {
      if (!yearlyGrouped[entry.year]) yearlyGrouped[entry.year] = { year: entry.year, months: [] };
      const [y, m] = [entry.year, entry.month];
      const daysInMonth = new Date(y, m, 0).getDate();
      const occupancy = daysInMonth > 0 ? Math.round((entry.nights / (daysInMonth * propCount)) * 100) : 0;
      const adr = entry.nights > 0 ? Math.round(entry.revenue / entry.nights) : 0;
      yearlyGrouped[entry.year].months.push({ month: m, revenue: entry.revenue, occupancy, adr });
    }
    const yearly_comparison = Object.values(yearlyGrouped).sort((a, b) => a.year - b.year);
    for (const yc of yearly_comparison) {
      yc.months.sort((a, b) => a.month - b.month);
    }

    // Peak and off-peak months
    const sorted = [...monthly_avg_occupancy].sort((a, b) => b.avg_occupancy - a.avg_occupancy);
    const peak_months = sorted.slice(0, 3);
    const off_peak_months = sorted.slice(-3).reverse();

    // Annual average occupancy
    const totalOcc = monthly_avg_occupancy.reduce((sum, m) => sum + m.avg_occupancy, 0);
    const annual_avg_occupancy = Math.round(totalOcc / 12);

    // Booking window by season
    const peakMonthNums = new Set(peak_months.map(p => p.month_num));
    const offPeakMonthNums = new Set(off_peak_months.map(p => p.month_num));
    let peakLeadTotal = 0, peakLeadCount = 0, offPeakLeadTotal = 0, offPeakLeadCount = 0;
    for (const b of bookings) {
      const m = new Date(b.check_in).getMonth() + 1;
      if (peakMonthNums.has(m)) {
        peakLeadTotal += b.lead_time_days || 0;
        peakLeadCount += 1;
      }
      if (offPeakMonthNums.has(m)) {
        offPeakLeadTotal += b.lead_time_days || 0;
        offPeakLeadCount += 1;
      }
    }

    res.json({
      monthly: monthly_avg_occupancy,
      monthly_avg_occupancy,
      yearly_comparison,
      peak_months,
      off_peak_months,
      annual_avg_occupancy,
      booking_window: {
        peak_lead_time: peakLeadCount > 0 ? Math.round(peakLeadTotal / peakLeadCount) : 0,
        offpeak_lead_time: offPeakLeadCount > 0 ? Math.round(offPeakLeadTotal / offPeakLeadCount) : 0
      },
      booking_window_by_season: {
        peak: peakLeadCount > 0 ? Math.round(peakLeadTotal / peakLeadCount) : 0,
        off_peak: offPeakLeadCount > 0 ? Math.round(offPeakLeadTotal / offPeakLeadCount) : 0
      }
    });
  } catch (err) {
    console.error('Seasonality error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Competitors CRUD ---
router.get('/competitors', (req, res) => {
  const db = getDb();
  const { property_id } = req.query;
  const propIds = parsePropertyIds(property_id);
  let sql = `SELECT c.*, p.name as property_name FROM competitors c JOIN properties p ON c.property_id = p.id`;
  const params = [];
  if (propIds) {
    const placeholders = propIds.map(() => '?').join(',');
    sql += ` WHERE c.property_id IN (${placeholders})`;
    propIds.forEach(id => params.push(id));
  }
  sql += ' ORDER BY c.id DESC';
  const competitors = db.prepare(sql).all(...params);
  res.json(competitors);
});

router.post('/competitors', (req, res) => {
  const db = getDb();
  const { property_id, name, platform, listing_url, listing_id, bedrooms, location, avg_nightly_rate, estimated_occupancy, review_score } = req.body;
  if (!property_id || !name) {
    return res.status(400).json({ error: 'property_id and name are required' });
  }
  const result = db.prepare(
    `INSERT INTO competitors (property_id, name, platform, listing_url, listing_id, bedrooms, location, avg_nightly_rate, estimated_occupancy, review_score, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(property_id, name, platform || '', listing_url || '', listing_id || '', bedrooms || 0, location || '', avg_nightly_rate || 0, estimated_occupancy || 0, review_score || 0);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/competitors/:id', (req, res) => {
  const db = getDb();
  const { name, platform, listing_url, listing_id, bedrooms, location, avg_nightly_rate, estimated_occupancy, review_score, property_id } = req.body;
  db.prepare(
    `UPDATE competitors SET name = ?, platform = ?, listing_url = ?, listing_id = ?, bedrooms = ?, location = ?, avg_nightly_rate = ?, estimated_occupancy = ?, review_score = ?, property_id = COALESCE(?, property_id), last_updated = datetime('now')
     WHERE id = ?`
  ).run(name, platform || '', listing_url || '', listing_id || '', bedrooms || 0, location || '', avg_nightly_rate || 0, estimated_occupancy || 0, review_score || 0, property_id || null, req.params.id);
  res.json({ updated: true });
});

router.delete('/competitors/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM competitors WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// --- Market Position ---
router.get('/market-position', (req, res) => {
  const db = getDb();
  const properties = db.prepare('SELECT * FROM properties').all();
  const result = [];

  for (const p of properties) {
    // My ADR - from confirmed bookings
    const myStats = db.prepare(
      `SELECT AVG(price_per_night) as avg_adr FROM bookings WHERE property_id = ? AND status = 'confirmed' AND price_per_night > 0`
    ).get(p.id);
    const myReview = db.prepare(
      `SELECT AVG(rating) as avg_rating FROM reviews WHERE property_id = ? AND rating IS NOT NULL`
    ).get(p.id);

    const competitors = db.prepare(
      `SELECT avg_nightly_rate, review_score FROM competitors WHERE property_id = ?`
    ).all(p.id);

    const myAdr = myStats?.avg_adr ? Math.round(myStats.avg_adr) : 0;
    const myReviewScore = myReview?.avg_rating ? Math.round(myReview.avg_rating * 10) / 10 : 0;

    let marketAvgAdr = 0;
    let marketAvgReview = 0;
    if (competitors.length > 0) {
      marketAvgAdr = Math.round(competitors.reduce((s, c) => s + (c.avg_nightly_rate || 0), 0) / competitors.length);
      const reviewComps = competitors.filter(c => c.review_score > 0);
      marketAvgReview = reviewComps.length > 0 ? Math.round(reviewComps.reduce((s, c) => s + c.review_score, 0) / reviewComps.length * 10) / 10 : 0;
    }

    const threshold = 0.05; // 5% tolerance for "at market"
    let posPrice = 'at';
    if (marketAvgAdr > 0) {
      if (myAdr > marketAvgAdr * (1 + threshold)) posPrice = 'above';
      else if (myAdr < marketAvgAdr * (1 - threshold)) posPrice = 'below';
    }
    let posReview = 'at';
    if (marketAvgReview > 0) {
      if (myReviewScore > marketAvgReview * (1 + threshold)) posReview = 'above';
      else if (myReviewScore < marketAvgReview * (1 - threshold)) posReview = 'below';
    }

    result.push({
      property_id: p.id,
      property_name: p.name,
      my_adr: myAdr,
      my_review_score: myReviewScore,
      market_avg_adr: marketAvgAdr,
      market_avg_review: marketAvgReview,
      position_price: posPrice,
      position_review: posReview,
      competitor_count: competitors.length
    });
  }

  res.json(result);
});

// --- Review HTML parsing ---
router.post('/reviews/parse-html', (req, res) => {
  try {
    const { html, platform, property_id } = req.body;
    if (!html) {
      return res.status(400).json({ error: 'html is required', reviews: [] });
    }

    const reviews = [];
    const p = (platform || '').toLowerCase();

    if (p.includes('airbnb')) {
      // Try to extract Airbnb-style reviews
      // Pattern: reviewer name followed by rating stars and review text
      const reviewBlocks = html.split(/<\/div>\s*<div/).filter(block =>
        block.includes('star') || block.includes('rating') || block.includes('review')
      );
      // Look for patterns with names and stars
      const nameRegex = /(?:by\s+|reviewer[:\s]+|<(?:span|h\d|strong)[^>]*>)([A-Z][a-z]+ ?[A-Z]?[a-z]*)/g;
      const ratingRegex = /(\d(?:\.\d)?)\s*(?:star|\/\s*5|out of 5)/gi;
      const commentRegex = /(?:review-text|comment)[^>]*>([^<]{10,})/gi;

      let nameMatch, ratingMatch, commentMatch;
      const names = [];
      const ratings = [];
      const comments = [];

      while ((nameMatch = nameRegex.exec(html)) !== null) names.push(nameMatch[1].trim());
      while ((ratingMatch = ratingRegex.exec(html)) !== null) ratings.push(parseFloat(ratingMatch[1]));
      while ((commentMatch = commentRegex.exec(html)) !== null) comments.push(commentMatch[1].trim());

      const count = Math.max(names.length, ratings.length, comments.length);
      for (let i = 0; i < count; i++) {
        reviews.push({
          guest_name: names[i] || 'Unknown',
          rating: ratings[i] || null,
          comment: comments[i] || '',
          review_date: new Date().toISOString().split('T')[0]
        });
      }
    } else if (p.includes('booking')) {
      // Booking.com patterns
      const scoreRegex = /(?:score|rating)[^>]*>(\d+(?:\.\d+)?)/gi;
      const commentRegex = /(?:review_pos|review_neg|review-text|comment)[^>]*>([^<]{10,})/gi;
      const nameRegex = /(?:reviewer-name|display-name)[^>]*>([^<]+)/gi;

      const names = [];
      const scores = [];
      const comments = [];

      let match;
      while ((match = scoreRegex.exec(html)) !== null) scores.push(parseFloat(match[1]));
      while ((match = commentRegex.exec(html)) !== null) comments.push(match[1].trim());
      while ((match = nameRegex.exec(html)) !== null) names.push(match[1].trim());

      const count = Math.max(names.length, scores.length, comments.length);
      for (let i = 0; i < count; i++) {
        // Booking.com uses 1-10 scale, convert to 1-5
        const rawScore = scores[i] || null;
        const rating = rawScore ? Math.round((rawScore / 2) * 10) / 10 : null;
        reviews.push({
          guest_name: names[i] || 'Unknown',
          rating,
          comment: comments[i] || '',
          review_date: new Date().toISOString().split('T')[0]
        });
      }
    } else {
      // Generic extraction attempt
      const ratingRegex = /(\d(?:\.\d)?)\s*(?:star|\/\s*5|out of 5|rating)/gi;
      const commentRegex = /(?:review|comment|text)[^>]*>([^<]{15,})/gi;

      const ratings = [];
      const comments = [];
      let match;
      while ((match = ratingRegex.exec(html)) !== null) ratings.push(parseFloat(match[1]));
      while ((match = commentRegex.exec(html)) !== null) comments.push(match[1].trim());

      const count = Math.max(ratings.length, comments.length);
      for (let i = 0; i < count; i++) {
        reviews.push({
          guest_name: 'Unknown',
          rating: ratings[i] || null,
          comment: comments[i] || '',
          review_date: new Date().toISOString().split('T')[0]
        });
      }
    }

    if (reviews.length === 0) {
      return res.json({ reviews: [], message: 'Could not extract reviews from the provided HTML. Try pasting the raw page source.' });
    }

    res.json({ reviews, message: `Extracted ${reviews.length} reviews (best-effort parsing).` });
  } catch (err) {
    console.error('Review parsing error:', err.message);
    res.json({ reviews: [], message: 'Parsing failed: ' + err.message });
  }
});

function normalizePlatform(platform) {
  if (!platform) return 'Direct';
  const p = platform.toLowerCase();
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('booking')) return 'Booking.com';
  if (p.includes('vrbo') || p.includes('homeaway')) return 'VRBO';
  return platform || 'Direct';
}

function analyzeSentiment(text) {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();
  const positive = ['great','amazing','wonderful','excellent','perfect','love','clean','beautiful','fantastic','best','recommend','comfortable','lovely','outstanding','superb'];
  const negative = ['dirty','noisy','broken','terrible','worst','awful','disappointing','rude','smell','bug','cockroach','dangerous','unsafe','horrible','disgusting'];
  let score = 0;
  for (const w of positive) if (lower.includes(w)) score++;
  for (const w of negative) if (lower.includes(w)) score--;
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

module.exports = router;
