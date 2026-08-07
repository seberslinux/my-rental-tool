/**
 * Public holiday calculation — pure, offline, no dependencies.
 *
 * Holidays matter here for two different reasons, and the UI distinguishes
 * them:
 *
 *   - **South Africa** is where the properties are. A local public holiday
 *     affects cleaner availability and local weekend demand.
 *   - **Guest-source countries** drive inbound demand: German Easter
 *     fills rooms in Cape Town. Only Germany and the UK are tracked —
 *     they are the source markets with real volume (42 and 11 bookings
 *     against 4–6 each for Switzerland, the Netherlands and the US), and
 *     every extra country dilutes a short list. Switzerland in particular
 *     drowned it: its holidays are cantonal, so it contributed 23 entries
 *     against Germany's 9 and pushed Germany off the panel.
 *
 * Everything is computed from rules rather than listed, so the data never
 * expires and never needs maintenance. The rules are of four kinds:
 *
 *   1. Fixed date            — 25 Dec
 *   2. Easter-relative       — Good Friday is Easter − 2
 *   3. Nth weekday of month  — the UK's Spring Bank Holiday is the last
 *                              Monday in May
 *   4. Observance shifts     — a holiday landing on a weekend moves, and
 *                              each country has its own rule for how
 *
 * Rule 4 is the one a hardcoded list always gets wrong. South Africa's
 * Public Holidays Act moves a Sunday holiday to the Monday, which is why
 * Women's Day (9 August) is observed on Monday 10 August 2026.
 *
 * Scope note: Germany devolves some holidays to its states. Only the
 * nationwide ones are included — the goal is a demand signal, not a
 * payroll calendar.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Property location. Holidays here affect operations (cleaners, local
// demand) rather than inbound travel.
const HOME_COUNTRY = 'ZA';

const COUNTRY_NAMES = {
  ZA: 'South Africa',
  DE: 'Germany',
  GB: 'United Kingdom',
};

// --- date helpers --------------------------------------------------------

function ymd(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function parse(dateStr) {
  return Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
}

function addDays(dateStr, days) {
  return new Date(parse(dateStr) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
function dayOfWeek(dateStr) {
  return new Date(parse(dateStr)).getUTCDay();
}

/**
 * Date of the `n`th `weekday` in a month; `n = -1` means the last one.
 * e.g. nthWeekday(2026, 11, 4, 4) → 4th Thursday of November 2026.
 */
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = ymd(year, month, 1);
    const offset = (weekday - dayOfWeek(first) + 7) % 7;
    return addDays(first, offset + (n - 1) * 7);
  }
  // Last occurrence: walk back from the final day of the month.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = ymd(year, month, lastDay);
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

/**
 * Easter Sunday (Gregorian), via the Anonymous Gregorian algorithm.
 * Every Easter-relative holiday in every country here derives from this.
 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

// --- observance rules ----------------------------------------------------

/** South Africa: a holiday falling on a Sunday is observed on the Monday. */
function shiftSundayToMonday(dateStr) {
  return dayOfWeek(dateStr) === 0 ? addDays(dateStr, 1) : dateStr;
}

/**
 * UK: a bank holiday on a weekend gets a substitute weekday. Christmas and
 * Boxing Day can collide, so a substitute already claimed pushes to the
 * next free day — `taken` carries the dates already assigned.
 */
function shiftUkSubstitute(dateStr, taken) {
  let d = dateStr;
  const dow = dayOfWeek(d);
  if (dow === 6) d = addDays(d, 2);
  else if (dow === 0) d = addDays(d, 1);
  while (taken.has(d)) d = addDays(d, 1);
  return d;
}

// --- per-country rules ---------------------------------------------------

function southAfrica(year) {
  const easter = easterSunday(year);
  const fixed = [
    [ymd(year, 1, 1), "New Year's Day"],
    [ymd(year, 3, 21), 'Human Rights Day'],
    [ymd(year, 4, 27), 'Freedom Day'],
    [ymd(year, 5, 1), "Workers' Day"],
    [ymd(year, 6, 16), 'Youth Day'],
    [ymd(year, 8, 9), "National Women's Day"],
    [ymd(year, 9, 24), 'Heritage Day'],
    [ymd(year, 12, 16), 'Day of Reconciliation'],
    [ymd(year, 12, 25), 'Christmas Day'],
    [ymd(year, 12, 26), 'Day of Goodwill'],
  ];
  const out = fixed.map(([date, name]) => ({ date: shiftSundayToMonday(date), name }));
  // Easter holidays always land on a Friday/Monday — no shift needed.
  out.push({ date: addDays(easter, -2), name: 'Good Friday' });
  out.push({ date: addDays(easter, 1), name: 'Family Day' });
  return out;
}

function germany(year) {
  const easter = easterSunday(year);
  return [
    { date: ymd(year, 1, 1), name: 'Neujahr' },
    { date: addDays(easter, -2), name: 'Karfreitag' },
    { date: addDays(easter, 1), name: 'Ostermontag' },
    { date: ymd(year, 5, 1), name: 'Tag der Arbeit' },
    { date: addDays(easter, 39), name: 'Christi Himmelfahrt' },
    { date: addDays(easter, 50), name: 'Pfingstmontag' },
    { date: ymd(year, 10, 3), name: 'Tag der Deutschen Einheit' },
    { date: ymd(year, 12, 25), name: '1. Weihnachtstag' },
    { date: ymd(year, 12, 26), name: '2. Weihnachtstag' },
  ];
}

function unitedKingdom(year) {
  const easter = easterSunday(year);
  const taken = new Set();
  const out = [];

  const addFixed = (date, name) => {
    const observed = shiftUkSubstitute(date, taken);
    taken.add(observed);
    out.push({ date: observed, name });
  };

  addFixed(ymd(year, 1, 1), "New Year's Day");
  out.push({ date: addDays(easter, -2), name: 'Good Friday' });
  out.push({ date: addDays(easter, 1), name: 'Easter Monday' });
  out.push({ date: nthWeekday(year, 5, 1, 1), name: 'Early May Bank Holiday' });
  out.push({ date: nthWeekday(year, 5, 1, -1), name: 'Spring Bank Holiday' });
  out.push({ date: nthWeekday(year, 8, 1, -1), name: 'Summer Bank Holiday' });
  addFixed(ymd(year, 12, 25), 'Christmas Day');
  addFixed(ymd(year, 12, 26), 'Boxing Day');

  return out;
}
const RULES = {
  ZA: southAfrica,
  DE: germany,
  GB: unitedKingdom,
};

const DEFAULT_COUNTRIES = Object.keys(RULES);

// --- public API ----------------------------------------------------------

/** Every holiday for one country in one year, sorted by date. */
function holidaysForCountry(country, year) {
  const rule = RULES[country];
  if (!rule) return [];
  return rule(year)
    .map((h) => ({
      ...h,
      country,
      country_name: COUNTRY_NAMES[country],
      is_local: country === HOME_COUNTRY,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Holidays falling in `[fromStr, fromStr + days)` across `countries`,
 * sorted by date then country.
 *
 * Spans the year boundary correctly — a window opening in December picks
 * up January's holidays by computing both years.
 */
function upcomingHolidays(fromStr, { countries = DEFAULT_COUNTRIES, days = 90 } = {}) {
  const toStr = addDays(fromStr, days);
  const years = new Set([
    Number(fromStr.slice(0, 4)),
    Number(toStr.slice(0, 4)),
  ]);

  const all = [];
  for (const country of countries) {
    for (const year of years) {
      all.push(...holidaysForCountry(country, year));
    }
  }

  return all
    .filter((h) => h.date >= fromStr && h.date < toStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
}

module.exports = {
  easterSunday,
  nthWeekday,
  holidaysForCountry,
  upcomingHolidays,
  HOME_COUNTRY,
  COUNTRY_NAMES,
  DEFAULT_COUNTRIES,
};
