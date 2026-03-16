#!/usr/bin/env node
/**
 * Data Validation Script
 * Fetches fresh data from Smoobu API and compares it against the PostgreSQL database.
 * Outputs:
 *   1. exports/smoobu-raw-bookings.csv     — raw Smoobu data for Excel review
 *   2. exports/local-db-bookings.csv       — what's in our database
 *   3. exports/validation-report.csv       — mismatches between the two
 *   4. Console summary of issues found
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const smoobu = require('../src/services/smoobu');
const { getAll, closeDb } = require('../src/db/database');

const EXPORTS_DIR = path.join(__dirname, '..', 'exports');

// --- CSV helpers ---
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(filename, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsv(row[h])).join(','));
  }
  const filepath = path.join(EXPORTS_DIR, filename);
  fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
  console.log(`  Written: ${filepath} (${rows.length} rows)`);
}

// --- Platform normalization (mirrors analytics.js) ---
function normalizePlatform(raw) {
  if (!raw) return 'Direct';
  const lower = raw.toLowerCase();
  if (lower.includes('airbnb')) return 'Airbnb';
  if (lower.includes('booking')) return 'Booking.com';
  if (lower.includes('vrbo') || lower.includes('homeaway')) return 'VRBO';
  if (lower.includes('blocked')) return 'Blocked';
  if (lower.includes('direct') || raw === '') return 'Direct';
  return raw;
}

async function main() {
  // Ensure exports directory exists
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  // --- Step 1: Fetch all bookings from Smoobu ---
  console.log('\n=== FETCHING FROM SMOOBU API ===');
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  const sixMonthsOut = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  console.log(`  Date range: ${twoYearsAgo} to ${sixMonthsOut}`);

  let smoobuBookings;
  try {
    smoobuBookings = await smoobu.getAllBookings({ from: twoYearsAgo, to: sixMonthsOut });
    console.log(`  Fetched ${smoobuBookings.length} bookings from Smoobu`);
  } catch (err) {
    console.error(`  ERROR fetching from Smoobu: ${err.message}`);
    process.exit(1);
  }

  // --- Step 2: Parse Smoobu raw data ---
  const smoobuParsed = smoobuBookings.map(b => {
    const checkIn = b.arrival || b.arrivalDate || '';
    const checkOut = b.departure || b.departureDate || '';
    const createdAt = b['created-at'] || b.createdAt || '';
    const platform = b['channel']?.name || b.channel || '';
    const price = b.price || 0;
    const los = checkIn && checkOut
      ? Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (24 * 60 * 60 * 1000)))
      : 0;
    const ppn = los > 0 ? Math.round((price / los) * 100) / 100 : 0;
    const leadTime = createdAt && checkIn
      ? Math.max(0, Math.round((new Date(checkIn) - new Date(createdAt)) / (24 * 60 * 60 * 1000)))
      : 0;
    const commission = b['commission-included'] || b.commissionIncluded || 0;

    return {
      smoobu_id: b.id,
      apartment_id: b['apartment']?.id || b.apartmentId || '',
      apartment_name: b['apartment']?.name || '',
      guest_name: b['guest-name'] || b.guestName || '',
      check_in: checkIn,
      check_out: checkOut,
      platform_raw: platform,
      platform_normalized: normalizePlatform(platform),
      total_price: price,
      price_per_night: ppn,
      length_of_stay: los,
      lead_time_days: leadTime,
      status: b.type === 'cancellation' ? 'cancelled' : 'confirmed',
      commission: commission,
      num_guests: b.adults || 1,
      children: b.children || 0,
      language: b.language || '',
      created_at: createdAt,
      type_raw: b.type || '',
    };
  });

  // --- Step 3: Get local DB bookings ---
  console.log('\n=== READING LOCAL DATABASE ===');
  const localBookings = await getAll(`
    SELECT b.*, p.name as property_name, p.smoobu_id as property_smoobu_id, p.base_price
    FROM bookings b
    LEFT JOIN properties p ON b.property_id = p.id
    ORDER BY b.check_in ASC
  `);
  console.log(`  Found ${localBookings.length} bookings in local DB`);

  // --- Step 4: Write raw CSVs ---
  console.log('\n=== EXPORTING CSVs ===');

  const smoobuHeaders = [
    'smoobu_id', 'apartment_id', 'apartment_name', 'guest_name',
    'check_in', 'check_out', 'platform_raw', 'platform_normalized',
    'total_price', 'price_per_night', 'length_of_stay', 'lead_time_days',
    'status', 'commission', 'num_guests', 'children', 'language',
    'created_at', 'type_raw'
  ];
  writeCsv('smoobu-raw-bookings.csv', smoobuHeaders, smoobuParsed);

  const localHeaders = [
    'id', 'smoobu_id', 'property_id', 'property_name', 'property_smoobu_id',
    'guest_name', 'check_in', 'check_out', 'platform', 'total_price',
    'price_per_night', 'length_of_stay', 'lead_time_days', 'status',
    'commission', 'num_guests', 'children', 'language', 'guest_country',
    'created_at', 'base_price'
  ];
  writeCsv('local-db-bookings.csv', localHeaders, localBookings);

  // --- Step 5: Compare and find mismatches ---
  console.log('\n=== VALIDATING DATA ===');

  const localBySmoobuId = new Map();
  for (const b of localBookings) {
    localBySmoobuId.set(String(b.smoobu_id), b);
  }

  const smoobuById = new Map();
  for (const b of smoobuParsed) {
    smoobuById.set(String(b.smoobu_id), b);
  }

  const issues = [];
  let stats = {
    matched: 0,
    missing_in_db: 0,
    missing_in_smoobu: 0,
    price_mismatch: 0,
    date_mismatch: 0,
    status_mismatch: 0,
    platform_mismatch: 0,
    los_mismatch: 0,
    ppn_mismatch: 0,
    commission_mismatch: 0,
    lead_time_mismatch: 0,
    zero_price_non_blocked: 0,
    vrbo_zero_price: 0,
    no_property_match: 0,
  };

  // Check each Smoobu booking against local DB
  for (const s of smoobuParsed) {
    const local = localBySmoobuId.get(String(s.smoobu_id));

    if (!local) {
      stats.missing_in_db++;
      issues.push({
        smoobu_id: s.smoobu_id,
        issue_type: 'MISSING_IN_DB',
        field: '',
        smoobu_value: `${s.guest_name} | ${s.check_in} - ${s.check_out} | ${s.platform_raw}`,
        local_value: '',
        severity: 'HIGH',
        notes: 'Booking exists in Smoobu but not in local DB',
      });
      continue;
    }

    stats.matched++;
    const bookingIssues = [];

    // Price comparison
    const sPriceNum = Number(s.total_price) || 0;
    const lPriceNum = Number(local.total_price) || 0;
    if (Math.abs(sPriceNum - lPriceNum) > 0.01) {
      stats.price_mismatch++;
      bookingIssues.push({
        issue_type: 'PRICE_MISMATCH',
        field: 'total_price',
        smoobu_value: sPriceNum,
        local_value: lPriceNum,
        severity: 'HIGH',
        notes: `Diff: ${(lPriceNum - sPriceNum).toFixed(2)}`,
      });
    }

    // Date comparison
    if (s.check_in !== local.check_in) {
      stats.date_mismatch++;
      bookingIssues.push({
        issue_type: 'DATE_MISMATCH',
        field: 'check_in',
        smoobu_value: s.check_in,
        local_value: local.check_in,
        severity: 'HIGH',
        notes: '',
      });
    }
    if (s.check_out !== local.check_out) {
      stats.date_mismatch++;
      bookingIssues.push({
        issue_type: 'DATE_MISMATCH',
        field: 'check_out',
        smoobu_value: s.check_out,
        local_value: local.check_out,
        severity: 'HIGH',
        notes: '',
      });
    }

    // Status comparison
    if (s.status !== local.status) {
      stats.status_mismatch++;
      bookingIssues.push({
        issue_type: 'STATUS_MISMATCH',
        field: 'status',
        smoobu_value: s.status,
        local_value: local.status,
        severity: 'HIGH',
        notes: '',
      });
    }

    // Platform comparison (normalized)
    const localNorm = normalizePlatform(local.platform);
    if (s.platform_normalized !== localNorm) {
      stats.platform_mismatch++;
      bookingIssues.push({
        issue_type: 'PLATFORM_MISMATCH',
        field: 'platform',
        smoobu_value: `${s.platform_raw} → ${s.platform_normalized}`,
        local_value: `${local.platform} → ${localNorm}`,
        severity: 'MEDIUM',
        notes: '',
      });
    }

    // Length of stay
    if (Math.abs(s.length_of_stay - (local.length_of_stay || 0)) > 0) {
      stats.los_mismatch++;
      bookingIssues.push({
        issue_type: 'LOS_MISMATCH',
        field: 'length_of_stay',
        smoobu_value: s.length_of_stay,
        local_value: local.length_of_stay,
        severity: 'MEDIUM',
        notes: '',
      });
    }

    // Price per night
    const sPpn = Number(s.price_per_night) || 0;
    const lPpn = Number(local.price_per_night) || 0;
    if (Math.abs(sPpn - lPpn) > 1) {  // Allow R1 rounding tolerance
      stats.ppn_mismatch++;
      bookingIssues.push({
        issue_type: 'PPN_MISMATCH',
        field: 'price_per_night',
        smoobu_value: sPpn,
        local_value: lPpn,
        severity: 'MEDIUM',
        notes: `Diff: ${(lPpn - sPpn).toFixed(2)}`,
      });
    }

    // Commission
    const sComm = Number(s.commission) || 0;
    const lComm = Number(local.commission) || 0;
    if (Math.abs(sComm - lComm) > 0.01) {
      stats.commission_mismatch++;
      bookingIssues.push({
        issue_type: 'COMMISSION_MISMATCH',
        field: 'commission',
        smoobu_value: sComm,
        local_value: lComm,
        severity: 'MEDIUM',
        notes: `Diff: ${(lComm - sComm).toFixed(2)}`,
      });
    }

    // Lead time
    if (Math.abs(s.lead_time_days - (local.lead_time_days || 0)) > 1) {  // 1-day tolerance
      stats.lead_time_mismatch++;
      bookingIssues.push({
        issue_type: 'LEAD_TIME_MISMATCH',
        field: 'lead_time_days',
        smoobu_value: s.lead_time_days,
        local_value: local.lead_time_days,
        severity: 'LOW',
        notes: '',
      });
    }

    // Flag: zero price on non-blocked bookings
    if (sPriceNum === 0 && s.platform_normalized !== 'Blocked') {
      stats.zero_price_non_blocked++;
      if (s.platform_normalized === 'VRBO') stats.vrbo_zero_price++;
      bookingIssues.push({
        issue_type: 'ZERO_PRICE',
        field: 'total_price',
        smoobu_value: 0,
        local_value: lPriceNum,
        severity: lPriceNum > 0 ? 'HIGH' : 'MEDIUM',
        notes: lPriceNum > 0
          ? `DB has ${lPriceNum} (likely imputed from base_price ${local.base_price})`
          : `Both Smoobu and DB have 0 — revenue missing`,
      });
    }

    // Flag: no property match
    if (!local.property_id) {
      stats.no_property_match++;
      bookingIssues.push({
        issue_type: 'NO_PROPERTY_MATCH',
        field: 'property_id',
        smoobu_value: s.apartment_id,
        local_value: 'NULL',
        severity: 'HIGH',
        notes: 'Booking has no linked property — smoobu_id mismatch in properties table?',
      });
    }

    for (const issue of bookingIssues) {
      issues.push({
        smoobu_id: s.smoobu_id,
        guest_name: s.guest_name,
        check_in: s.check_in,
        platform: s.platform_normalized,
        ...issue,
      });
    }
  }

  // Check for bookings in DB but not in Smoobu
  for (const local of localBookings) {
    if (!smoobuById.has(String(local.smoobu_id))) {
      stats.missing_in_smoobu++;
      issues.push({
        smoobu_id: local.smoobu_id,
        guest_name: local.guest_name,
        check_in: local.check_in,
        platform: local.platform,
        issue_type: 'MISSING_IN_SMOOBU',
        field: '',
        smoobu_value: '',
        local_value: `${local.guest_name} | ${local.check_in} - ${local.check_out} | ${local.platform}`,
        severity: 'MEDIUM',
        notes: 'In local DB but not returned by Smoobu (may be outside date range or deleted)',
      });
    }
  }

  // Write validation report CSV
  const reportHeaders = [
    'smoobu_id', 'guest_name', 'check_in', 'platform',
    'issue_type', 'field', 'smoobu_value', 'local_value',
    'severity', 'notes'
  ];
  writeCsv('validation-report.csv', reportHeaders, issues);

  // --- Step 6: Print summary ---
  console.log('\n=== VALIDATION SUMMARY ===');
  console.log(`  Smoobu bookings:       ${smoobuParsed.length}`);
  console.log(`  Local DB bookings:     ${localBookings.length}`);
  console.log(`  Matched:               ${stats.matched}`);
  console.log('');
  console.log('  ISSUES FOUND:');
  console.log(`  Missing in DB:         ${stats.missing_in_db}   (in Smoobu, not in DB)`);
  console.log(`  Missing in Smoobu:     ${stats.missing_in_smoobu}   (in DB, not in Smoobu)`);
  console.log(`  Price mismatches:      ${stats.price_mismatch}`);
  console.log(`  Date mismatches:       ${stats.date_mismatch}`);
  console.log(`  Status mismatches:     ${stats.status_mismatch}`);
  console.log(`  Platform mismatches:   ${stats.platform_mismatch}`);
  console.log(`  LOS mismatches:        ${stats.los_mismatch}`);
  console.log(`  PPN mismatches:        ${stats.ppn_mismatch}`);
  console.log(`  Commission mismatches: ${stats.commission_mismatch}`);
  console.log(`  Lead time mismatches:  ${stats.lead_time_mismatch}`);
  console.log(`  Zero price (non-block):${stats.zero_price_non_blocked}  (VRBO: ${stats.vrbo_zero_price})`);
  console.log(`  No property match:     ${stats.no_property_match}`);
  console.log(`\n  Total issues:          ${issues.length}`);

  // Highlight critical findings
  const highSeverity = issues.filter(i => i.severity === 'HIGH');
  if (highSeverity.length > 0) {
    console.log(`\n  ⚠ ${highSeverity.length} HIGH severity issues — check validation-report.csv`);
  }

  // Revenue impact summary
  const priceIssues = issues.filter(i => i.issue_type === 'PRICE_MISMATCH');
  if (priceIssues.length > 0) {
    let totalOverstated = 0;
    let totalUnderstated = 0;
    for (const p of priceIssues) {
      const diff = Number(p.local_value) - Number(p.smoobu_value);
      if (diff > 0) totalOverstated += diff;
      else totalUnderstated += Math.abs(diff);
    }
    console.log(`\n  REVENUE IMPACT:`);
    console.log(`  DB overstated by:      R ${totalOverstated.toFixed(2)}`);
    console.log(`  DB understated by:     R ${totalUnderstated.toFixed(2)}`);
  }

  const zeroIssues = issues.filter(i => i.issue_type === 'ZERO_PRICE');
  if (zeroIssues.length > 0) {
    const imputed = zeroIssues.filter(i => Number(i.local_value) > 0);
    const imputedTotal = imputed.reduce((sum, i) => sum + Number(i.local_value), 0);
    if (imputed.length > 0) {
      console.log(`  Imputed revenue (est): R ${imputedTotal.toFixed(2)} across ${imputed.length} bookings`);
    }
  }

  console.log('\n=== FILES EXPORTED ===');
  console.log(`  ${EXPORTS_DIR}/smoobu-raw-bookings.csv   — raw Smoobu data`);
  console.log(`  ${EXPORTS_DIR}/local-db-bookings.csv     — your database`);
  console.log(`  ${EXPORTS_DIR}/validation-report.csv     — all mismatches`);
  console.log('\nOpen these in Excel to investigate further.\n');

  await closeDb();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
