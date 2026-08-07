/**
 * Pure calculation helpers used by the analytics route.
 *
 * These are extracted here (rather than left as closures inside the route
 * handler) so they can be unit tested without spinning up Express or the DB.
 * Behavior must match the previous inline implementations exactly.
 */

/**
 * Total deductions (commission + bank charges + VAT) for a single booking,
 * in the display currency.
 *
 * Booking fields consumed:
 *   converted_total_price, platform,
 *   prop_commission_airbnb / _booking / _vrbo,
 *   bank_charge_airbnb / _booking / _vrbo,
 *   vat_airbnb / _booking / _vrbo,
 *   property_vat_rate (legacy fallback),
 *   converted_commission (Smoobu fallback when no property rate is set)
 *
 * Direct bookings incur no deductions.
 */
function calcDeductions(b) {
  const rev = b.converted_total_price || 0;
  const platform = (b.platform || '').toLowerCase();
  let commRate = 0, bankRate = 0, vatRate = 0;
  // Direct bookings have no deductions. Check 'direct' first: Smoobu names them
  // "Direct booking", which contains the substring "booking".
  const isDirect = platform.includes('direct');
  if (isDirect) { /* no deductions */ }
  else if (platform.includes('airbnb')) { commRate = b.prop_commission_airbnb || 0; bankRate = b.bank_charge_airbnb || 0; vatRate = b.vat_airbnb || 0; }
  else if (platform.includes('booking')) { commRate = b.prop_commission_booking || 0; bankRate = b.bank_charge_booking || 0; vatRate = b.vat_booking || 0; }
  else if (platform.includes('vrbo')) { commRate = b.prop_commission_vrbo || 0; bankRate = b.bank_charge_vrbo || 0; vatRate = b.vat_vrbo || 0; }
  if (isDirect) return 0;
  // Fall back to legacy vat_rate if per-platform not set
  if (vatRate === 0) vatRate = b.property_vat_rate || 0;
  // If no property-level commission configured, fall back to Smoobu commission
  const commAmount = commRate > 0 ? rev * commRate / 100 : (b.converted_commission || 0);
  const bankAmount = bankRate > 0 ? rev * bankRate / 100 : 0;
  const vatAmount = vatRate > 0 ? (commAmount + bankAmount) * vatRate / 100 : 0;
  return commAmount + bankAmount + vatAmount;
}

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

/**
 * Per-month revenue aggregation across a set of bookings.
 *
 * Returns a sorted array of { month, total, paid, booked, deductions,
 * bookings, nights, first_checkin, last_checkout } — one entry per calendar
 * month, with gaps filled between the first and last observed months.
 *
 * A booking counts toward `paid` if its check_out is on or before `todayStr`,
 * otherwise `booked`. `todayStr` must be a YYYY-MM-DD string.
 */
function aggregateRevenueByMonth(bookings, todayStr) {
  const revenueByMonth = {};
  for (const b of bookings) {
    const month = b.check_in.substring(0, 7);
    if (!revenueByMonth[month]) {
      revenueByMonth[month] = {
        month, total: 0, paid: 0, booked: 0, deductions: 0, bookings: 0, nights: 0,
        first_checkin: b.check_in, last_checkout: b.check_out,
      };
    }
    const rev = b.converted_total_price || 0;
    revenueByMonth[month].total += rev;
    if (b.check_out <= todayStr) {
      revenueByMonth[month].paid += rev;
    } else {
      revenueByMonth[month].booked += rev;
    }
    revenueByMonth[month].deductions += calcDeductions(b);
    revenueByMonth[month].bookings += 1;
    revenueByMonth[month].nights += b.length_of_stay || 1;
    if (b.check_in < revenueByMonth[month].first_checkin) revenueByMonth[month].first_checkin = b.check_in;
    if (b.check_out > revenueByMonth[month].last_checkout) revenueByMonth[month].last_checkout = b.check_out;
  }
  // Fill in missing months so the chart has no gaps
  const monthKeys = Object.keys(revenueByMonth).sort();
  if (monthKeys.length >= 2) {
    const [startY, startM] = monthKeys[0].split('-').map(Number);
    const [endY, endM] = monthKeys[monthKeys.length - 1].split('-').map(Number);
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!revenueByMonth[key]) {
        revenueByMonth[key] = { month: key, total: 0, paid: 0, booked: 0, deductions: 0, bookings: 0, nights: 0 };
      }
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  return Object.values(revenueByMonth).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Per-property revenue aggregation.
 *
 * Returns an array of { property_id, property, total, bookings, nights,
 * top_platform } — one entry per property that appears in `bookings`.
 * Properties with no bookings are not represented.
 */
function aggregateRevenueByProperty(bookings) {
  const byId = new Map();
  const platformCountsById = new Map();
  for (const b of bookings) {
    if (!byId.has(b.property_id)) {
      byId.set(b.property_id, {
        property_id: b.property_id,
        property: b.property_name,
        total: 0,
        bookings: 0,
        nights: 0,
      });
    }
    const row = byId.get(b.property_id);
    row.total += b.converted_total_price || 0;
    row.bookings += 1;
    row.nights += b.length_of_stay || 1;

    const plat = normalizePlatform(b.platform);
    if (!platformCountsById.has(b.property_id)) platformCountsById.set(b.property_id, new Map());
    const counts = platformCountsById.get(b.property_id);
    counts.set(plat, (counts.get(plat) || 0) + 1);
  }
  // Attach the most-common platform per property (ties broken by first-seen).
  for (const [propertyId, counts] of platformCountsById) {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) byId.get(propertyId).top_platform = sorted[0][0];
  }
  return [...byId.values()];
}

/**
 * Per-platform (channel) revenue aggregation.
 *
 * Returns an array of { channel, revenue, bookings, nights, adr } — one entry
 * per canonical platform name (as produced by normalizePlatform). ADR is
 * revenue / nights, rounded to the nearest integer (0 when no nights).
 */
function aggregateRevenueByPlatform(bookings) {
  const byChannel = new Map();
  for (const b of bookings) {
    const ch = normalizePlatform(b.platform);
    if (!byChannel.has(ch)) {
      byChannel.set(ch, { channel: ch, revenue: 0, bookings: 0, nights: 0 });
    }
    const row = byChannel.get(ch);
    row.revenue += b.converted_total_price || 0;
    row.bookings += 1;
    row.nights += b.length_of_stay || 1;
  }
  for (const row of byChannel.values()) {
    row.adr = row.nights > 0 ? Math.round(row.revenue / row.nights) : 0;
  }
  return [...byChannel.values()];
}

/**
 * ADR (Average Daily Rate) per month.
 *
 * Returns an array of { month, adr } sorted ascending. ADR is the total
 * revenue for the month divided by total nights booked, rounded.
 */
function aggregateAdrByMonth(bookings) {
  const byMonth = new Map();
  for (const b of bookings) {
    const month = b.check_in.substring(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { total_revenue: 0, total_nights: 0 });
    const row = byMonth.get(month);
    row.total_revenue += b.converted_total_price || 0;
    row.total_nights += b.length_of_stay || 1;
  }
  return [...byMonth.entries()]
    .map(([month, r]) => ({ month, adr: r.total_nights > 0 ? Math.round(r.total_revenue / r.total_nights) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Portfolio-wide total revenue across all bookings (no grouping).
 *
 * The single-source-of-truth number that every facet aggregation must
 * reconcile against. Used by the reconciliation tests.
 */
function portfolioTotalRevenue(bookings) {
  let total = 0;
  for (const b of bookings) total += b.converted_total_price || 0;
  return total;
}

module.exports = {
  calcDeductions,
  isBlockedPlatform,
  normalizePlatform,
  analyzeSentiment,
  aggregateRevenueByMonth,
  aggregateRevenueByProperty,
  aggregateRevenueByPlatform,
  aggregateAdrByMonth,
  portfolioTotalRevenue,
};
