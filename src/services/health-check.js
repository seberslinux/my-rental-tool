/**
 * Whether the settings nobody looks at are still right.
 *
 * Every expensive mistake of the last year was a setting, not a
 * decision. A "block one day after booking" rule cost the Lodge about
 * R60k. A base price of R90–110 on The loft sold April–July nights on
 * Booking.com for R113 a night. The loft reached thirty days ahead on
 * Booking.com while the Lodge had a year. None of it appeared anywhere:
 * each was found by somebody auditing by hand, months late.
 *
 * What they have in common is that the app held enough to notice. The
 * rates were in Smoobu, the horizon was in Smoobu, the markups were in
 * the database. Nothing asked the question. This module asks it.
 *
 * ## Monitoring, not pricing
 *
 * It reads and reports. It does not write a rate, does not touch Smoobu
 * beyond a GET, and does not decide what a night should cost. The
 * pricing engine stays off until a person approves a diff; this is the
 * thing that tells them there is one to look at.
 *
 * ## Why a floor is a setting and not a constant
 *
 * R1,500 is the right floor for these two flats this year. It is not a
 * fact about short-term rentals, and a constant here would be the same
 * class of mistake it is meant to catch — a number nobody can see,
 * governing an alert they cannot tune. So the floor and ceiling live on
 * the property, and a property with no floor is reported as unchecked
 * rather than quietly passed.
 *
 * ## Why the markup is not typed in here either
 *
 * The guest price is the one that mattered in the Booking.com incident:
 * the base was R90 and the guest paid R113, and it is R113 that was
 * absurd. Working it out needs the channel's markup, which Smoobu owns.
 * `guest_markup_*` on the property is what somebody has entered;
 * `observedMarkup` is what the last few bookings imply. This prefers the
 * entered figure, falls back to the observed one when it is confident,
 * and otherwise says it could not check that channel — rather than
 * assuming 20.5% and 25%, which are this month's values for these two
 * listings and would rot in place.
 */

const { addDays, daysBetween } = require('./dashboard-calc');
const { guestPrice, CHANNELS } = require('./channel-price');
const { normalizeRate } = require('./rate-sync');

/**
 * How far ahead a listing is meant to be open for sale, and how short it
 * may fall before that is an emergency.
 *
 * A year is the target because that is what the Lodge already had and
 * what the channels allow. Three hundred days is the alarm: a listing
 * that stops there has probably stopped for a reason — a rate plan that
 * ran out, a channel that never got the later dates — and under 300 the
 * loss is no longer theoretical, it is next season.
 */
const TARGET_DAYS = 365;
const RED_DAYS = 300;

/** How many example dates a finding carries. The count is the fact; the dates are so somebody can go and look. */
const EXAMPLES = 5;

const SEVERITY_ORDER = { green: 0, amber: 1, red: 2 };

/** The worse of two colours, so a roll-up cannot be greener than its parts. */
function worse(a, b) {
  return SEVERITY_ORDER[b] > SEVERITY_ORDER[a] ? b : a;
}

/** The colour of a set of findings. No findings is green; this is the only place that decides. */
function statusOf(findings) {
  return findings.reduce((s, f) => worse(s, f.severity), 'green');
}

/**
 * Smoobu's rate payload as plain `{ date: {price, available, minStay} }`.
 *
 * Through `normalizeRate` rather than reading `.price` directly: the
 * field is `price` on some responses and `daily_price` on others, and
 * `available` is omitted entirely on open days. The calendar learned
 * that the hard way and the parser lives in one place.
 */
function readRates(byDate) {
  const out = {};
  for (const [date, info] of Object.entries(byDate || {})) {
    out[date] = normalizeRate(info);
  }
  return out;
}

/**
 * How far ahead there is an unbroken run of prices.
 *
 * Unbroken on purpose. A listing priced to next December with a hole in
 * March is not priced to next December: the hole is where a guest
 * searching those nights finds nothing, and a horizon that stepped over
 * it would report a year of cover that does not exist.
 *
 * Availability is deliberately not required. A booked night is
 * unavailable and correctly so — counting it as the end of the horizon
 * would turn a full calendar into an alert.
 */
function horizonFrom(rates, today, days = TARGET_DAYS) {
  let last = null;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const row = rates[date];
    if (!row || !(row.price > 0)) break;
    last = date;
  }
  return {
    priced_to: last,
    days: last ? daysBetween(today, last) : 0,
    target: days,
  };
}

/**
 * The markup to use for each channel, and where it came from.
 *
 * An entered figure beats an observed one — somebody read it off the
 * channel's own settings page, which is closer to the truth than a
 * ratio inferred from six bookings. An observed figure is used only
 * when `observedMarkup` calls itself confident, because its own header
 * says an unconfident median is the middle of some noise.
 */
function effectiveMarkups(property = {}, observed = {}) {
  const out = {};
  for (const c of CHANNELS) {
    const entered = Number(property[`guest_markup_${c.key}`]);
    if (Number.isFinite(entered) && entered > 0) {
      out[c.key] = { label: c.label, percent: entered, source: 'setting' };
      continue;
    }
    const seen = observed[c.key];
    if (seen && seen.confident && seen.markup > 0) {
      out[c.key] = { label: c.label, percent: seen.markup, source: 'observed' };
      continue;
    }
    out[c.key] = null;
  }
  return out;
}

/** A finding, with its examples trimmed and its count kept whole. */
function finding(key, severity, title, detail, dates = []) {
  return {
    key,
    severity,
    title,
    detail,
    count: dates.length,
    examples: dates.slice(0, EXAMPLES),
  };
}

/**
 * Everything wrong with one listing's next year.
 *
 * `rates` is Smoobu's payload for this apartment, `observed` is
 * `observedMarkup`'s output for this property, and `today` is passed in
 * rather than read from the clock so the result is a calculation.
 */
function checkProperty({ property, rates, observed = {}, today, days = TARGET_DAYS, error = null }) {
  const name = property.name || `Property ${property.id}`;

  // A failed fetch is a red, never a green with nothing in it. Rates
  // failed silently for months behind a sync that reported success, and
  // a health check that does the same thing is worse than none.
  if (error) {
    const f = finding('fetch_failed', 'red',
      `Could not read ${name}'s rates from Smoobu`,
      `${error}. Nothing below has been checked.`);
    return { property_id: property.id, property: name, status: 'red', horizon: null, findings: [f] };
  }

  const byDate = readRates(rates);
  const horizon = horizonFrom(byDate, today, days);
  const findings = [];

  if (horizon.days < RED_DAYS) {
    findings.push(finding('horizon', 'red',
      horizon.priced_to ?
        `${name} is only on sale for ${horizon.days} more days` :
        `${name} has no price for tonight`,
      horizon.priced_to ?
        `Prices run out after ${horizon.priced_to}. The target is ${days} days.` :
        `Smoobu returned no usable price from ${today} onwards.`));
  } else if (horizon.days < days) {
    findings.push(finding('horizon', 'amber',
      `${name} is on sale for ${horizon.days} of ${days} days`,
      `Prices run out after ${horizon.priced_to}.`));
  }

  const floor = Number(property.price_floor) || 0;
  const ceiling = Number(property.price_ceiling) || 0;
  const markups = effectiveMarkups(property, observed);

  if (floor <= 0) {
    // Amber rather than a silent pass. An unset floor is exactly the
    // kind of setting this check exists to find, and it stops being
    // amber the moment somebody enters one.
    findings.push(finding('no_floor', 'amber',
      `No price floor set for ${name}`,
      'Set one on the Rates page and these nights get checked against it.'));
  }

  const below = [];
  const above = [];
  const belowOnChannel = {};

  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const row = byDate[date];
    if (!row || !(row.price > 0)) continue;

    if (floor > 0 && row.price < floor) below.push(date);
    if (ceiling > 0 && row.price > ceiling) above.push(date);

    if (floor > 0) {
      for (const [key, m] of Object.entries(markups)) {
        if (!m) continue;
        // What the guest is actually charged, through the one function
        // that knows a markup is a fraction of the base.
        if (guestPrice(row.price, m.percent) < floor) {
          (belowOnChannel[key] = belowOnChannel[key] || []).push(date);
        }
      }
    }
  }

  if (below.length) {
    findings.push(finding('below_floor', 'red',
      `${below.length} night${below.length === 1 ? '' : 's'} priced under R${floor.toLocaleString('en-ZA')} at ${name}`,
      'Your own rate is below the floor, before any channel adds anything.',
      below));
  }

  for (const [key, dates] of Object.entries(belowOnChannel)) {
    const m = markups[key];
    findings.push(finding(`below_floor_${key}`, 'red',
      `${dates.length} night${dates.length === 1 ? '' : 's'} sell on ${m.label} under R${floor.toLocaleString('en-ZA')}`,
      `At ${m.percent}% on top (${m.source === 'observed' ? 'observed from your bookings' : 'from the property setting'}), ` +
      'that is what the guest pays.',
      dates));
  }

  if (above.length) {
    // Amber: a price too high loses a booking, which is recoverable.
    // A price too low sells the night at a loss, which is not.
    findings.push(finding('above_ceiling', 'amber',
      `${above.length} night${above.length === 1 ? '' : 's'} priced over R${ceiling.toLocaleString('en-ZA')} at ${name}`,
      'Left over from dynamic pricing, or a layer applied twice.',
      above));
  }

  return {
    property_id: property.id,
    property: name,
    status: statusOf(findings),
    horizon,
    findings,
  };
}

/** One colour for the card, from every listing's. */
function rollUp(results = []) {
  return results.reduce((s, r) => worse(s, r.status), 'green');
}

module.exports = {
  checkProperty, rollUp, horizonFrom, effectiveMarkups, readRates, statusOf, worse,
  TARGET_DAYS, RED_DAYS,
};

/* ---------------------------------------------------------------------- *
 * Running it
 *
 * Everything above is a calculation on data handed to it. Below is the
 * part that goes and gets the data, writes down what it found, and tells
 * somebody — kept apart so the judgement can be tested without a
 * network or a database.
 * ---------------------------------------------------------------------- */

const smoobu = require('./smoobu');
const { getAll, getOne, run } = require('../db/database');
const { getApiKeyForProperty } = require('./api-key-resolver');
const { observedMarkup } = require('./observed-markup');
const { notify } = require('./notify');

/**
 * Check every listing and record the answer.
 *
 * A full year per property, which is one GET each — the dashboard must
 * not pay for that on every load, so the result is stored and the card
 * reads the stored row. `today` is injectable for the tests.
 *
 * A property whose fetch fails is recorded as red with the provider's
 * own message rather than skipped. One bad key must not cost the others
 * their check, and it must not be reported as health either.
 */
async function runHealthCheck({ today = new Date().toISOString().slice(0, 10), days = TARGET_DAYS, announce = true } = {}) {
  const properties = await getAll('SELECT * FROM properties ORDER BY name');
  const to = addDays(today, days);
  const results = [];

  for (const property of properties) {
    let rates = null;
    let error = null;
    try {
      const apiKey = await getApiKeyForProperty(property.id);
      const payload = await smoobu.getRates(property.smoobu_id, today, to, apiKey);
      rates = payload?.data?.[property.smoobu_id] || payload?.[property.smoobu_id] || {};
    } catch (err) {
      error = err.message;
    }

    // What the last few bookings imply each channel is adding, for the
    // properties that have not had a markup entered. Best effort: a
    // listing with no synced rates has nothing to observe, and that is
    // not a reason to fail the check.
    let observed = {};
    try {
      const [bookings, rateRows] = await Promise.all([
        getAll(
          `SELECT total_price, commission, platform, check_in, check_out, status
             FROM bookings WHERE property_id = $1 AND check_out >= $2`,
          [property.id, today]
        ),
        getAll('SELECT date, price FROM daily_rates WHERE property_id = $1', [property.id]),
      ]);
      const byDate = {};
      for (const r of rateRows) byDate[String(r.date).slice(0, 10)] = Number(r.price);
      observed = observedMarkup({ bookings, rates: byDate });
    } catch (err) {
      console.error(`Observed markup unavailable for ${property.name}: ${err.message}`);
    }

    const result = checkProperty({ property, rates, observed, today, days, error });
    results.push(result);

    await run(
      `INSERT INTO channel_health (property_id, ran_at, status, report)
       VALUES ($1, NOW(), $2, $3)
       ON CONFLICT (property_id) DO UPDATE SET
         ran_at = NOW(), status = EXCLUDED.status, report = EXCLUDED.report`,
      [property.id, result.status, JSON.stringify(result)]
    );
  }

  const status = rollUp(results);

  /**
   * Only red interrupts.
   *
   * The house rule is that everything is recorded and only exceptions
   * are sent. Amber is a thing to look at on the dashboard; red is a
   * listing selling nights at R113 or shut for the next season, and that
   * is worth a phone buzzing. An amber alert every morning is how the
   * channel gets muted before the red one arrives.
   */
  if (announce) {
    for (const r of results.filter((r) => r.status === 'red')) {
      const worst = r.findings.find((f) => f.severity === 'red');
      await notify({
        event: 'channel_health_red',
        title: worst ? worst.title : `Something is wrong with ${r.property}`,
        body: r.findings.filter((f) => f.severity === 'red').map((f) => `${f.title}. ${f.detail}`).join('\n'),
        propertyId: r.property_id,
        link: '/rates',
      });
    }
  }

  return { status, results, ran_at: new Date().toISOString() };
}

/**
 * The last answer, for the properties somebody may see.
 *
 * Never recomputed on read. A dashboard that triggered two Smoobu calls
 * per load would be slow on a good day and blank on a bad one, and the
 * question it answers — "was anything wrong this morning?" — does not
 * change between now and the next run.
 */
async function latestHealth(propertyIds = null) {
  const rows = await getAll(
    propertyIds === null ?
      `SELECT ch.*, p.name FROM channel_health ch JOIN properties p ON p.id = ch.property_id ORDER BY p.name` :
      `SELECT ch.*, p.name FROM channel_health ch JOIN properties p ON p.id = ch.property_id
        WHERE ch.property_id = ANY($1) ORDER BY p.name`,
    propertyIds === null ? [] : [propertyIds]
  );

  const results = rows.map((r) => ({
    ...(typeof r.report === 'string' ? JSON.parse(r.report) : r.report),
    ran_at: r.ran_at,
  }));

  return {
    status: rollUp(results),
    results,
    // The oldest run on the card, because a card showing one fresh
    // property and one from last week is as stale as its worst row.
    ran_at: rows.length ? rows.map((r) => r.ran_at).sort()[0] : null,
  };
}

module.exports.runHealthCheck = runHealthCheck;
module.exports.latestHealth = latestHealth;
