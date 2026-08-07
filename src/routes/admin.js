/**
 * Admin health-check endpoints — read-only DB introspection for the app
 * owner. Every route here requires role=admin.
 */

const express = require('express');
const router = express.Router();
const { getAll } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const {
  findOverlappingBookings,
  findInvalidBookingDates,
  findCleanerDoubleBookings,
} = require('../services/integrity');

/**
 * GET /api/admin/integrity
 *
 * Runs the pure integrity detectors against current DB state and returns
 * any violations. Zero enforcement — this is a signal, not a gate. If
 * anything shows up here, something wrote impossible data (or the schema
 * changed and a detector is stale).
 *
 * Response shape:
 *   {
 *     ok: boolean,                       // true iff every list is empty
 *     counts: { overlapping_bookings, invalid_dates, cleaner_double_bookings },
 *     overlapping_bookings: [ [ {smoobu_id, property_id, check_in, check_out}, ... ], ... ],
 *     invalid_dates:        [ {smoobu_id, property_id, check_in, check_out}, ... ],
 *     cleaner_double_bookings: [ { cleaner_id, cleaning_date, jobs: [{id, property_id}] }, ... ],
 *   }
 *
 * Cheap to run — three unindexed table scans over data volumes this app
 * ever sees. Not meant for high-frequency polling; a daily cron or
 * on-demand admin click is the intended cadence.
 */
router.get('/integrity', requireRole('admin'), async (req, res) => {
  try {
    const bookings = await getAll(
      `SELECT smoobu_id, property_id, check_in, check_out, status, platform
         FROM bookings`
    );
    const jobs = await getAll(
      `SELECT id, cleaner_id, cleaning_date, status
         FROM cleaning_jobs`
    );

    // Normalise date columns to YYYY-MM-DD strings so the string-comparison
    // detector works — pg returns `date` columns as JS Date objects.
    for (const b of bookings) {
      if (b.check_in instanceof Date) b.check_in = b.check_in.toISOString().slice(0, 10);
      if (b.check_out instanceof Date) b.check_out = b.check_out.toISOString().slice(0, 10);
    }

    const overlapping = findOverlappingBookings(bookings);
    const invalidDates = findInvalidBookingDates(bookings);
    const cleanerDupes = findCleanerDoubleBookings(jobs);

    const trim = (b) => ({
      smoobu_id: Number(b.smoobu_id),
      property_id: b.property_id,
      check_in: b.check_in,
      check_out: b.check_out,
    });
    const trimJob = (j) => ({ id: j.id, property_id: j.property_id, cleaner_id: j.cleaner_id });

    res.json({
      ok: overlapping.length === 0 && invalidDates.length === 0 && cleanerDupes.length === 0,
      counts: {
        overlapping_bookings: overlapping.length,
        invalid_dates: invalidDates.length,
        cleaner_double_bookings: cleanerDupes.length,
      },
      overlapping_bookings: overlapping.map(([a, b]) => [trim(a), trim(b)]),
      invalid_dates: invalidDates.map(trim),
      cleaner_double_bookings: cleanerDupes.map((d) => ({
        cleaner_id: d.cleaner_id,
        cleaning_date: d.cleaning_date,
        jobs: d.jobs.map(trimJob),
      })),
    });
  } catch (err) {
    console.error('Integrity check failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
