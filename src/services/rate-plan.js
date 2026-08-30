/**
 * What a night is worth, by what kind of night it is.
 *
 * Five categories, and a night gets exactly one — the most specific that
 * applies. That ordering is the whole design. The engine this replaces
 * applied its rules in sequence and let each overwrite the last, so a
 * Friday within five days came out at the last-minute discount and the
 * weekend uplift silently vanished. Nobody could have told you which
 * rule won without reading the source.
 *
 * Christmas Day 2026 is a Friday, inside the Summer Break school window,
 * and a public holiday. It is a long weekend, because that is the most
 * specific thing true about it, and it stays a long weekend however the
 * categories are reordered in a form.
 *
 * Nothing here talks to Smoobu or the database. It answers "what kind of
 * night is this" and "what would that cost", so the answer can be shown
 * to somebody before anything is sent.
 */

const CATEGORIES = ['long_weekend', 'public_holiday', 'school_holiday', 'weekend', 'weekday'];

const LABEL = {
  long_weekend: 'Long weekend',
  public_holiday: 'Public holiday',
  school_holiday: 'School holidays',
  weekend: 'Weekend',
  weekday: 'Weekday',
};

const DAY = 86400000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const parse = (s) => new Date(`${s}T00:00:00Z`);
const shift = (s, n) => ymd(parse(s).getTime() + n * DAY);
/** 0 Sunday … 6 Saturday, read in UTC so a positive offset cannot shift it. */
const dow = (s) => parse(s).getUTCDay();

/**
 * The nights a public holiday drags into a long weekend.
 *
 * A holiday on a Friday or a Monday makes three nights. On a Thursday or
 * a Tuesday it makes four, because the day between it and the weekend
 * gets bridged — people take the Friday off rather than come back for
 * one day. A midweek Wednesday drags nothing.
 */
function longWeekendNights(holidayDate) {
  const d = dow(holidayDate);
  if (d === 5) return [holidayDate, shift(holidayDate, 1), shift(holidayDate, 2)];      // Fri–Sun
  if (d === 1) return [shift(holidayDate, -2), shift(holidayDate, -1), holidayDate];    // Sat–Mon
  if (d === 4) return [holidayDate, shift(holidayDate, 1), shift(holidayDate, 2), shift(holidayDate, 3)]; // Thu–Sun
  if (d === 2) return [shift(holidayDate, -3), shift(holidayDate, -2), shift(holidayDate, -1), holidayDate]; // Sat–Tue
  return [];
}

/**
 * Which category a single night falls into.
 *
 * `holidays` is [{date|start, end, kind}] — public holidays carry one
 * date, school terms a range.
 */
function categorise(date, holidays = []) {
  const publicDays = holidays.filter((h) => h.kind === 'public');

  const longWeekend = new Set();
  for (const h of publicDays) {
    for (const n of longWeekendNights(h.start || h.date)) longWeekend.add(n);
  }
  if (longWeekend.has(date)) return 'long_weekend';

  if (publicDays.some((h) => (h.start || h.date) === date)) return 'public_holiday';

  const inTerm = holidays.some(
    (h) => h.kind === 'school' && (h.start || h.date) <= date && (h.end || h.start || h.date) >= date
  );
  if (inTerm) return 'school_holiday';

  const d = dow(date);
  if (d === 5 || d === 6) return 'weekend';
  return 'weekday';
}

/**
 * What the plan would do to a stretch of nights.
 *
 * Returns one row per night with its category, what it costs now and
 * what it would cost — including the ones that would not move, because
 * "nothing changes here" is worth seeing before pressing a button.
 *
 * Booked nights are excluded entirely: the guest paid what they paid.
 */
function planNights({ from, to, plan = {}, holidays = [], currentRates = {}, bookings = [] }) {
  const isSold = (date) =>
  bookings.some(
    (b) => b.status === 'confirmed' && String(b.check_in) <= date && date < String(b.check_out)
  );

  const rows = [];
  for (let d = parse(from); d <= parse(to); d = new Date(d.getTime() + DAY)) {
    const date = ymd(d);
    if (isSold(date)) continue;

    const category = categorise(date, holidays);
    const rule = plan[category];
    if (!rule || !(rule.price > 0)) continue;

    const now = currentRates[date] || null;
    rows.push({
      date,
      category,
      label: LABEL[category],
      current_price: now ? Math.round(now.price) : null,
      new_price: Math.round(rule.price),
      current_min_stay: now && now.min_stay ? now.min_stay : null,
      new_min_stay: rule.min_stay || null,
      changes:
      !now ||
      Math.round(now.price) !== Math.round(rule.price) ||
      (rule.min_stay ? (now.min_stay || 1) !== rule.min_stay : false),
    });
  }
  return rows;
}

module.exports = { CATEGORIES, LABEL, categorise, longWeekendNights, planNights };
