/**
 * The competitor check: read every tracked Airbnb calendar, compare it
 * with the last reading, and say which competitors sold which nights.
 *
 * The inference is str-tracker's (docs/algorithm.md there): a night that
 * was open and is now taken was sold or blocked in between. Consecutive
 * taken nights are one stay, and the shape of the stay says which —
 * thirty nights at once is the host closing the calendar, two nights
 * next weekend is a guest. Prices are not part of this; the calendar has
 * none.
 */

const { getAll, getOne, run } = require('../db/database');
const airbnb = require('./airbnb-calendar');
const { notify } = require('./notify');

const DAY = 86400000;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * What a run of taken nights most likely was.
 *
 * Top down, first match wins — the order is the algorithm's.
 */
function classify({ nights, minNights, leadDays, massClose }) {
  if (massClose) return 'block';
  if (nights >= 30) return 'block';
  if (minNights && nights < minNights) return 'block';
  if (leadDays > 365) return 'block';
  if (nights >= 15) return leadDays > 90 ? 'block' : 'ambiguous';
  if (nights >= 2) return leadDays > 180 ? 'ambiguous' : 'booking';
  return leadDays < 14 ? 'booking' : 'ambiguous';
}

/**
 * The difference between two readings of one calendar.
 *
 * `previous` maps date → { available, minNights }; `current` is the new
 * reading. Only nights from `today` on count: the past cannot be sold.
 * A first reading (empty `previous`) finds nothing — there is nothing to
 * compare it with.
 */
function diffCalendar(previous, current, today) {
  const closed = [];
  const opened = [];
  for (const night of current) {
    if (night.date < today) continue;
    const before = previous.get(night.date);
    if (!before) continue;
    if (before.available && !night.available) closed.push({ date: night.date, minNights: before.minNights });
    if (!before.available && night.available) opened.push(night.date);
  }
  closed.sort((a, b) => a.date.localeCompare(b.date));

  // More than sixty nights gone in one go is a host closing the calendar.
  const massClose = closed.length > 60;

  const stays = [];
  let runStart = null;
  let last = null;
  const flush = () => {
    if (!runStart) return;
    const nights = daysBetween(runStart.date, last.date) + 1;
    const leadDays = daysBetween(today, runStart.date);
    stays.push({
      checkIn: runStart.date,
      checkOut: addDays(last.date, 1),
      nights,
      leadDays,
      kind: classify({ nights, minNights: runStart.minNights, leadDays, massClose }),
    });
  };
  for (const night of closed) {
    const continues = last && night.date === addDays(last.date, 1) && night.minNights === runStart.minNights;
    if (!continues) {
      flush();
      runStart = night;
    }
    last = night;
  }
  flush();

  return { stays, opened };
}

/** "14–16 Nov" */
function span(checkIn, checkOut) {
  const f = (d, withMonth) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-ZA', {
    day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC',
  });
  const sameMonth = checkIn.slice(0, 7) === checkOut.slice(0, 7);
  return `${f(checkIn, !sameMonth)}–${f(checkOut, true)}`;
}

/**
 * One notification for a run, however many competitors sold.
 *
 * Two or three runs a day, each able to find several bookings: one
 * message apiece would be a dozen pings a day and muted within a week.
 * The benchmark goes first because it is the one being watched.
 */
function summarise(found) {
  const sales = found.filter((f) => f.kind === 'booking' && !f.listing.is_own);
  if (!sales.length) return null;
  sales.sort((a, b) => Number(b.listing.is_benchmark) - Number(a.listing.is_benchmark) || a.checkIn.localeCompare(b.checkIn));
  const line = (s) => `${s.listing.name} ${span(s.checkIn, s.checkOut)} (${s.nights} night${s.nights === 1 ? '' : 's'})`;
  if (sales.length === 1) {
    return { title: `${sales[0].listing.name} just got booked`, body: `${span(sales[0].checkIn, sales[0].checkOut)}, ${sales[0].nights} night${sales[0].nights === 1 ? '' : 's'}.` };
  }
  return { title: `${sales.length} competitor bookings`, body: sales.map(line).join(' · ') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read every active listing once and record what changed.
 *
 * `fetchCalendar(airbnbId)` is injectable so tests never reach Airbnb.
 * One listing failing does not stop the others; all of them failing is
 * reported, because a check that has silently stopped looks exactly like
 * a quiet market.
 */
async function runPeerCheck({ fetchCalendar, today = new Date().toISOString().slice(0, 10), pauseMs = 1500 } = {}) {
  const listings = await getAll('SELECT * FROM peer_listings WHERE active ORDER BY is_own DESC, is_benchmark DESC, id');
  const { id: runId } = await getOne('INSERT INTO peer_runs DEFAULT VALUES RETURNING id');

  let read = fetchCalendar;
  let setupError = null;
  if (!read) {
    try {
      const hash = await airbnb.calendarHash();
      const key = listings.length ? await airbnb.webKey(listings[0].airbnb_id) : null;
      read = (id) => airbnb.fetchCalendar(id, { key, hash });
    } catch (err) {
      setupError = err.message;
    }
  }

  let ok = 0;
  const failures = [];
  const found = [];

  for (const listing of setupError ? [] : listings) {
    try {
      const nights = await read(listing.airbnb_id);
      const rows = await getAll(
        'SELECT to_char(date, \'YYYY-MM-DD\') AS date, available, min_nights FROM peer_calendar WHERE listing_id = $1',
        [listing.id]
      );
      const previous = new Map(rows.map((r) => [r.date, { available: r.available, minNights: r.min_nights }]));
      const { stays, opened } = diffCalendar(previous, nights, today);

      for (const s of stays) {
        await run(
          `INSERT INTO peer_stays (listing_id, check_in, check_out, nights, kind, lead_days)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [listing.id, s.checkIn, s.checkOut, s.nights, s.kind, s.leadDays]
        );
        found.push({ ...s, listing });
      }

      // A night that opens again inside a recent sale is a cancellation:
      // the sale is marked reversed rather than deleted, so the history
      // still shows it happened.
      if (opened.length) {
        await run(
          `UPDATE peer_stays SET reversed_at = NOW()
            WHERE listing_id = $1 AND reversed_at IS NULL
              AND detected_at > NOW() - INTERVAL '30 days'
              AND EXISTS (SELECT 1 FROM unnest($2::date[]) d WHERE d >= check_in AND d < check_out)`,
          [listing.id, opened]
        );
      }

      // One statement for the year rather than 365.
      await run(
        `INSERT INTO peer_calendar (listing_id, date, available, min_nights, checked_at)
         SELECT $1, d, a, m, NOW()
           FROM unnest($2::date[], $3::boolean[], $4::int[]) AS t(d, a, m)
         ON CONFLICT (listing_id, date) DO UPDATE SET
           available = EXCLUDED.available, min_nights = EXCLUDED.min_nights, checked_at = NOW()`,
        [listing.id, nights.map((n) => n.date), nights.map((n) => n.available), nights.map((n) => n.minNights)]
      );
      ok++;
    } catch (err) {
      failures.push(`${listing.name}: ${err.message}`);
    }
    if (pauseMs) await sleep(pauseMs);
  }

  const failed = setupError ? listings.length : failures.length;
  const error = setupError || (failures.length ? failures.slice(0, 3).join(' · ') : null);
  await run(
    `UPDATE peer_runs SET finished_at = NOW(), listings_ok = $2, listings_failed = $3, stays_found = $4, error = $5 WHERE id = $1`,
    [runId, ok, failed, found.length, error]
  );

  const message = summarise(found);
  if (message) {
    await notify({ event: 'peer_booked', title: message.title, body: message.body, link: '/peers' });
  }

  // Said once a day, not every run: the fix is a five-minute job for a
  // person, and three alerts a day about it would be noise.
  if (listings.length && ok === 0) {
    const already = await getOne(
      `SELECT 1 FROM notifications WHERE event = 'peer_check_failed' AND created_at > NOW() - INTERVAL '20 hours'`
    );
    if (!already) {
      await notify({
        event: 'peer_check_failed',
        title: 'The competitor check could not read Airbnb',
        body: error || 'No listing could be read.',
        link: '/peers',
      });
    }
  }

  return { runId, ok, failed, found };
}

module.exports = { runPeerCheck, diffCalendar, classify, summarise, span };
