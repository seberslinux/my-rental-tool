/**
 * Algorithms that move a night's price, and why.
 *
 * The rate plan says what a night is worth by what kind of night it is —
 * a weekend, a public holiday, a school break. That is a statement about
 * the calendar, and the calendar does not know whether anybody has
 * actually booked. It prices Christmas the same eleven months out with an
 * empty diary as it does two days out with an empty diary.
 *
 * These are the rules that read the diary. Each one is a strategy: it
 * looks at a night, decides whether it has anything to say, and if so
 * returns a factor and a sentence explaining itself.
 *
 * ## They compose, they do not overwrite
 *
 * This is the whole point, and it is what the engine before last got
 * wrong. That one assigned `price = base * something` in sequence, so a
 * Friday inside the last-minute window came out at the discount and the
 * weekend uplift silently vanished — the rules did not combine, the last
 * one to run simply won, and nobody could say which that was without
 * reading the source.
 *
 * Here every strategy contributes a multiplier and they are multiplied
 * together. Two rules that both apply both apply. Because multiplication
 * commutes, the order they run in cannot change the answer, so there is
 * no precedence to learn and no rule that can quietly cancel another.
 *
 * The floor is the exception, and deliberately so: it is not an opinion
 * about demand, it is the line under all of them. It is applied last
 * because that is the only position from which it can do its job.
 *
 * ## Every night carries its reasons
 *
 * A price nobody can explain is a price nobody will trust enough to send.
 * Each row comes back with a `trail` — what the plan said, what each
 * strategy did to it, and what came out. The screen can then say
 * "R1,200 weekend, less 25% for a two-night gap, R900" rather than
 * presenting a number and asking for faith.
 *
 * ## Nothing here talks to Smoobu or the database
 *
 * Same rule as the rate plan next door. These are pure functions over
 * data somebody else fetched, so the answer can be shown, argued with and
 * changed before anything is sent anywhere.
 */

const DAY = 86400000;
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);

/**
 * The catalogue.
 *
 * Each strategy declares its own parameters, which is what lets the
 * screen build a form for it without knowing what it does. Adding a
 * strategy is adding an entry here — the endpoint, the storage and the
 * page all read this rather than carrying their own copy of the list.
 */
const STRATEGIES = {
  /**
   * A hole too small to sell.
   *
   * Two nights between one guest leaving and the next arriving earn
   * nothing at all if they stay empty, and they usually do — because the
   * minimum stay is three, so the gap is not merely overpriced, it is
   * unbookable. The old engine discounted these and left the minimum
   * alone, which is precisely why they went on sitting there.
   *
   * So this drops the minimum to the length of the gap as well. A
   * discount on a night nobody is allowed to book is not a strategy.
   */
  orphan_gap: {
    label: 'Orphan gaps',
    blurb: 'Small gaps between bookings earn nothing empty. Price them to move, and let people actually book them.',
    params: [
      { key: 'max_gap', label: 'Gaps up to', type: 'int', unit: 'nights', default: 2, min: 1, max: 7 },
      { key: 'discount', label: 'Reduce by', type: 'percent', default: 25, min: 0, max: 60 },
      { key: 'release_min_stay', label: 'Drop the minimum stay to fit the gap', type: 'bool', default: true },
    ],
    apply(night, ctx, p) {
      const gap = ctx.gaps.get(night.date);
      if (!gap || gap.length > p.max_gap) return null;
      return {
        factor: 1 - p.discount / 100,
        // Only ever downwards. Raising a minimum here would close a gap
        // this strategy exists to open.
        min_stay: p.release_min_stay ? Math.min(gap.length, night.min_stay || gap.length) : null,
        why: `${gap.length}-night gap between bookings, ${p.discount}% off`,
      };
    },
  },

  /**
   * Still empty, and getting closer.
   *
   * A night unsold at three days out is worth less than the same night
   * unsold at three months out, because there is almost no time left to
   * find anybody. The steps are a curve rather than a cliff: the old
   * engine took a flat 15% off everything inside five days, which is
   * both too blunt and too late.
   *
   * Booked nights never reach here, so this only ever discounts things
   * that are genuinely still for sale.
   */
  lead_time: {
    label: 'Last minute',
    blurb: 'Step the price down as an unsold night approaches, rather than holding out and earning nothing.',
    params: [
      { key: 'start_days', label: 'Start discounting at', type: 'int', unit: 'days out', default: 21, min: 1, max: 120 },
      { key: 'max_discount', label: 'Reaching at most', type: 'percent', default: 25, min: 0, max: 60 },
    ],
    apply(night, ctx, p) {
      const out = daysBetween(ctx.today, night.date);
      if (out < 0 || out > p.start_days) return null;
      // Straight-line from nothing at the far edge to the full discount
      // on the day itself. A curve would be guessing at a shape nobody
      // has measured; a line is honest about being a rule of thumb.
      const closeness = (p.start_days - out) / p.start_days;
      const pct = p.max_discount * closeness;
      if (pct < 0.5) return null;
      return {
        factor: 1 - pct / 100,
        why: `${out} day${out === 1 ? '' : 's'} out and unsold, ${Math.round(pct)}% off`,
      };
    },
  },

  /**
   * How the season as a whole is going.
   *
   * Every rule above looks at one night. This one looks at the window and
   * asks whether the diary is filling at the rate it should be. Ahead of
   * target, everything can afford to cost more; behind it, everything
   * should come down a little. It is the closest thing here to what a
   * person actually does when they look at a month and think "that is
   * too quiet".
   *
   * Occupancy comes from the caller, computed by the same function the
   * dashboard uses. A second opinion on what "booked" means is how two
   * screens come to disagree about the same month.
   */
  pace: {
    label: 'How the month is selling',
    blurb: 'Nudge the whole window up when it is filling faster than target, and down when it is lagging.',
    params: [
      { key: 'target', label: 'Expected booked by now', type: 'percent', default: 60, min: 0, max: 100 },
      { key: 'max_adjust', label: 'Move at most', type: 'percent', default: 15, min: 0, max: 40 },
    ],
    apply(night, ctx, p) {
      if (ctx.occupancy == null) return null;
      const booked = Math.round(ctx.occupancy * 100);
      const drift = booked - p.target;
      if (Math.abs(drift) < 5) return null;
      // Scaled so being the whole way wrong is the whole adjustment, and
      // clamped so a wildly empty month cannot give the place away on
      // its own — the floor is still below this.
      const span = drift > 0 ? 100 - p.target : p.target;
      const pct = Math.max(-p.max_adjust, Math.min(p.max_adjust, (drift / (span || 1)) * p.max_adjust));
      if (Math.abs(pct) < 0.5) return null;
      return {
        factor: 1 + pct / 100,
        why: `${booked}% booked against a ${p.target}% target, ${pct > 0 ? 'up' : 'down'} ${Math.abs(Math.round(pct))}%`,
      };
    },
  },
};

/**
 * The line under everything.
 *
 * Not in the catalogue above because it is not a strategy — it does not
 * read the diary and it has no opinion about demand. It is the answer to
 * "how cheap is too cheap", and it is applied after the others precisely
 * so that no combination of them can duck under it.
 *
 * Two rules that each take 25% off take 44% off together, which is the
 * correct behaviour for compounding discounts and the wrong price for a
 * flat in December. This is what stops that.
 */
const FLOOR = {
  key: 'floor',
  label: 'Never go below',
  blurb: 'A hard minimum. Discounts compound, and this is the line they cannot cross.',
  params: [{ key: 'min_price', label: 'Floor', type: 'money', default: 0, min: 0, max: 1000000 }],
};

/** The catalogue as the screen wants it: a list, floor last. */
function catalogue() {
  return [
    ...Object.entries(STRATEGIES).map(([key, s]) => ({
      key, label: s.label, blurb: s.blurb, params: s.params,
    })),
    { key: FLOOR.key, label: FLOOR.label, blurb: FLOOR.blurb, params: FLOOR.params },
  ];
}

/** Defaults for one strategy, so an unconfigured toggle still works. */
function defaultsFor(key) {
  const spec = key === FLOOR.key ? FLOOR : STRATEGIES[key];
  if (!spec) return {};
  const out = {};
  for (const p of spec.params) out[p.key] = p.default;
  return out;
}

/**
 * A strategy's parameters, coerced and bounded.
 *
 * Anything missing falls back to the default rather than to zero: a
 * parameter absent from a saved config is one the user never touched,
 * and treating that as "0% discount" would quietly switch the strategy
 * off while the screen showed it on.
 */
function readParams(key, given = {}) {
  const spec = key === FLOOR.key ? FLOOR : STRATEGIES[key];
  if (!spec) return {};
  const out = {};
  for (const p of spec.params) {
    const raw = given[p.key];
    if (p.type === 'bool') {
      out[p.key] = raw == null ? p.default : Boolean(raw);
      continue;
    }
    const n = Number(raw);
    out[p.key] = Number.isFinite(n) ? Math.max(p.min, Math.min(p.max, n)) : p.default;
    if (p.type === 'int') out[p.key] = Math.round(out[p.key]);
  }
  return out;
}

/**
 * Where the empty nights between bookings are, and how long each gap is.
 *
 * Keyed by night so a strategy can ask about the one in front of it
 * without walking the booking list again. Every night of a gap carries
 * the whole gap's length, because a two-night hole is a two-night
 * problem on both of its nights.
 */
function findGaps(bookings = []) {
  const sorted = bookings.
  filter((b) => b.status === 'confirmed').
  slice().
  sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)));

  const gaps = new Map();
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = String(sorted[i].check_out).slice(0, 10);
    const end = String(sorted[i + 1].check_in).slice(0, 10);
    const length = daysBetween(start, end);
    if (length < 1) continue;
    for (let d = parse(start); d < parse(end); d = new Date(d.getTime() + DAY)) {
      gaps.set(ymd(d), { length, from: start, to: end });
    }
  }
  return gaps;
}

/**
 * Run the enabled strategies over the plan's nights.
 *
 * `rows` are what the rate plan produced — a night, its category and what
 * the plan says it costs. This returns the same rows with the strategies
 * folded in, each carrying the trail of what moved it.
 *
 * `config` is `{ key: { enabled, params } }`. A strategy that is off, or
 * that has nothing to say about a night, contributes nothing at all —
 * not a factor of one, but no entry in the trail, so the screen does not
 * fill up with rules announcing that they did nothing.
 */
function applyStrategies({ rows = [], config = {}, today, bookings = [], occupancy = null }) {
  const gaps = findGaps(bookings);
  const ctx = { today: String(today).slice(0, 10), gaps, occupancy };

  const active = Object.keys(STRATEGIES).filter((k) => config[k] && config[k].enabled);
  const floorOn = config[FLOOR.key] && config[FLOOR.key].enabled;
  const floor = floorOn ? readParams(FLOOR.key, config[FLOOR.key].params).min_price : 0;

  return rows.map((row) => {
    const base = row.new_price;
    const trail = [{ label: row.label, price: base, why: 'the rate plan' }];
    let factor = 1;
    let minStay = row.new_min_stay;

    for (const key of active) {
      const p = readParams(key, config[key].params);
      const out = STRATEGIES[key].apply(
        { ...row, min_stay: minStay }, ctx, p
      );
      if (!out) continue;
      factor *= out.factor;
      if (out.min_stay != null) minStay = out.min_stay;
      trail.push({
        label: STRATEGIES[key].label,
        change: Math.round((out.factor - 1) * 100),
        why: out.why,
      });
    }

    let price = Math.round(base * factor);
    if (floor > 0 && price < floor) {
      trail.push({ label: FLOOR.label, why: `held at the ${Math.round(floor)} floor` });
      price = Math.round(floor);
    }

    return {
      ...row,
      new_price: price,
      new_min_stay: minStay,
      plan_price: base,
      trail,
      changes:
      row.current_price == null ||
      Math.round(row.current_price) !== price ||
      (minStay ? (row.current_min_stay || 1) !== minStay : false),
    };
  });
}

module.exports = {
  STRATEGIES, FLOOR, catalogue, defaultsFor, readParams, findGaps, applyStrategies,
};
