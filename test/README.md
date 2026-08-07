# Test catalogue

All tests use Node's built-in `node:test` runner. No external test deps.

```bash
npm test                                       # run everything
node --test test/<file>.test.js                # run one file
```

Convention: one file per module-or-topic, named `<module>.<topic>.test.js`.
Runner glob: `test/**/*.test.js`.

Each test below lists its **input**, **expected output**, and **what it's
really guarding against**. Formulas match the code in
`src/services/analytics-calc.js`.

---

## `smoke.test.js`

Sanity check that `npm test` still works. Delete once the suite is
well-established.

| test | input | output | why |
|---|---|---|---|
| `harness works` | `1 + 1` | `2` | If this fails, `npm test` or `node --test` is misconfigured. |

---

## `analytics-calc.calcDeductions.test.js` — money math per booking

`calcDeductions(booking) → number` returns the total to subtract from a
booking's gross revenue: **commission + bank charges + VAT**.

Deduction formula (per-platform rates, all as percentages):
- `commission = converted_total_price × commRate / 100`
  (falls back to `converted_commission` reported by Smoobu when no property-configured rate exists)
- `bank = converted_total_price × bankRate / 100`
- `vat = (commission + bank) × vatRate / 100`  ← VAT is on comm+bank, **not** on gross
- Direct bookings: **0**, always
- `vatRate` falls back to legacy `property_vat_rate` when the per-platform VAT is 0

All 15 tests use a shared factory `b(overrides)` with default
`converted_total_price = 1000` and everything else zero.

| # | test | input (overrides) | expected | what it guards |
|---|---|---|---|---|
| 1 | direct booking has no deductions | `platform: 'Direct booking'` | `0` | Direct sales bypass all fees. |
| 2 | direct ignores configured rates | `platform: 'Direct booking'`, all airbnb rates set (15/2/15) | `0` | Even if the property row has stale rates, direct stays 0. |
| 3 | unknown platform → 0 | `platform: 'Something else'` | `0` | Non-matching platform strings do not accidentally borrow airbnb/booking/vrbo rates. |
| 4 | commission only | `platform: 'Airbnb'`, `comm=15%` | `150` | `1000 × 15% = 150`. Baseline commission math. |
| 5 | commission + bank + VAT stack | `platform: 'Airbnb'`, `comm=15, bank=2, vat=15` | `195.5` | `comm=150, bank=20, vat=(150+20)×15%=25.5 → 195.5`. Pins the "VAT on comm+bank, not gross" rule. |
| 6 | booking.com uses booking rates | `platform: 'Booking.com'`, `airbnb_comm=99, booking_comm=12` | `120` | `1000 × 12% = 120`. Airbnb rate must not leak into Booking.com totals. |
| 7 | vrbo uses vrbo rates | `platform: 'VRBO'`, `vrbo_comm=8` | `80` | Same isolation for VRBO. |
| 8 | legacy VAT fallback | `platform: 'Airbnb'`, `comm=15, vat_airbnb=0, property_vat_rate=15` | `172.5` | `comm=150, vat=150×15%=22.5`. Old single-VAT-rate schema still works. |
| 9 | per-platform VAT wins | `platform: 'Airbnb'`, `comm=15, vat_airbnb=10, property_vat_rate=15` | `165` | `comm=150, vat=150×10%=15`. Once per-platform VAT is set, legacy is ignored. |
| 10 | Smoobu commission fallback | `platform: 'Airbnb'`, `prop_comm=0, converted_commission=75` | `75` | Use Smoobu-reported commission when property has no configured rate. |
| 11 | property comm wins over Smoobu | `platform: 'Airbnb'`, `prop_comm=15, converted_commission=999` | `150` | Configured rate wins; Smoobu number ignored. |
| 12 | zero-revenue booking | `rev=0`, `platform: 'Airbnb'`, `comm=15, bank=2, vat=15` | `0` | Percentage of zero is zero; no phantom deductions. |
| 13 | missing `converted_total_price` | `platform: 'Airbnb'`, `comm=15`, revenue field deleted | `0` | `undefined` treated as 0, not NaN. |
| 14 | case-insensitive platform | `platform: 'AIRBNB'`, `comm=10` | `100` | Smoobu occasionally returns odd casing. |
| 15 | "Direct booking" substring guard | `platform: 'Direct booking'`, `booking_comm=20` | `0` | **Regression guard**: the string `"Direct booking"` contains `"booking"`. Order of checks (direct first) must be preserved. |

**Not covered:**
- Negative revenue (chargebacks/refunds) — behavior undefined.
- Cancelled bookings — filtered out upstream in the route.
- Flat-fee deductions — schema doesn't support them.

---

## `analytics-calc.platform.test.js` — platform classifier

Two pure string classifiers used by the revenue-by-platform grouping.

### `normalizePlatform(str) → canonical name`

Order of checks: `blocked → airbnb → direct → booking → vrbo/homeaway → Direct`.

| # | test | input | output | why |
|---|---|---|---|---|
| 1 | null → Direct | `null` | `'Direct'` | Missing platform means the owner marked it as a direct sale. |
| 2 | empty → Direct | `''` | `'Direct'` | Same default for empty strings. |
| 3 | Smoobu "Direct booking" | `'Direct booking'` | `'Direct'` | **Regression guard**: contains `'booking'` — order of checks must be `direct` before `booking`. |
| 4 | Airbnb variants | `'Airbnb'`, `'airbnb'`, `'AIRBNB'`, `'Airbnb 2'` | `'Airbnb'` | Case-insensitive; substring match for multi-account users. |
| 5 | Booking.com | `'Booking.com'`, `'booking'` | `'Booking.com'` | Two common spellings. |
| 6 | VRBO / HomeAway alias | `'VRBO'`, `'vrbo'`, `'HomeAway'` | `'VRBO'` | HomeAway was rebranded; still surfaces under VRBO. |
| 7 | blocked channel | `'Blocked channel'`, `'blocked'` | `'Blocked'` | Prefix match — anything starting with `blocked` is off-market. |
| 8 | unknown → Direct | `'Some random channel'` | `'Direct'` | Unknown platforms default to Direct rather than crashing charts. |

### `isBlockedPlatform(str) → bool`

Single test with a table of cases:

| input | output | why |
|---|---|---|
| `null` | `false` | Missing string is not blocked. |
| `''` | `false` | Empty is not blocked. |
| `'Blocked'` | `true` | Exact match. |
| `'blocked'` | `true` | Case-insensitive. |
| `'Blocked channel'` | `true` | Prefix match. |
| `'Airbnb'` | `false` | Normal channel. |
| `'Not blocked'` | `false` | **Regression guard**: contains `blocked` but does not start with it. |

**Not covered:** whitespace-only strings, non-string input (would throw on
`.toLowerCase()`; callers always pass a string or null).

---

## `analytics-calc.aggregateRevenueByMonth.test.js` — per-month revenue accuracy

`aggregateRevenueByMonth(bookings, todayStr) → rows[]`. This is the roll-up
that drives the revenue timeline chart on the analytics page.

Each output row has:
`{ month, total, paid, booked, deductions, bookings, nights, first_checkin, last_checkout }`.

Split rule: a booking's revenue counts as **paid** if `check_out <= todayStr`,
otherwise **booked**.

All 12 tests use a shared factory `bk(overrides)` — default Direct booking
in June 2025, 3 nights, R3000.

### Basic aggregation

| # | test | input | expected | what it guards |
|---|---|---|---|---|
| 1 | single booking → one row | 1 booking, `check_in: '2025-06-10'`, R3000, 3 nights, `today: '2025-06-30'` | `[{ month: '2025-06', total: 3000, bookings: 1, nights: 3 }]` | The most basic case: one booking, one row. |
| 2 | paid vs booked split | June booking R3000 (past) + Aug booking R4000 (future), `today: '2025-07-15'` | June: `paid=3000, booked=0`. Aug: `paid=0, booked=4000`. | The split that drives the "already earned vs future" indicator on the chart. |
| 3 | checkout ON todayStr counts as paid | 1 booking, `check_out: '2025-06-30'`, `today: '2025-06-30'` | `paid=1500, booked=0` | Inclusive boundary — a stay that ends today has already earned. |

### Invariants (the accuracy tests)

These check that the aggregated numbers reconcile against the raw inputs —
the "do the numbers on the chart actually add up" tier.

| # | test | input | invariant asserted | what it guards |
|---|---|---|---|---|
| 4 | totals = sum of per-booking values | 3 bookings across June + July (R3000 + R5000 + R7000) | `sum(row.total) = 15000`, `sum(row.nights) = 15`, `sum(row.bookings) = 3` | Whole-portfolio total on the chart matches the underlying data. |
| 5 | deductions = sum of calcDeductions | Airbnb R4000 @ 15%, Booking R2000 @ 10%, Direct R1500 | June `deductions = 800` (`= 600 + 200 + 0`), and also `= Σ calcDeductions(b)` | The deductions bar reconciles booking-by-booking. Any drift between the aggregator and `calcDeductions` breaks this. |
| 6 | total = paid + booked, and total ≥ deductions | Airbnb R4000 @ 15/2/15, Booking R5000 @ 12/0/15, `today: '2025-08-01'` | For every row: `total == paid + booked` and `total >= deductions` | Guards against negative net revenue on realistic input and the split-column arithmetic. |

### Gap-filling for the chart

The chart cannot have missing months, so the aggregator emits zero-value
rows between the first and last observed month.

| # | test | input | expected months | what it guards |
|---|---|---|---|---|
| 7 | fills gaps within a year | Jan + April bookings, `today: '2025-12-31'` | `['2025-01', '2025-02', '2025-03', '2025-04']` — Feb + Mar zeroed | No visual holes in the timeline. |
| 8 | fills across year boundary | Nov 2024 + Feb 2025 bookings | `['2024-11', '2024-12', '2025-01', '2025-02']` | Year-rollover arithmetic in the fill loop. |
| 9 | single-month input → no filler | 1 booking in June | `['2025-06']` (length 1) | Don't invent months that shouldn't exist. |
| 10 | empty input → empty array | `[]` | `[]` | Never returns filler months from nothing. |

### Field-level fallbacks

| # | test | input | expected | what it guards |
|---|---|---|---|---|
| 11 | `length_of_stay` missing → 1 | Booking with `length_of_stay` deleted | `row.nights = 1` | Missing stay length shouldn't drop out of occupancy math as `NaN` or 0. |
| 12 | `first_checkin`/`last_checkout` span the month | 3 June bookings: `06-20→06-25`, `06-05→06-08`, `06-15→06-30` | `first_checkin='2025-06-05'`, `last_checkout='2025-06-30'` | These fields drive the tooltip range on the chart — must reflect the actual earliest/latest dates. |

**Not covered (candidates for next round):**
- Bookings that straddle month boundaries (check_in and check_out in
  different months) — currently attributed entirely to the check-in month;
  no test pins this behavior.
- Multi-currency input — this function runs *after* `bulkConvert`, so all
  input is already in the display currency. Tests belong in an exchange-rate
  suite instead.
- Very long gap-fill ranges (multi-year).
- Timezone-sensitive `todayStr` — treated as an opaque `YYYY-MM-DD` string.

---

## `dashboard-calc.dateUtils.test.js` — date arithmetic primitives

Tests `addDays(dateStr, n)` and `daysBetween(fromStr, toStr)`. Every
"today" derivation, occupancy calc, and gap detection depends on these
two — an off-by-one here silently drifts every number on the dashboard.
Both use UTC-only arithmetic to sidestep timezone drift.

`addDays`: 0, ±1, month boundary, year boundary, leap-day forward,
non-leap February, +30-day occupancy window.

`daysBetween`: same-day → 0, consecutive → 1, typical 3-night stay,
crossing month/year, leap February, negative on reversed inputs.

**Regression guard:** the leap-February and month-boundary cases catch
any regression to a naive `new Date(str)` that would locally-timezone-shift
the input.

---

## `dashboard-calc.today.test.js` — "who is where right now?" classifiers

Tests the classifiers that produce the home dashboard:
`isCancelled`, `isBlocked`, `occupiesOn`, `arrivesOn`, `departsOn`,
`inHouseOn`, `arrivalsOn`, `departuresOn`, `upcomingArrivals`,
`upcomingDepartures`, `nextArrivalByProperty`, `activeBlockOn`.

Booking convention pinned: **`[check_in, check_out)`** is the half-open
occupancy window. Guest is in on `check_in` day, gone on `check_out` day.
The property is available for a new arrival on the check-out date.

**Predicates:**
- `isCancelled` / `isBlocked`: only status `'cancelled'` counts as cancelled;
  `isBlocked` is a case-insensitive substring match on `platform`.
- `occupiesOn`: check-in day = in, check-out day = out (half-open window).
- `arrivesOn` / `departsOn`: exact-date equality.

**`inHouseOn`:**
- Window semantics: mid-stay and check-in day are in-house, check-out day is
  not.
- Excludes cancelled and blocked bookings.

**`arrivalsOn` / `departuresOn`:**
- Return only bookings whose check-in/check-out equals today.
- Exclude cancelled and blocked.
- **Same-day turnover invariant:** guest A departing on 2025-06-10 and
  guest B arriving on 2025-06-10 both surface; `inHouseOn` reports guest B
  (the incoming stay's window covers the night).

**`upcomingArrivals` / `upcomingDepartures`:**
- Rolling `days`-day window starting at `todayStr` (inclusive of today).
- Results sorted ascending by check_in / check_out.
- Bookings just outside the window (day `+days`) are excluded.

**`nextArrivalByProperty`:**
- Returns a `Map(property_id → booking)` — first arrival **strictly after**
  today per property.
- Same-day arrivals go to `arrivalsOn`, not here.
- Properties with no future arrival are omitted (not present as `null`).
- Excludes cancelled and blocked.

**`activeBlockOn`:**
- Returns the block covering today, or `null`.
- On the block's own check-out day, no block is active (half-open window).

---

## `dashboard-calc.occupancyAndGaps.test.js` — occupancy % and gap detection

### `occupancyByProperty(bookings, propertyIds, todayStr, days)`

Booked nights per property in the window `[todayStr, todayStr + days)`. Rate
is `bookedNights / days × 100`, rounded.

- Fully-inside booking counts every night.
- Booking straddling the window **start** is clipped to `todayStr`.
- Booking straddling the window **end** is clipped to `todayStr + days`
  (exclusive).
- Bookings entirely before or after the window contribute 0.
- Multiple bookings on the same property accumulate.
- Independent counts across properties.
- Property with no bookings → 0%.
- Cancelled and blocked bookings do not count.
- Fully booked → 100%.

### `detectGaps(bookings, todayStr, { minNights, maxNights })`

For each property, walks the sorted booking list and reports gaps between
consecutive check-out → check-in of `minNights..maxNights` (default 1–3).

- 2-night gap → reported.
- Back-to-back (same-day turnover) = 0 nights → not reported.
- 4-night gap exceeds default max → not reported.
- Gaps ending **before** `todayStr` are excluded (no reminder needed).
- Gaps are per-property; no cross-property "gaps".
- Cancelled and blocked bookings are ignored when computing the sequence
  — so a blocked calendar entry in the middle doesn't hide a real gap.
- Custom `minNights` / `maxNights` respected.
