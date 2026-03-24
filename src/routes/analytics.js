const express = require('express');
const router = express.Router();
const { getAll, getOne, run, transaction } = require('../db/database');
const smoobu = require('../services/smoobu');
const { detectCurrency } = require('../services/currency-detect');
const { bulkConvert, getDisplayCurrency } = require('../services/exchange-rates');
const { scopeProperties, enforcePropertyScope } = require('../middleware/auth');

// Apply property scoping to all analytics routes
router.use(scopeProperties);

// Helper: parse property_id param (supports comma-separated IDs or 'all')
function parsePropertyIds(raw) {
  if (!raw || raw === 'all') return null; // null means no filter
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Scoped version: intersect requested IDs with user's allowed IDs
function scopedPropertyIds(req) {
  return enforcePropertyScope(req, parsePropertyIds(req.query.property_id));
}

function addPropertyFilter(propIds, column, params) {
  if (!propIds) return '';
  const placeholders = propIds.map((_, i) => `$${params.length + i + 1}`).join(',');
  propIds.forEach(id => params.push(id));
  return ` AND ${column} IN (${placeholders})`;
}

// Sync rates from Smoobu for analytics (GET only, no writes to Smoobu)
router.post('/sync-rates', async (req, res) => {
  try {
    const properties = await getAll('SELECT * FROM properties');
    const today = new Date().toISOString().split('T')[0];
    const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    let totalSynced = 0;

    for (const p of properties) {
      try {
        const ratesData = await smoobu.getRates(p.smoobu_id, today, sixtyDaysOut);
        // Smoobu returns rates keyed by apartment ID
        const apartmentRates = ratesData?.data?.[p.smoobu_id] || ratesData?.[p.smoobu_id] || {};

        await transaction(async (client) => {
          for (const [date, info] of Object.entries(apartmentRates)) {
            const price = info?.price || info?.daily_price || 0;
            const minStay = info?.min_length_of_stay || info?.minLengthOfStay || 1;
            const available = info?.available !== undefined ? (info.available ? 1 : 0) : 1;
            await client.query(
              `INSERT INTO daily_rates (property_id, date, price, min_stay, available)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT(property_id, date) DO UPDATE SET
                 price = EXCLUDED.price,
                 min_stay = EXCLUDED.min_stay,
                 available = EXCLUDED.available,
                 fetched_at = NOW()`,
              [p.id, date, price, minStay, available]
            );
            totalSynced++;
          }
        });
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

// Phone country code to country name mapping
const PHONE_COUNTRY_MAP = {
  '27': 'South Africa', '1': 'United States', '44': 'United Kingdom',
  '49': 'Germany', '33': 'France', '31': 'Netherlands', '32': 'Belgium',
  '34': 'Spain', '39': 'Italy', '41': 'Switzerland', '43': 'Austria',
  '45': 'Denmark', '46': 'Sweden', '47': 'Norway', '48': 'Poland',
  '351': 'Portugal', '353': 'Ireland', '358': 'Finland', '420': 'Czech Republic',
  '36': 'Hungary', '30': 'Greece', '90': 'Turkey', '7': 'Russia',
  '61': 'Australia', '64': 'New Zealand', '81': 'Japan', '82': 'South Korea',
  '86': 'China', '91': 'India', '55': 'Brazil', '52': 'Mexico',
  '54': 'Argentina', '56': 'Chile', '57': 'Colombia', '971': 'UAE',
  '966': 'Saudi Arabia', '972': 'Israel', '20': 'Egypt', '234': 'Nigeria',
  '254': 'Kenya', '255': 'Tanzania', '256': 'Uganda', '263': 'Zimbabwe',
  '267': 'Botswana', '258': 'Mozambique', '260': 'Zambia', '264': 'Namibia',
  '230': 'Mauritius', '262': 'Reunion', '261': 'Madagascar',
  '65': 'Singapore', '60': 'Malaysia', '66': 'Thailand', '62': 'Indonesia',
  '63': 'Philippines', '84': 'Vietnam', '852': 'Hong Kong', '886': 'Taiwan',
  '354': 'Iceland', '372': 'Estonia', '371': 'Latvia', '370': 'Lithuania',
  '385': 'Croatia', '386': 'Slovenia', '421': 'Slovakia', '40': 'Romania',
  '359': 'Bulgaria', '381': 'Serbia', '387': 'Bosnia', '355': 'Albania',
};

function countryFromPhone(phone) {
  if (!phone) return '';
  // Strip spaces, dashes, parens; keep leading +
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) return '';
  const digits = cleaned.substring(1);
  // Try 3-digit, 2-digit, then 1-digit codes
  for (const len of [3, 2, 1]) {
    const prefix = digits.substring(0, len);
    if (PHONE_COUNTRY_MAP[prefix]) return PHONE_COUNTRY_MAP[prefix];
  }
  return '';
}

// Sync historical bookings (wider range for analytics)
router.post('/sync-history', async (req, res) => {
  try {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    const sixMonthsOut = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const allBookings = await smoobu.getAllBookings({ from: twoYearsAgo, to: sixMonthsOut });

    // Build property base_currency map for fallback
    const propCurrencyMap = {};
    const propsForCurrency = await getAll('SELECT smoobu_id, base_currency FROM properties');
    for (const p of propsForCurrency) propCurrencyMap[p.smoobu_id] = p.base_currency || 'ZAR';

    await transaction(async (client) => {
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

        // New fields
        const commission = b['commission-included'] || b.commissionIncluded || 0;
        const language = b.language || '';
        const children = b.children || 0;
        const phone = b.phone || b['guest-phone'] || b.guestPhone || '';
        const guestCountry = countryFromPhone(phone) || '';
        const aptId = b['apartment']?.id || b.apartmentId;
        const currency = detectCurrency(b) || propCurrencyMap[aptId] || 'ZAR';

        await client.query(
          `INSERT INTO bookings (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status, num_guests, created_at, lead_time_days, length_of_stay, price_per_night, commission, language, children, guest_country, currency, modified_at)
           VALUES ($1, (SELECT id FROM properties WHERE smoobu_id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT(smoobu_id) DO UPDATE SET
             guest_name = CASE WHEN EXCLUDED.guest_name = '' THEN bookings.guest_name ELSE EXCLUDED.guest_name END, check_in = EXCLUDED.check_in,
             check_out = EXCLUDED.check_out, platform = EXCLUDED.platform,
             total_price = EXCLUDED.total_price, status = EXCLUDED.status,
             num_guests = EXCLUDED.num_guests, created_at = EXCLUDED.created_at,
             lead_time_days = EXCLUDED.lead_time_days, length_of_stay = EXCLUDED.length_of_stay,
             price_per_night = EXCLUDED.price_per_night, commission = EXCLUDED.commission,
             language = EXCLUDED.language, children = EXCLUDED.children,
             guest_country = EXCLUDED.guest_country, currency = EXCLUDED.currency,
             modified_at = EXCLUDED.modified_at`,
          [
            b.id,
            aptId,
            b['guest-name'] || b.guestName || '',
            checkIn, checkOut, platform, price,
            b.type === 'cancellation' ? 'cancelled' : 'confirmed',
            b['adults'] || b.adults || 1,
            createdAt, leadTime, los, ppn,
            commission, language, children, guestCountry, currency,
            modifiedAt
          ]
        );
      }
    });

    res.json({ synced: allBookings.length });
  } catch (err) {
    console.error('History sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get full analytics data
router.get('/data', async (req, res) => {
  const propIds = scopedPropertyIds(req);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const { from: rawFrom, to: rawTo } = req.query;

  // Load only accessible properties
  let properties;
  if (propIds) {
    const propParams = [];
    const propFilter = addPropertyFilter(propIds, 'id', propParams);
    properties = await getAll(`SELECT * FROM properties WHERE 1=1${propFilter}`, propParams);
  } else {
    properties = await getAll('SELECT * FROM properties');
  }

  // Round date filters to full months so charts always show complete months
  const from = rawFrom ? rawFrom.substring(0, 7) + '-01' : null;
  const to = rawTo ? (() => { const [y, m] = rawTo.split('-').map(Number); return new Date(y, m, 0).toISOString().split('T')[0]; })() : null;

  // Build dynamic filter
  let bookingFilters = '';
  const bookingParams = [];
  bookingFilters += addPropertyFilter(propIds, 'b.property_id', bookingParams);
  if (from) {
    bookingFilters += ` AND b.check_in >= $${bookingParams.length + 1}`;
    bookingParams.push(from);
  }
  if (to) {
    bookingFilters += ` AND b.check_in <= $${bookingParams.length + 1}`;
    bookingParams.push(to);
  }

  // All confirmed bookings (excluding calendar blocks)
  const BLOCKED_FILTER = ` AND b.platform NOT IN ('Blocked channel', 'Blocked channel auto')`;
  const allBookings = await getAll(
    `SELECT b.*, p.name as property_name, p.base_price as property_base_price, p.base_currency as property_base_currency, p.vat_rate as property_vat_rate, p.bank_charge_airbnb, p.bank_charge_booking, p.bank_charge_vrbo FROM bookings b
     JOIN properties p ON b.property_id = p.id
     WHERE b.status = 'confirmed'${BLOCKED_FILTER}${bookingFilters}
     ORDER BY b.check_in ASC`,
    bookingParams
  );

  // Impute revenue from base_price when total_price is 0 (any platform, not just VRBO)
  for (const b of allBookings) {
    if ((b.total_price || 0) === 0 && b.property_base_price && b.property_base_price > 0) {
      const los = b.length_of_stay || 1;
      b.total_price = b.property_base_price * los;
      b.price_per_night = b.property_base_price;
      b.currency = b.property_base_currency || 'ZAR';
      b._imputed = true;
    }
  }

  // Convert all booking amounts to display currency
  const displayCurrency = await getDisplayCurrency();
  await bulkConvert(allBookings, displayCurrency);

  // --- Fetch future confirmed bookings (beyond the date range) ---
  let futureFilters = '';
  const futureParams = [];
  futureFilters += addPropertyFilter(propIds, 'b.property_id', futureParams);
  if (to) {
    futureFilters += ` AND b.check_in > $${futureParams.length + 1}`;
    futureParams.push(to);
  }
  const futureConfirmedBookings = to ? await getAll(
    `SELECT b.*, p.name as property_name, p.base_price as property_base_price, p.base_currency as property_base_currency FROM bookings b
     JOIN properties p ON b.property_id = p.id
     WHERE b.status = 'confirmed'${BLOCKED_FILTER}${futureFilters}
     ORDER BY b.check_in ASC`,
    futureParams
  ) : [];

  // Impute + convert future bookings
  for (const b of futureConfirmedBookings) {
    if ((b.total_price || 0) === 0 && b.property_base_price > 0) {
      b.total_price = b.property_base_price * (b.length_of_stay || 1);
      b.currency = b.property_base_currency || 'ZAR';
    }
  }
  if (futureConfirmedBookings.length > 0) await bulkConvert(futureConfirmedBookings, displayCurrency);

  // --- Revenue by month (split into paid vs booked) ---
  const allBookingsCombined = [...allBookings, ...futureConfirmedBookings];
  const revenueByMonth = {};
  for (const b of allBookingsCombined) {
    const month = b.check_in.substring(0, 7); // YYYY-MM
    if (!revenueByMonth[month]) revenueByMonth[month] = { month, total: 0, paid: 0, booked: 0, bookings: 0, nights: 0 };
    const rev = b.converted_total_price || 0;
    revenueByMonth[month].total += rev;
    // Paid = checkout is in the past; Booked = checkout is still in the future
    if (b.check_out <= todayStr) {
      revenueByMonth[month].paid += rev;
    } else {
      revenueByMonth[month].booked += rev;
    }
    revenueByMonth[month].bookings += 1;
    revenueByMonth[month].nights += b.length_of_stay || 1;
  }
  // Fill in missing months with 0 values so the chart has no gaps
  const monthKeys = Object.keys(revenueByMonth).sort();
  if (monthKeys.length >= 2) {
    const [startY, startM] = monthKeys[0].split('-').map(Number);
    const [endY, endM] = monthKeys[monthKeys.length - 1].split('-').map(Number);
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!revenueByMonth[key]) {
        revenueByMonth[key] = { month: key, total: 0, paid: 0, booked: 0, bookings: 0, nights: 0 };
      }
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  const revenueTimeline = Object.values(revenueByMonth).sort((a, b) => a.month.localeCompare(b.month));

  // --- Revenue by property (with top platform) ---
  const revenueByProperty = {};
  const platformByProperty = {}; // track platform bookings per property
  for (const b of allBookings) {
    const key = b.property_name;
    if (!revenueByProperty[key]) revenueByProperty[key] = { property: key, property_id: b.property_id, total: 0, bookings: 0, nights: 0 };
    revenueByProperty[key].total += b.converted_total_price || 0;
    revenueByProperty[key].bookings += 1;
    revenueByProperty[key].nights += b.length_of_stay || 1;

    // Track platform counts per property
    const plat = normalizePlatform(b.platform);
    if (!platformByProperty[key]) platformByProperty[key] = {};
    platformByProperty[key][plat] = (platformByProperty[key][plat] || 0) + 1;
  }
  // Assign top_platform to each property
  for (const [prop, platforms] of Object.entries(platformByProperty)) {
    if (revenueByProperty[prop]) {
      const sorted = Object.entries(platforms).sort((a, b) => b[1] - a[1]);
      revenueByProperty[prop].top_platform = sorted.length > 0 ? sorted[0][0] : '';
    }
  }

  // --- Channel performance ---
  const channelStats = {};
  for (const b of allBookings) {
    const ch = normalizePlatform(b.platform);
    if (!channelStats[ch]) channelStats[ch] = { channel: ch, revenue: 0, revenue_ex_vat: 0, bank_charges: 0, bookings: 0, nights: 0, avg_ppn: 0, avg_ppn_ex_vat: 0, avg_los: 0, avg_lead_time: 0, total_ppn: 0, total_ppn_ex_vat: 0, total_lead: 0, has_imputed: false };
    const convPrice = b.converted_total_price || 0;
    const convPpn = b.converted_price_per_night || 0;
    channelStats[ch].revenue += convPrice;
    channelStats[ch].bookings += 1;
    channelStats[ch].nights += b.length_of_stay || 1;
    channelStats[ch].total_ppn += convPpn;
    channelStats[ch].total_lead += b.lead_time_days || 0;
    if (b._imputed) channelStats[ch].has_imputed = true;

    // VAT-exclusive revenue (for platforms where rates include VAT like Booking.com)
    const vatRate = b.property_vat_rate || 0;
    const isVatInclusive = vatRate > 0 && (ch === 'Booking.com');
    const vatDivisor = isVatInclusive ? (1 + vatRate / 100) : 1;
    channelStats[ch].revenue_ex_vat += Math.round(convPrice / vatDivisor);
    channelStats[ch].total_ppn_ex_vat += Math.round(convPpn / vatDivisor);

    // Bank charges
    let bankRate = 0;
    if (ch === 'Airbnb') bankRate = (b.bank_charge_airbnb || 0) / 100;
    else if (ch === 'Booking.com') bankRate = (b.bank_charge_booking || 2.1) / 100;
    else if (ch === 'VRBO') bankRate = (b.bank_charge_vrbo || 0) / 100;
    channelStats[ch].bank_charges += Math.round(convPrice * bankRate);
  }
  for (const ch of Object.values(channelStats)) {
    ch.avg_ppn = ch.bookings > 0 ? Math.round(ch.total_ppn / ch.bookings) : 0;
    ch.avg_ppn_ex_vat = ch.bookings > 0 ? Math.round(ch.total_ppn_ex_vat / ch.bookings) : 0;
    ch.avg_los = ch.bookings > 0 ? Math.round((ch.nights / ch.bookings) * 10) / 10 : 0;
    ch.avg_lead_time = ch.bookings > 0 ? Math.round(ch.total_lead / ch.bookings) : 0;
    ch.adr = ch.nights > 0 ? Math.round(ch.revenue / ch.nights) : 0;
    ch.adr_ex_vat = ch.nights > 0 ? Math.round(ch.revenue_ex_vat / ch.nights) : 0;
    delete ch.total_ppn;
    delete ch.total_ppn_ex_vat;
    delete ch.total_lead;
  }

  // --- Occupancy by month per property ---
  // Use a wider booking set that includes bookings checking in before 'from' but overlapping into the range
  const occFrom = from || '2000-01-01';
  const occTo = to || '2099-12-31';
  let occFilters = '';
  const occParams = [];
  occFilters += addPropertyFilter(propIds, 'b.property_id', occParams);
  // Include bookings that overlap with the date range (check_out > from AND check_in <= to)
  occFilters += ` AND b.check_out > $${occParams.length + 1}`;
  occParams.push(occFrom);
  occFilters += ` AND b.check_in <= $${occParams.length + 1}`;
  occParams.push(occTo);

  const occBookings = await getAll(
    `SELECT b.check_in, b.check_out, b.property_id FROM bookings b
     WHERE b.status = 'confirmed'${BLOCKED_FILTER}${occFilters}
     ORDER BY b.check_in ASC`,
    occParams
  );

  // Clamp night counting to the requested date range
  const occRangeStart = new Date(occFrom);
  const occRangeEnd = new Date(new Date(occTo).getTime() + 24 * 60 * 60 * 1000); // day after last date

  const occupancyByMonth = {};
  for (const p of properties) {
    const pBookings = occBookings.filter((b) => b.property_id === p.id);
    for (const b of pBookings) {
      let d = new Date(Math.max(new Date(b.check_in), occRangeStart));
      const end = new Date(Math.min(new Date(b.check_out), occRangeEnd));
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
    adrByMonth[month].total_revenue += b.converted_total_price || 0;
    adrByMonth[month].total_nights += b.length_of_stay || 1;
  }
  const adrTimeline = Object.entries(adrByMonth)
    .map(([month, d]) => ({ month, adr: d.total_nights > 0 ? Math.round(d.total_revenue / d.total_nights) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // --- Day-of-week analysis ---
  const dowStats = Array.from({ length: 7 }, (_, i) => ({ day: i, bookings_starting: 0, revenue: 0, nights: 0 }));
  const checkoutDowStats = Array.from({ length: 7 }, (_, i) => ({ day: i, count: 0 }));
  for (const b of allBookings) {
    const dow = new Date(b.check_in).getDay();
    dowStats[dow].bookings_starting += 1;
    dowStats[dow].revenue += b.converted_total_price || 0;
    dowStats[dow].nights += b.length_of_stay || 1;
    if (b.check_out) {
      const coDow = new Date(b.check_out).getDay();
      checkoutDowStats[coDow].count += 1;
    }
  }

  // --- Length of stay distribution ---
  const losDistribution = {};
  for (const b of allBookings) {
    const los = b.length_of_stay || 1;
    const bucket = los >= 7 ? '7+' : String(los);
    if (!losDistribution[bucket]) losDistribution[bucket] = { nights: bucket, count: 0, revenue: 0 };
    losDistribution[bucket].count += 1;
    losDistribution[bucket].revenue += b.converted_total_price || 0;
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
        leadTimeDistribution[label].total_ppn += b.converted_price_per_night || 0;
        break;
      }
    }
  }
  for (const lt of Object.values(leadTimeDistribution)) {
    lt.avg_ppn = lt.count > 0 ? Math.round(lt.total_ppn / lt.count) : 0;
    delete lt.total_ppn;
  }

  // --- Booking hour distribution (time of day people book, adjusted to SAST = UTC+2) ---
  const SAST_OFFSET = 2;
  const hourDistribution = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
  for (const b of allBookings) {
    const ca = b.created_at || '';
    if (ca.includes(' ')) {
      const timePart = ca.split(' ')[1]; // "14:46"
      const utcHour = parseInt(timePart.split(':')[0], 10);
      if (!isNaN(utcHour) && utcHour >= 0 && utcHour < 24) {
        const sastHour = (utcHour + SAST_OFFSET) % 24;
        hourDistribution[sastHour].count += 1;
      }
    }
  }

  // --- Cancellation rate ---
  let cancelFilters = '';
  const cancelParams = [];
  cancelFilters += addPropertyFilter(propIds, 'property_id', cancelParams);
  if (from) {
    cancelFilters += ` AND check_in >= $${cancelParams.length + 1}`;
    cancelParams.push(from);
  }
  if (to) {
    cancelFilters += ` AND check_in <= $${cancelParams.length + 1}`;
    cancelParams.push(to);
  }
  const allBookingsIncCancelled = await getAll(
    `SELECT status, platform FROM bookings WHERE platform NOT IN ('Blocked channel', 'Blocked channel auto')${cancelFilters}`,
    cancelParams
  );
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
  const priceTrends = await getAll(
    `SELECT dr.date, dr.price, dr.available, p.name as property_name, p.id as property_id
     FROM daily_rates dr
     JOIN properties p ON dr.property_id = p.id
     ORDER BY dr.date ASC`
  );

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

  // --- Revenue prediction (hybrid: prior year seasonality + recent trend) ---
  const predictions = [];
  if (revenueTimeline.length >= 3) {
    const lastThree = revenueTimeline.slice(-3);
    const maRevenue = Math.round(lastThree.reduce((sum, r) => sum + r.total, 0) / 3);
    const maBookings = Math.round(lastThree.reduce((sum, r) => sum + r.bookings, 0) / 3);
    const maNights = Math.round(lastThree.reduce((sum, r) => sum + r.nights, 0) / 3);

    // Compute YoY trend factor: avg of last 3 months / avg of same 3 months last year
    let trendFactor = 1;
    const priorMatchRevenue = lastThree.reduce((sum, r) => {
      const [y, m] = r.month.split('-').map(Number);
      const priorKey = `${y - 1}-${String(m).padStart(2, '0')}`;
      const priorEntry = revenueTimeline.find(e => e.month === priorKey);
      return sum + (priorEntry ? priorEntry.total : 0);
    }, 0);
    if (priorMatchRevenue > 0) {
      trendFactor = (lastThree.reduce((s, r) => s + r.total, 0)) / priorMatchRevenue;
    }

    // Fetch prior year revenue for the forecast months
    let priorForecastParams = [];
    let priorForecastFilter = '';
    priorForecastFilter += addPropertyFilter(propIds, 'b.property_id', priorForecastParams);
    const forecastMonths = [];
    for (let i = 1; i <= 4; i++) {
      const futureDate = new Date(today);
      futureDate.setMonth(futureDate.getMonth() + i);
      forecastMonths.push(futureDate.toISOString().substring(0, 7));
    }
    // Prior year equivalents
    const priorForecastMonths = forecastMonths.map(m => {
      const [y, mo] = m.split('-');
      return `${Number(y) - 1}-${mo}`;
    });
    const priorForecastFrom = priorForecastMonths[0] + '-01';
    const priorForecastTo = priorForecastMonths[priorForecastMonths.length - 1] + '-28';
    priorForecastFilter += ` AND b.check_in >= $${priorForecastParams.length + 1}`;
    priorForecastParams.push(priorForecastFrom);
    priorForecastFilter += ` AND b.check_in <= $${priorForecastParams.length + 1}`;
    priorForecastParams.push(priorForecastTo);

    const priorFcBookings = await getAll(
      `SELECT b.check_in, b.total_price, b.length_of_stay, b.price_per_night, b.currency,
              p.base_price as property_base_price, p.base_currency as property_base_currency
       FROM bookings b JOIN properties p ON b.property_id = p.id
       WHERE b.status = 'confirmed'${BLOCKED_FILTER}${priorForecastFilter}`,
      priorForecastParams
    );

    // Impute + convert
    for (const b of priorFcBookings) {
      if ((b.total_price || 0) === 0 && b.property_base_price > 0) {
        b.total_price = b.property_base_price * (b.length_of_stay || 1);
        b.currency = b.property_base_currency || 'ZAR';
      }
    }
    await bulkConvert(priorFcBookings, displayCurrency);

    const priorFcByMonth = {};
    for (const b of priorFcBookings) {
      const month = b.check_in.substring(0, 7);
      if (!priorFcByMonth[month]) priorFcByMonth[month] = { total: 0, bookings: 0, nights: 0 };
      priorFcByMonth[month].total += b.converted_total_price || 0;
      priorFcByMonth[month].bookings += 1;
      priorFcByMonth[month].nights += b.length_of_stay || 1;
    }

    // Blend: 60% prior year with trend factor, 40% moving average
    for (let i = 0; i < 4; i++) {
      const month = forecastMonths[i];
      const priorMonth = priorForecastMonths[i];
      const priorData = priorFcByMonth[priorMonth];
      let revenue, bookings, nights;

      if (priorData && priorData.total > 0) {
        revenue = Math.round(priorData.total * trendFactor * 0.6 + maRevenue * 0.4);
        bookings = Math.round(priorData.bookings * trendFactor * 0.6 + maBookings * 0.4);
        nights = Math.round(priorData.nights * trendFactor * 0.6 + maNights * 0.4);
      } else {
        // No prior year data — fall back to moving average
        revenue = maRevenue;
        bookings = maBookings;
        nights = maNights;
      }
      predictions.push({ month, predicted_revenue: revenue, predicted_bookings: bookings, predicted_nights: nights });
    }
  }

  // --- Future pipeline (confirmed bookings from today onwards) ---
  const futureBookings = allBookings.filter((b) => b.check_in >= todayStr);
  const futureRevenue = futureBookings.reduce((sum, b) => sum + (b.converted_total_price || 0), 0);
  const futureNights = futureBookings.reduce((sum, b) => sum + (b.length_of_stay || 0), 0);

  // --- Reviews ---
  let reviewFilters = '';
  const reviewParams = [];
  reviewFilters += addPropertyFilter(propIds, 'r.property_id', reviewParams);
  if (from) {
    reviewFilters += ` AND r.review_date >= $${reviewParams.length + 1}`;
    reviewParams.push(from);
  }
  if (to) {
    reviewFilters += ` AND r.review_date <= $${reviewParams.length + 1}`;
    reviewParams.push(to);
  }
  const reviews = await getAll(
    `SELECT r.*, p.name as property_name FROM reviews r
     JOIN properties p ON r.property_id = p.id
     WHERE 1=1${reviewFilters}
     ORDER BY r.review_date DESC`,
    reviewParams
  );

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
  const totalRevenue = allBookings.reduce((sum, b) => sum + (b.converted_total_price || 0), 0);
  const totalCommission = allBookings.reduce((sum, b) => sum + (b.converted_commission || 0), 0);
  const netRevenue = totalRevenue - totalCommission;
  const totalNights = allBookings.reduce((sum, b) => sum + (b.length_of_stay || 0), 0);
  const avgAdr = totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0;
  const avgLos = allBookings.length > 0 ? Math.round((totalNights / allBookings.length) * 10) / 10 : 0;
  const avgLeadTime = allBookings.length > 0 ? Math.round(allBookings.reduce((sum, b) => sum + (b.lead_time_days || 0), 0) / allBookings.length) : 0;
  const hasImputedRevenue = allBookings.some(b => b._imputed);
  const totalChildren = allBookings.reduce((sum, b) => sum + (b.children || 0), 0);
  const avgGuestsPerBooking = allBookings.length > 0 ? Math.round((allBookings.reduce((sum, b) => sum + (b.num_guests || 1), 0) / allBookings.length) * 10) / 10 : 0;

  // --- Guest demographics ---
  const languageStats = {};
  const countryStats = {};
  for (const b of allBookings) {
    if (b.language) {
      languageStats[b.language] = (languageStats[b.language] || 0) + 1;
    }
    if (b.guest_country) {
      countryStats[b.guest_country] = (countryStats[b.guest_country] || 0) + 1;
    }
  }
  const topLanguages = Object.entries(languageStats)
    .map(([lang, count]) => ({ language: lang, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topCountries = Object.entries(countryStats)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // --- Prior period comparison (same months, one year earlier) ---
  let priorSummary = null;
  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const rangeDays = Math.round((toDate - fromDate) / (1000 * 60 * 60 * 24));
    const priorFrom = new Date(fromDate);
    priorFrom.setFullYear(priorFrom.getFullYear() - 1);
    const priorTo = new Date(toDate);
    priorTo.setFullYear(priorTo.getFullYear() - 1);
    const priorFromStr = priorFrom.toISOString().split('T')[0];
    const priorToStr = priorTo.toISOString().split('T')[0];

    let priorFilters = '';
    const priorParams = [];
    priorFilters += addPropertyFilter(propIds, 'b.property_id', priorParams);
    priorFilters += ` AND b.check_in >= $${priorParams.length + 1}`;
    priorParams.push(priorFromStr);
    priorFilters += ` AND b.check_in <= $${priorParams.length + 1}`;
    priorParams.push(priorToStr);

    const priorBookings = await getAll(
      `SELECT b.*, p.name as property_name, p.base_price as property_base_price, p.base_currency as property_base_currency FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.status = 'confirmed'${BLOCKED_FILTER}${priorFilters}
       ORDER BY b.check_in ASC`,
      priorParams
    );

    // Impute for prior period too (all platforms with R0)
    for (const b of priorBookings) {
      if ((b.total_price || 0) === 0 && b.property_base_price && b.property_base_price > 0) {
        b.total_price = b.property_base_price * (b.length_of_stay || 1);
        b.price_per_night = b.property_base_price;
        b.currency = b.property_base_currency || 'ZAR';
        b._imputed = true;
      }
    }

    // Convert prior period bookings
    await bulkConvert(priorBookings, displayCurrency);

    const priorRevenue = priorBookings.reduce((sum, b) => sum + (b.converted_total_price || 0), 0);
    const priorNights = priorBookings.reduce((sum, b) => sum + (b.length_of_stay || 0), 0);
    const priorAdr = priorNights > 0 ? Math.round(priorRevenue / priorNights) : 0;
    const priorLos = priorBookings.length > 0 ? Math.round((priorNights / priorBookings.length) * 10) / 10 : 0;

    // Prior revenue by month
    const priorRevByMonth = {};
    for (const b of priorBookings) {
      const month = b.check_in.substring(0, 7);
      if (!priorRevByMonth[month]) priorRevByMonth[month] = { month, total: 0, bookings: 0, nights: 0 };
      priorRevByMonth[month].total += b.converted_total_price || 0;
      priorRevByMonth[month].bookings += 1;
      priorRevByMonth[month].nights += b.length_of_stay || 1;
    }

    // Prior occupancy
    let priorOccFilters = '';
    const priorOccParams = [];
    priorOccFilters += addPropertyFilter(propIds, 'b.property_id', priorOccParams);
    priorOccFilters += ` AND b.check_in >= $${priorOccParams.length + 1}`;
    priorOccParams.push(priorFromStr);
    priorOccFilters += ` AND b.check_in <= $${priorOccParams.length + 1}`;
    priorOccParams.push(priorToStr);

    const priorOccBookings = await getAll(
      `SELECT b.check_in, b.check_out, b.property_id, b.length_of_stay FROM bookings b
       WHERE b.status = 'confirmed'${BLOCKED_FILTER}${priorOccFilters}`,
      priorOccParams
    );

    let priorTotalOccNights = 0;
    let priorTotalDays = 0;
    // Simple: use same calculation approach
    for (const b of priorOccBookings) {
      priorTotalOccNights += b.length_of_stay || 0;
    }
    priorTotalDays = rangeDays * properties.length;
    const priorAvgOcc = priorTotalDays > 0 ? Math.round((priorTotalOccNights / priorTotalDays) * 100) : 0;

    priorSummary = {
      total_revenue: priorRevenue,
      total_bookings: priorBookings.length,
      total_nights: priorNights,
      avg_adr: priorAdr,
      avg_los: priorLos,
      avg_occupancy: priorAvgOcc,
      revenue_timeline: Object.values(priorRevByMonth).sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  res.json({
    display_currency: displayCurrency,
    summary: {
      total_revenue: totalRevenue,
      total_commission: totalCommission,
      net_revenue: netRevenue,
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
      has_imputed_revenue: hasImputedRevenue,
      total_children: totalChildren,
      avg_guests: avgGuestsPerBooking,
    },
    prior_summary: priorSummary,
    revenue_timeline: revenueTimeline,
    revenue_by_property: Object.values(revenueByProperty),
    channel_stats: Object.values(channelStats),
    occupancy_timeline: occupancyTimeline,
    adr_timeline: adrTimeline,
    revpar_timeline: Object.values(revparByMonth),
    dow_stats: dowStats,
    checkout_dow_stats: checkoutDowStats,
    los_distribution: Object.values(losDistribution),
    lead_time_distribution: Object.values(leadTimeDistribution),
    hour_distribution: hourDistribution,
    cancellations_by_channel: Object.values(cancellationsByChannel),
    price_trends: priceTrends,
    predictions,
    reviews_by_property: Object.values(reviewsByProperty),
    recent_reviews: reviews.slice(0, 20),
    guest_demographics: {
      top_languages: topLanguages,
      top_countries: topCountries,
    },
  });
});

// --- Reviews CRUD (manual entry since Smoobu has no reviews API) ---
router.get('/reviews', async (req, res) => {
  const reviews = await getAll(
    `SELECT r.*, p.name as property_name FROM reviews r
     JOIN properties p ON r.property_id = p.id
     ORDER BY r.review_date DESC`
  );
  res.json(reviews);
});

router.post('/reviews', async (req, res) => {
  const { property_id, booking_id, platform, guest_name, rating, comment, review_date, response } = req.body;

  if (!property_id || !review_date) {
    return res.status(400).json({ error: 'property_id and review_date are required' });
  }

  const sentiment = analyzeSentiment(comment);

  const result = await run(
    `INSERT INTO reviews (property_id, booking_id, platform, guest_name, rating, comment, review_date, response, sentiment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [property_id, booking_id || null, platform || '', guest_name || '', rating || null, comment || '', review_date, response || '', sentiment]
  );

  res.status(201).json({ id: result.rows[0].id, sentiment });
});

router.delete('/reviews/:id', async (req, res) => {
  await run('DELETE FROM reviews WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// --- Sync reviews from Apify (Airbnb + Booking.com) ---
router.post('/reviews/sync', async (req, res) => {
  try {
    const { syncReviewsForProperty } = require('../services/apify-reviews');
    const { property_id } = req.body;

    let properties;
    if (property_id) {
      const prop = await getOne('SELECT * FROM properties WHERE id = $1', [property_id]);
      properties = prop ? [prop] : [];
    } else {
      properties = await getAll('SELECT * FROM properties');
    }

    if (!properties.length) return res.status(404).json({ error: 'No properties found' });

    const results = {};
    for (const p of properties) {
      if (!p.airbnb_url && !p.booking_url) {
        results[p.name] = { skipped: true, reason: 'No listing URLs configured' };
        continue;
      }
      try {
        const counts = await syncReviewsForProperty(p.id);
        results[p.name] = counts;
      } catch (err) {
        results[p.name] = { error: err.message };
      }
    }

    res.json({ results });
  } catch (err) {
    console.error('Review sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Seasonality endpoint ---
router.get('/seasonality', async (req, res) => {
  try {
    const { from, to } = req.query;
    const propIds = scopedPropertyIds(req);
    let properties;
    if (propIds) {
      const pp = [];
      const pf = addPropertyFilter(propIds, 'id', pp);
      properties = await getAll(`SELECT * FROM properties WHERE 1=1${pf}`, pp);
    } else {
      properties = await getAll('SELECT * FROM properties');
    }

    let filters = '';
    const params = [];
    filters += addPropertyFilter(propIds, 'b.property_id', params);
    if (from) {
      filters += ` AND b.check_in >= $${params.length + 1}`;
      params.push(from);
    }
    if (to) {
      filters += ` AND b.check_in <= $${params.length + 1}`;
      params.push(to);
    }

    const bookings = await getAll(
      `SELECT b.*, p.name as property_name, p.base_price as property_base_price FROM bookings b
       JOIN properties p ON b.property_id = p.id
       WHERE b.status = 'confirmed' AND b.platform NOT IN ('Blocked channel', 'Blocked channel auto')${filters}
       ORDER BY b.check_in ASC`,
      params
    );

    // Impute VRBO revenue from base_price when total_price is 0
    for (const b of bookings) {
      if ((b.total_price || 0) === 0 && b.property_base_price && b.property_base_price > 0) {
        const norm = normalizePlatform(b.platform);
        if (norm === 'VRBO') {
          const los = b.length_of_stay || 1;
          b.total_price = b.property_base_price * los;
          b.price_per_night = b.property_base_price;
        }
      }
    }

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    // Group by calendar month across all years
    const monthlyData = {};
    for (let m = 1; m <= 12; m++) {
      monthlyData[m] = { month_num: m, month_name: monthNames[m - 1], total_revenue: 0, total_nights: 0, total_available: 0, booking_count: 0, total_lead_time: 0, years: new Set() };
    }

    // Count occupied nights per month
    const propCount = propIds ? propIds.length : properties.length;
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

    // Compute available nights per month using each month's own years
    for (let m = 1; m <= 12; m++) {
      const monthYears = monthlyData[m].years;
      let totalDays = 0;
      for (const y of monthYears) {
        totalDays += new Date(y, m, 0).getDate();
      }
      monthlyData[m].total_available = totalDays > 0 ? totalDays * propCount : 0;
    }

    // yearCount based on all years seen (for revenue averaging)
    const allYears = new Set();
    for (const md of Object.values(monthlyData)) {
      for (const y of md.years) allYears.add(y);
    }
    const yearCount = Math.max(allYears.size, 1);

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
router.get('/competitors', async (req, res) => {
  const propIds = scopedPropertyIds(req);
  let sql = `SELECT c.*, p.name as property_name FROM competitors c JOIN properties p ON c.property_id = p.id`;
  const params = [];
  if (propIds) {
    const placeholders = propIds.map((_, i) => `$${params.length + i + 1}`).join(',');
    sql += ` WHERE c.property_id IN (${placeholders})`;
    propIds.forEach(id => params.push(id));
  }
  sql += ' ORDER BY c.id DESC';
  const competitors = await getAll(sql, params);
  res.json(competitors);
});

router.post('/competitors', async (req, res) => {
  const { property_id, name, platform, listing_url, listing_id, bedrooms, location, avg_nightly_rate, estimated_occupancy, review_score } = req.body;
  if (!property_id || !name) {
    return res.status(400).json({ error: 'property_id and name are required' });
  }
  const result = await run(
    `INSERT INTO competitors (property_id, name, platform, listing_url, listing_id, bedrooms, location, avg_nightly_rate, estimated_occupancy, review_score, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING id`,
    [property_id, name, platform || '', listing_url || '', listing_id || '', bedrooms || 0, location || '', avg_nightly_rate || 0, estimated_occupancy || 0, review_score || 0]
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.put('/competitors/:id', async (req, res) => {
  const { name, platform, listing_url, listing_id, bedrooms, location, avg_nightly_rate, estimated_occupancy, review_score, property_id } = req.body;
  await run(
    `UPDATE competitors SET name = $1, platform = $2, listing_url = $3, listing_id = $4, bedrooms = $5, location = $6, avg_nightly_rate = $7, estimated_occupancy = $8, review_score = $9, property_id = COALESCE($10, property_id), last_updated = NOW()
     WHERE id = $11`,
    [name, platform || '', listing_url || '', listing_id || '', bedrooms || 0, location || '', avg_nightly_rate || 0, estimated_occupancy || 0, review_score || 0, property_id || null, req.params.id]
  );
  res.json({ updated: true });
});

router.delete('/competitors/:id', async (req, res) => {
  await run('DELETE FROM competitors WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// --- Market Position ---
router.get('/market-position', async (req, res) => {
  const mpPropIds = scopedPropertyIds(req);
  let properties;
  if (mpPropIds) {
    const pp = [];
    const pf = addPropertyFilter(mpPropIds, 'id', pp);
    properties = await getAll(`SELECT * FROM properties WHERE 1=1${pf}`, pp);
  } else {
    properties = await getAll('SELECT * FROM properties');
  }
  const result = [];

  for (const p of properties) {
    // My ADR - from confirmed bookings
    const myStats = await getOne(
      `SELECT AVG(price_per_night) as avg_adr FROM bookings WHERE property_id = $1 AND status = 'confirmed' AND price_per_night > 0`,
      [p.id]
    );
    const myReview = await getOne(
      `SELECT AVG(rating) as avg_rating FROM reviews WHERE property_id = $1 AND rating IS NOT NULL`,
      [p.id]
    );

    const competitors = await getAll(
      `SELECT avg_nightly_rate, review_score FROM competitors WHERE property_id = $1`,
      [p.id]
    );

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

function isBlockedPlatform(platform) {
  if (!platform) return false;
  return platform.toLowerCase().startsWith('blocked');
}

function normalizePlatform(platform) {
  if (!platform) return 'Direct';
  const p = platform.toLowerCase();
  if (p.startsWith('blocked')) return 'Blocked';
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('direct')) return 'Direct';
  if (p.includes('booking')) return 'Booking.com';
  if (p.includes('vrbo') || p.includes('homeaway')) return 'VRBO';
  return 'Direct';
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
