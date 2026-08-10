import { fmtMoney } from './format';
export interface Property {
  id: number;
  name: string;
  base: number;
  checkInTime: string; // e.g. '15:00'
}

export type ChannelType = 'airbnb' | 'bcom' | 'direct' | 'blocked';

export interface Booking {
  id: string;
  /**
   * Smoobu's id for the stay, which is what everything downstream keys on.
   *
   * cleaning_jobs.booking_id and inventory_checklists.booking_id both hold
   * this, not the local row id — the sync deletes and re-inserts bookings,
   * so a local id is not stable enough to hang anything off.
   */
  smoobuId: number;
  propId: number;
  type: ChannelType;
  name: string;
  checkIn: Date;
  checkOut: Date;
  /** Gross — what the guest was charged, before platform commission. */
  total: number;
  /** Commission + bank charges + VAT, computed server-side. */
  deductions: number;
  /** What actually lands in the account. */
  netPayout: number;
  /** Adults, as Smoobu counts them — children are the separate field below. */
  numGuests: number | null;
  children: number;
}

/**
 * A holiday window, public or school, as /api/dashboard/stats returns it.
 * Single-day public holidays carry start === end.
 */
export interface HolidayWindow {
  start: string; // YYYY-MM-DD
  end: string;
  name: string;
  /** Region or country it belongs to — "Hamburg", "South Africa". */
  label: string;
  kind: 'public' | 'school';
  isLocal: boolean;
}

/** One synced day from Smoobu. `available: false` is Smoobu's own block flag. */
export interface DailyRate {
  price: number;
  minStay: number;
  available: boolean;
}

export const D = (year: number, month: number, day: number) =>
new Date(year, month - 1, day);

const now = new Date();
export const TODAY = D(now.getFullYear(), now.getMonth() + 1, now.getDate());
export const CLEANER_TOGGLE = true;

// Live data — populated by loadCalendarData(), read by all components
export let properties: Property[] = [];
export let bookings: Booking[] = [];
export let cleaners: Record<number, number[]> = {};

/** One entry per date: who is free, what is scheduled, what is short. */
export interface CleaningDay {
  available: {id: number;name: string;reason: string;property_ids: number[];}[];
  /** Not free that day — still askable, since a job is a request. */
  unavailable: {id: number;name: string;reason: string;property_ids: number[];}[];
  jobs: {
    id: number;property_id: number;property_name: string;
    cleaner_id: number | null;cleaner_name: string | null;
    status: string;cleaner_available: boolean;
    done: boolean;started: boolean;
    start_time: string;end_time: string;
    reason: string | null;note: string | null;
  }[];
  checkouts: {booking_id: number;property_id: number;property_name: string;}[];
  checkins: {booking_id: number;property_id: number;property_name: string;}[];
  unmet: {property_id: number;property_name: string;booking_id: number;}[];
}

/**
 * The cleaning picture, keyed by date.
 *
 * Replaces the `cleaners` map above for anything that needs to be right.
 * That one holds day-of-month numbers, so a job on the 19th of August
 * marked the 19th of every month — and it knew nothing about
 * availability at all, which is why a cleaner setting their days changed
 * nothing the manager could see.
 */
export let cleaningDays: Record<string, CleaningDay> = {};
// propId → 'YYYY-MM-DD' → rate. Only days Smoobu has actually published
// appear; a missing day means "no rate synced", which the calendar draws as
// blank rather than guessing.
export let dailyRates: Record<number, Record<string, DailyRate>> = {};
// Public holidays run 90 days ahead and school breaks 150 — see
// holidaysDuring() for what that horizon means.
export let holidays: HolidayWindow[] = [];

/** Local-time YYYY-MM-DD. `toISOString()` would shift SAST dates back a day. */
export function dateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

// Map API platform string → ChannelType
function mapPlatform(platform: string): ChannelType {
  const p = (platform || '').toLowerCase();
  // Check 'direct'/'block' first: Smoobu names direct bookings "Direct booking",
  // which contains the substring "booking" and would otherwise match as bcom.
  if (p.includes('direct')) return 'direct';
  if (p.includes('blocked') || p.includes('block') || p.includes('maintenance')) return 'blocked';
  if (p.includes('airbnb')) return 'airbnb';
  if (p.includes('booking') || p.includes('bcom')) return 'bcom';
  return 'direct';
}

// Fetch from real API — call once after auth, before rendering calendar
export async function loadCalendarData(): Promise<void> {
  // Rates from a month back so paging one month into the past still shows
  // them, forward to the booking sync's own 180-day horizon.
  const ratesFrom = dateKey(new Date(now.getTime() - 31 * 86400000));
  const ratesTo = dateKey(new Date(now.getTime() + 180 * 86400000));

  const [propsRes, bookingsRes, statsRes, ratesRes] = await Promise.all([
    fetch('/api/properties', { credentials: 'same-origin' }),
    fetch('/api/bookings', { credentials: 'same-origin' }),
    fetch('/api/dashboard/stats', { credentials: 'same-origin' }),
    fetch(`/api/calendar/rates?from=${ratesFrom}&to=${ratesTo}`, {
      credentials: 'same-origin',
    }),
  ]);

  if (propsRes.ok) {
    const propsData: any[] = await propsRes.json();
    properties = propsData.map((p) => ({
      id: p.id,
      name: p.name,
      base: p.base_price || 0,
      checkInTime: p.check_in_time || '15:00',
    }));
  }

  if (bookingsRes.ok) {
    const bData = await bookingsRes.json();
    const bArray: any[] = (bData.bookings || bData).filter((b: any) => b.status !== 'cancelled');
    bookings = bArray.map((b) => {
      const type = mapPlatform(b.platform);
      return {
      id: String(b.id),
      smoobuId: Number(b.smoobu_id ?? b.id),
      propId: b.property_id,
      type,
      // A block has no guest, so the old `|| 'Guest'` fallback labelled
      // every maintenance and renovation hold as one — a blocked week
      // read as an occupied week with an anonymous visitor in it.
      name: b.guest_name || (type === 'blocked' ? 'Blocked' : 'Guest'),
      checkIn: new Date(b.check_in + 'T00:00:00'),
      checkOut: new Date(b.check_out + 'T00:00:00'),
      // converted_* are in the display currency; net_payout and deductions
      // are computed server-side by calcDeductions — the same function the
      // dashboard KPIs and the analytics page use. Nothing is recomputed here.
      total: b.converted_total_price ?? b.total_price ?? 0,
      deductions: b.deductions ?? 0,
      netPayout: b.net_payout ?? b.converted_total_price ?? b.total_price ?? 0,
      numGuests: b.num_guests ?? null,
      children: b.children || 0,
      };
    });
  }

  if (ratesRes.ok) {
    const { rates = [] } = await ratesRes.json();
    const map: Record<number, Record<string, DailyRate>> = {};
    rates.forEach((r: any) => {
      if (!map[r.property_id]) map[r.property_id] = {};
      map[r.property_id][r.date] = {
        price: Number(r.price) || 0,
        minStay: Number(r.min_stay) || 1,
        available: r.available !== 0,
      };
    });
    dailyRates = map;
  }

  // Build cleaners map from pending cleaning jobs
  if (statsRes.ok) {
    const stats = await statsRes.json();
    const jobs: any[] = stats.pending_cleaning_jobs || [];
    const map: Record<number, number[]> = {};
    jobs.forEach((j) => {
      const propId = j.property_id;
      const day = new Date(j.cleaning_date + 'T00:00:00').getDate();
      if (!map[propId]) map[propId] = [];
      if (!map[propId].includes(day)) map[propId].push(day);
    });
    cleaners = map;

    holidays = (stats.holidays || []).map((h: any) => ({
      start: h.start,
      end: h.end || h.start,
      name: h.name,
      label: h.label,
      kind: h.kind === 'school' ? 'school' : 'public',
      isLocal: !!h.is_local,
    }));
  }
}

/**
 * Holiday windows overlapping the nights of a stay.
 *
 * A holiday starting on the check-out day is excluded: the nights sold
 * are [checkIn, checkOut), so nobody is in the house for it. One ending
 * on the check-in day is kept — that night is the guest's first.
 *
 * Horizon: the server sends public holidays 90 days out and school
 * breaks 150, both counted from today. A stay in the past or beyond
 * those windows simply matches nothing, which is why the row is hidden
 * rather than showing "none" — absence here means "not known", not
 * "no holiday".
 */
/**
 * A public holiday falling on this date, if any.
 *
 * Deliberately not school holidays. Those are six-week windows — the
 * German school terms that drive demand here run 42 and 43 days — so a
 * mark per day inside one lands on every day on screen and stops being
 * a mark at all. The first version of this drew a band across every row
 * of August and read as a set of dividers; the giveaway was being asked
 * what the new lines were.
 *
 * A school term is a property of a season, not of a Tuesday, and it has
 * no business on a day cell. A public holiday genuinely is a fact about
 * one date, so that is what this returns.
 */
export function holidayOn(date: Date): HolidayWindow | null {
  const key = dateKey(date);
  return holidays.find(
    (h) => h.kind === 'public' && h.start <= key && h.end >= key
  ) || null;
}

/**
 * School terms covering a date, if any.
 *
 * Kept apart from holidayOn() on purpose. These run six weeks — the
 * German terms that fill these properties span 42 and 43 days — so they
 * are a season, and drawing one per day turns every cell into a line.
 * They are drawn as a band across the days they actually cover, named
 * once, and only when asked for.
 */
export function schoolHolidaysOn(date: Date): HolidayWindow[] {
  const key = dateKey(date);
  return holidays.filter(
    (h) => h.kind === 'school' && h.start <= key && h.end >= key
  );
}

export function holidaysDuring(b: Booking): HolidayWindow[] {
  const from = dateKey(b.checkIn);
  const to = dateKey(b.checkOut);
  return holidays.filter((h) => h.start < to && h.end >= from);
}

/**
 * The same module state, filled from the cleaner portal's endpoints.
 *
 * So the portal can render the app's own MonthCalendar untouched rather
 * than a second calendar that drifts from it. One component, one data
 * shape, two ways of filling it.
 *
 * dailyRates is deliberately left empty: a cleaner session cannot load
 * rates — the endpoint refuses it — so the grid renders no money without
 * anybody having to ask it not to.
 */
/**
 * The clean that follows a stay.
 *
 * A booking and the job that turns the property over afterwards were two
 * unrelated things on screen: the bar said who stayed, and whether
 * anybody was coming to clean up after them lived on a different day
 * entirely, in a different colour, with nothing joining the two.
 *
 * Checkout day is where it nearly always is. Later days are searched too,
 * because a property that is empty for a week can be turned over on any
 * of them, and one booked for the following afternoon cannot — the first
 * job found from checkout onwards is the one that belongs to this stay.
 * The search stops at the next arrival for the same property, since a
 * clean after that belongs to the next guest, not this one.
 */
export function cleanForBooking(
b: {propId: number;checkOut: Date;},
withinDays = 7)
: CleaningDay['jobs'][number] & {date: string;} | null {
  for (let i = 0; i < withinDays; i++) {
    const d = new Date(b.checkOut);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const day = cleaningDays[key];
    if (!day) continue;

    // Somebody else's stay begins: anything from here is theirs.
    if (i > 0 && day.checkins.some((c) => c.property_id === b.propId)) return null;

    const job = day.jobs.find((j) => j.property_id === b.propId && j.cleaner_name);
    if (job) return { ...job, date: key };
  }
  return null;
}

/** Pull the cleaning picture for a date range into `cleaningDays`. */
export async function loadCleaningDays(from: string, to: string): Promise<void> {
  const res = await fetch(`/api/cleaners/calendar?from=${from}&to=${to}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) return;
  const data = await res.json();
  cleaningDays = data.days || {};
}

export async function loadCleanerCalendarData(): Promise<void> {
  const [meRes, jobsRes, staysRes] = await Promise.all([
    fetch('/api/cleaner-portal/me', { credentials: 'same-origin' }),
    fetch('/api/cleaner-portal/jobs', { credentials: 'same-origin' }),
    fetch('/api/cleaner-portal/bookings', { credentials: 'same-origin' }),
  ]);

  if (meRes.ok) {
    const me = await meRes.json();
    properties = (me.properties || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      base: 0,
      checkInTime: p.check_in_time || '15:00',
    }));
  }

  if (staysRes.ok) {
    const stays: any[] = await staysRes.json();
    bookings = stays.map((b) => ({
      id: String(b.id),
      smoobuId: Number(b.smoobu_id ?? b.id),
      propId: b.property_id,
      type: mapPlatform(b.platform),
      name: b.guest_name || 'Guest',
      checkIn: new Date(b.check_in + 'T00:00:00'),
      checkOut: new Date(b.check_out + 'T00:00:00'),
      // Zero, and BookingBar already omits the amount when it is falsy,
      // so the bar reads as the guest's name with no money in it.
      total: 0,
      deductions: 0,
      netPayout: 0,
      numGuests: b.num_guests ?? null,
      children: b.children || 0,
    }));
  }

  // Deliberately left empty.
  //
  // The shared `cleaners` map holds day-of-month numbers, not dates, so a
  // job on the 19th of one month puts a dot on the 19th of every month —
  // it marked days this cleaner has no work on at all. The portal answers
  // the same question with a tick derived from the full cleaning_date, so
  // the dot is both redundant and wrong. Two markers for one fact is how
  // a marker ends up meaning nothing.
  cleaners = {};

  dailyRates = {};
}

/**
 * The nightly rate Smoobu publishes for this day, or null if none is synced.
 *
 * This used to be invented: `base_price` for weekdays and `base_price * 1.3`
 * for weekends. `base_price` is Smoobu's minimum-price *floor*, not a rate —
 * on The loft it is R80, while the room actually sells around R3,000 — and
 * the 1.3 weekend multiplier corresponded to nothing at all. The calendar
 * was quoting R80 a night for a room at R3,012.
 *
 * Returning null where nothing is synced is deliberate. A blank cell reads
 * as "not set"; a wrong number reads as a price.
 */
export function getRate(propId: number, date: Date): DailyRate | null {
  return dailyRates[propId]?.[dateKey(date)] ?? null;
}

// Both are the shared formatter. They kept their own spelling before —
// "R6.0K" here against the dashboard's "R 6.0K" — for no reason beyond
// having been written twice.
export const formatRate = fmtMoney;
export const formatTotal = fmtMoney;

/**
 * Where a stay sits relative to today.
 *
 * The detail sheet labelled its channel row "Status" and answered
 * "Airbnb", which is not a status. Airbnb is who sold it; this is what
 * is happening.
 *
 * The first attempt got the states wrong as well as the words. It read
 * `checkIn <= TODAY` as "in house", so a guest arriving this afternoon
 * was reported as already staying — the dashboard showed Hill Top Lodge
 * as "Empty, next check-in 08 Aug" while this sheet called the very
 * same booking "In house". Arrival and departure days are their own
 * states, and they are the two the day actually turns on: one needs a
 * key handed over, the other needs a clean.
 *
 * The words are deliberately plain. "In house" is front-desk jargon for
 * a guest who has checked in and not yet left; everyone in hotels knows
 * it and nobody else does. "Confirmed" went for a different reason —
 * cancelled bookings never reach the calendar, since they are filtered
 * on load, so every stay drawn here is confirmed and the word carried
 * no information.
 */
export function stayStatus(b: Booking): string {
  if (b.type === 'blocked') return 'Blocked';
  if (b.checkOut < TODAY) return 'Checked out';
  if (b.checkIn > TODAY) return 'Upcoming';
  // Past here the stay straddles today. Arrival is tested before
  // departure so a same-day booking reads as arriving.
  if (dateEqual(b.checkIn, TODAY)) return 'Arriving today';
  if (dateEqual(b.checkOut, TODAY)) return 'Departing today';
  return 'Staying now';
}

export function dateEqual(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate());
}

export function isDateInBooking(date: Date, booking: Booking): boolean {
  return date >= booking.checkIn && date < booking.checkOut;
}

export function isDateCovered(date: Date, propId: number): boolean {
  return bookings.some((b) => b.propId === propId && isDateInBooking(date, b));
}
