const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

router.get('/:token', (req, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT it.cleaner_id, c.name FROM ical_tokens it JOIN cleaners c ON it.cleaner_id = c.id WHERE it.token = ?'
  ).get(req.params.token);

  if (!row) return res.status(404).send('Not found');

  const jobs = db.prepare(
    `SELECT cj.*, p.name as property_name, p.address as property_address
     FROM cleaning_jobs cj
     JOIN properties p ON cj.property_id = p.id
     WHERE cj.cleaner_id = ?
     ORDER BY cj.cleaning_date ASC`
  ).all(row.cleaner_id);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RentalManager//CleanerCal//EN',
    `X-WR-CALNAME:${row.name} - Cleaning Jobs`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const job of jobs) {
    const dtStart = job.cleaning_date.replace(/-/g, '') + 'T' + (job.start_time || '10:00').replace(':', '') + '00';
    const dtEnd = job.cleaning_date.replace(/-/g, '') + 'T' + (job.end_time || '13:00').replace(':', '') + '00';
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:job-${job.id}@rentalmanager`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:Clean - ${job.property_name}`);
    lines.push(`LOCATION:${(job.property_address || '').replace(/\n/g, '\\n')}`);
    lines.push(`STATUS:${job.status === 'completed' ? 'COMPLETED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${row.name}-calendar.ics"`,
  });
  res.send(lines.join('\r\n'));
});

module.exports = router;
