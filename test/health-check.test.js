const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkProperty, horizonFrom, effectiveMarkups, rollUp, TARGET_DAYS, RED_DAYS,
} = require('../src/services/health-check');
const { addDays } = require('../src/services/dashboard-calc');

/**
 * The judgement, without a network.
 *
 * Every case here is one of the real incidents of the last year, written
 * as the data the check would have been handed on the morning it
 * started. If any of them goes green this module is back to being
 * decoration.
 *
 * `today` is passed explicitly throughout — these are calculations on
 * dates, not against the clock, so pinning them is what makes them
 * reproducible.
 */

const TODAY = '2026-11-06';

/** Rates for `n` days from `TODAY`, every night at `price`. */
function priced(n, price = 3000, from = TODAY) {
  const out = {};
  for (let i = 0; i <= n; i++) out[addDays(from, i)] = { price };
  return out;
}

const lodge = { id: 1, name: 'Hill Top Lodge', price_floor: 1500 };

// --- the horizon ---------------------------------------------------------

test('a year of prices is a full horizon', () => {
  const h = horizonFrom(priced(TARGET_DAYS), TODAY);
  assert.equal(h.days, TARGET_DAYS);
  assert.equal(h.priced_to, addDays(TODAY, TARGET_DAYS));
});

test('the loft on thirty days is red', () => {
  // The incident: one Booking.com room received 30 days while the Lodge
  // had a year, and nothing said so for weeks.
  const r = checkProperty({ property: { id: 2, name: 'The loft', price_floor: 1500 }, rates: priced(30), today: TODAY });
  assert.equal(r.status, 'red');
  const h = r.findings.find((f) => f.key === 'horizon');
  assert.equal(h.severity, 'red');
  assert.match(h.title, /only on sale for 30 more days/);
});

test('short of a year but past the alarm is amber, not red', () => {
  const r = checkProperty({ property: lodge, rates: priced(330), today: TODAY });
  assert.equal(r.status, 'amber');
  assert.equal(r.findings.find((f) => f.key === 'horizon').severity, 'amber');
});

test('the alarm line itself is covered on both sides', () => {
  const at = checkProperty({ property: lodge, rates: priced(RED_DAYS), today: TODAY });
  const under = checkProperty({ property: lodge, rates: priced(RED_DAYS - 1), today: TODAY });
  assert.equal(at.findings.find((f) => f.key === 'horizon').severity, 'amber');
  assert.equal(under.findings.find((f) => f.key === 'horizon').severity, 'red');
});

test('a hole in the middle ends the horizon there', () => {
  // A listing priced to next December with March missing is not priced
  // to next December: March is where a guest searching finds nothing.
  const rates = priced(TARGET_DAYS);
  delete rates[addDays(TODAY, 120)];
  assert.equal(horizonFrom(rates, TODAY).days, 119);
});

test('a booked night does not end the horizon', () => {
  // Unavailable is correct for a booked night. Treating it as the end
  // would turn a full calendar into an alert.
  const rates = priced(TARGET_DAYS);
  rates[addDays(TODAY, 10)] = { price: 3000, available: false };
  assert.equal(horizonFrom(rates, TODAY).days, TARGET_DAYS);
});

test('no price for tonight says so rather than reporting zero days quietly', () => {
  const r = checkProperty({ property: lodge, rates: {}, today: TODAY });
  assert.equal(r.status, 'red');
  assert.match(r.findings[0].title, /no price for tonight/);
});

// --- the floor -----------------------------------------------------------

test('a night under the floor is red', () => {
  const rates = priced(TARGET_DAYS);
  rates[addDays(TODAY, 40)] = { price: 110 };
  const r = checkProperty({ property: lodge, rates, today: TODAY });
  const f = r.findings.find((x) => x.key === 'below_floor');
  assert.equal(f.severity, 'red');
  assert.equal(f.count, 1);
  assert.deepEqual(f.examples, [addDays(TODAY, 40)]);
});

test('the loft at R90 selling on Booking.com for R113 is red', () => {
  // The exact incident. The base is absurd and the guest price is the
  // number that was actually charged, so both are reported — the
  // channel one names the channel and the markup it used.
  const rates = priced(TARGET_DAYS, 90);
  const property = { id: 2, name: 'The loft', price_floor: 1500, guest_markup_booking: 25 };
  const r = checkProperty({ property, rates, today: TODAY });

  assert.equal(r.status, 'red');
  assert.ok(r.findings.find((f) => f.key === 'below_floor'), 'the base is flagged');
  const ch = r.findings.find((f) => f.key === 'below_floor_booking');
  assert.match(ch.title, /sell on Booking\.com under R1\s500/);
  assert.match(ch.detail, /25% on top \(from the property setting\)/);
});

test('a floor nobody has set is reported, not passed', () => {
  // An unset floor is exactly the kind of setting this check exists to
  // find. Amber, and it goes away the moment somebody enters one.
  const r = checkProperty({ property: { id: 3, name: 'New flat' }, rates: priced(TARGET_DAYS, 50), today: TODAY });
  assert.equal(r.status, 'amber');
  assert.ok(r.findings.find((f) => f.key === 'no_floor'));
  assert.equal(r.findings.find((f) => f.key === 'below_floor'), undefined,
    'nothing is measured against a floor that does not exist');
});

test('a night over the ceiling is amber, not red', () => {
  // February carried a R4,300–5,600 dynamic-pricing residue. Worth
  // looking at; a lost booking is recoverable and a night sold at a
  // loss is not.
  const rates = priced(TARGET_DAYS);
  rates[addDays(TODAY, 90)] = { price: 5600 };
  const r = checkProperty({ property: { ...lodge, price_ceiling: 5000 }, rates, today: TODAY });
  assert.equal(r.status, 'amber');
  assert.equal(r.findings.find((f) => f.key === 'above_ceiling').severity, 'amber');
});

test('the count is whole even though the examples are trimmed', () => {
  // Three hundred bad nights is the fact. Listing all of them is not.
  const r = checkProperty({ property: lodge, rates: priced(TARGET_DAYS, 110), today: TODAY });
  const f = r.findings.find((x) => x.key === 'below_floor');
  assert.equal(f.count, TARGET_DAYS + 1);
  assert.equal(f.examples.length, 5);
});

// --- which markup gets used ----------------------------------------------

test('an entered markup beats an observed one', () => {
  const m = effectiveMarkups(
    { guest_markup_booking: 25 },
    { booking: { confident: true, markup: 31 } }
  );
  assert.deepEqual(m.booking, { label: 'Booking.com', percent: 25, source: 'setting' });
});

test('an observed markup is used when nothing was entered', () => {
  const m = effectiveMarkups({}, { airbnb: { confident: true, markup: 20.5 } });
  assert.equal(m.airbnb.percent, 20.5);
  assert.equal(m.airbnb.source, 'observed');
});

test('an unconfident observation is not used at all', () => {
  // observedMarkup's own header: an unconfident median is the middle of
  // some noise. Guessing from it would report a guest price nobody is
  // charged.
  const m = effectiveMarkups({}, { airbnb: { confident: false, markup: 20.5 } });
  assert.equal(m.airbnb, null);
});

test('with no markup to use, the channel is simply not checked', () => {
  const rates = priced(TARGET_DAYS, 1400);
  const r = checkProperty({ property: lodge, rates, today: TODAY });
  assert.ok(r.findings.find((f) => f.key === 'below_floor'), 'the base is still checked');
  assert.equal(r.findings.filter((f) => f.key.startsWith('below_floor_')).length, 0);
});

// --- failure is not health ----------------------------------------------

test('a fetch that failed is red, and no price is judged without prices', () => {
  // Rates failed silently for months behind a sync reporting success. A
  // health check that returns green on no data is the same bug.
  //
  // The channel settings are checked anyway — they need no rates — so
  // what this pins is that nothing requiring a price was judged, and
  // that the failure itself is red.
  const r = checkProperty({ property: lodge, rates: null, today: TODAY, error: '401 Unauthorized' });
  assert.equal(r.status, 'red');
  const fetch = r.findings.find((f) => f.key === 'fetch_failed');
  assert.equal(fetch.severity, 'red');
  assert.match(fetch.detail, /No prices could be checked/);
  for (const key of ['horizon', 'below_floor', 'above_ceiling']) {
    assert.equal(r.findings.find((f) => f.key === key), undefined, `${key} was not judged`);
  }
});

// --- the roll-up ---------------------------------------------------------

test('one red listing makes the card red', () => {
  assert.equal(rollUp([{ status: 'green' }, { status: 'amber' }, { status: 'red' }]), 'red');
  assert.equal(rollUp([{ status: 'green' }, { status: 'amber' }]), 'amber');
  assert.equal(rollUp([{ status: 'green' }]), 'green');
});

test('nothing to check is green rather than undefined', () => {
  assert.equal(rollUp([]), 'green');
});

test('a healthy listing has nothing to say', () => {
  // Settings that are actually healthy, which takes all three: a
  // markup, the commission it has to clear, and the VAT charged on that
  // commission. Any one missing is its own finding, and a 25% markup
  // over a 15% commission plus VAT clears break-even by half a point —
  // true, and not what "healthy" should mean.
  const property = {
    ...lodge, price_ceiling: 6000,
    guest_markup_booking: 25, commission_booking: 10, bank_charge_booking: 0, vat_rate: 15,
  };
  const r = checkProperty({ property, rates: priced(TARGET_DAYS, 3000), today: TODAY });
  assert.equal(r.status, 'green');
  assert.deepEqual(r.findings, []);
});

/* ---------------------------------------------------------------------- *
 * Does the markup cover what the channel takes
 *
 * The only check here that needs no rates, and the only one that is
 * arithmetic rather than inference: given a commission, the markup that
 * returns your base is not a matter of opinion.
 * ---------------------------------------------------------------------- */

const { markupFindings, configuredTake } = require('../src/services/health-check');

/** The Lodge's real settings. */
const settings = {
  id: 1, name: 'Hill Top Lodge',
  guest_markup_airbnb: 20.5, guest_markup_booking: 25, guest_markup_vrbo: 0,
  commission_airbnb: 12, commission_booking: 15, commission_vrbo: 8,
  bank_charge_booking: 2.1,
};

test('commission and bank charge together are what must be covered', () => {
  // 15% commission plus a 2.1% bank charge is 17.08%, not 15%. Checking
  // the markup against the commission alone would pass a listing that
  // pays out under its base once the bank takes its cut.
  assert.equal(configuredTake(settings, 'booking'), 17.1);
});

test('a markup well clear of the take says nothing', () => {
  // VAT recorded, so there is nothing missing to report: a 10%
  // commission plus 15% VAT is an 11.5% take, break-even 13%, and 25%
  // clears it by twelve points.
  const complete = { ...settings, commission_booking: 10, bank_charge_booking: 0, vat_rate: 15 };
  assert.equal(configuredTake(complete, 'booking'), 11.5);
  assert.deepEqual(markupFindings(complete).filter((f) => f.key.includes('booking')), []);
});

test('a markup below break-even is red, with what it actually returns', () => {
  // The intuitive mistake: markup set equal to the commission. 17% on
  // top of a 17.1% take pays out 97% of base — every single night.
  const found = markupFindings({ ...settings, guest_markup_booking: 17 })
    .find((f) => f.key === 'markup_short_booking');
  assert.equal(found.severity, 'red');
  assert.match(found.title, /Booking\.com pays out under your base/);
  assert.match(found.detail, /needs a markup of 20\.6%/);
  assert.match(found.detail, /comes back at 97% of base/);
});

test('a markup only just clearing it is amber', () => {
  // Break-even is 20.6%. At 21% a commission moving one point puts it
  // under water, and channel commissions move.
  const found = markupFindings({ ...settings, guest_markup_booking: 21 })
    .find((f) => f.key === 'markup_tight_booking');
  assert.equal(found.severity, 'amber');
  assert.match(found.detail, /break-even of 20\.6%/);
});

test('a measured commission replaces the rate, not the whole take', () => {
  // Smoobu's commission-included is the commission alone. The invoice
  // then adds a payments fee and charges VAT on the two together, so
  // reading the measurement as the take understates it by about a
  // quarter. 25% measured plus the 2.1% fee is a 27.1% take, which
  // needs 37.2% — not the 33.3% the bare figure would ask for.
  const found = markupFindings(settings, { booking: { commission: 25, bookings: 4 } })
    .find((f) => f.key === 'markup_short_booking');
  assert.equal(found.severity, 'red');
  assert.match(found.detail, /keeps 27\.1%/);
  assert.match(found.detail, /commission measured from 4 bookings, fee and VAT from settings/);
  assert.match(found.detail, /needs a markup of 37\.2%/);
});

test('a channel with no commission recorded is reported, not passed', () => {
  // The Lodge really does have commission_airbnb = 0 in production,
  // while the loft records 18. One of the two is wrong and neither says.
  const found = markupFindings({ ...settings, commission_airbnb: 0 })
    .find((f) => f.key === 'no_commission_airbnb');
  assert.equal(found.severity, 'amber');
  assert.match(found.detail, /whether the 20\.5% markup covers/);
});

test('a channel the property does not sell on is not mentioned', () => {
  // VRBO has no markup and no listing on either property. A permanent
  // amber about a channel nobody uses is how a card gets ignored.
  const keys = markupFindings(settings).map((f) => f.key);
  assert.equal(keys.filter((k) => k.includes('vrbo')).length, 0);
});

test('a channel with a listing but no markup is mentioned', () => {
  const found = markupFindings({ ...settings, vrbo_url: 'https://vrbo.example/123' })
    .find((f) => f.key === 'no_markup_vrbo');
  assert.equal(found.severity, 'amber');
  assert.match(found.detail, /at least 8\.7%/);
});

test('the settings are still checked on a morning Smoobu could not be read', () => {
  // It needs no rates, and it is the check most likely to be the reason
  // money is going missing. A failed fetch must not hide it.
  const r = checkProperty({
    property: { ...settings, guest_markup_booking: 17, price_floor: 1500 },
    rates: null, today: TODAY, error: '401 Unauthorized',
  });
  assert.equal(r.status, 'red');
  assert.ok(r.findings.find((f) => f.key === 'fetch_failed'));
  assert.ok(r.findings.find((f) => f.key === 'markup_short_booking'),
    'the channel settings were checked anyway');
});

/* ---------------------------------------------------------------------- *
 * VAT on the fee, which the channels do not advertise
 *
 * A 15% commission is quoted as 15% and charged as 15% plus VAT on it.
 * Every rule below is resolved the way calcDeductions resolves it, on
 * purpose: a second opinion here would report a take that the revenue
 * figures disagree with.
 * ---------------------------------------------------------------------- */

const { effectiveVat } = require('../src/services/health-check');

test('VAT is charged on the fees, not on the revenue', () => {
  // 15% commission + 2.1% bank = 17.1% of the price sold. VAT at 15% on
  // that is 19.7%. VAT on the revenue would read 32.1%, which is the
  // mistake this pins against.
  const fees = { commission_booking: 15, bank_charge_booking: 2.1 };
  assert.equal(configuredTake(fees, 'booking'), 17.1);
  assert.equal(configuredTake({ ...fees, vat_booking: 15 }, 'booking'), 19.7);
});

test('a per-channel VAT rate wins over the property rate', () => {
  const p = { vat_booking: 9, vat_rate: 15 };
  assert.deepEqual(effectiveVat(p, 'booking'), { rate: 9, source: 'channel' });
  // And it is the rate actually applied, not just the one reported.
  assert.equal(configuredTake({ commission_booking: 15, bank_charge_booking: 2.1, ...p }, 'booking'), 18.6);
});

test('the property rate is the fallback when a channel has none', () => {
  // The Lodge's real shape: vat_booking unset, vat_rate 15. This is why
  // its Booking.com take is 19.7% and not 17.1%.
  const p = { vat_rate: 15 };
  assert.deepEqual(effectiveVat(p, 'booking'), { rate: 15, source: 'property' });
  assert.equal(effectiveVat({ vat_booking: 0, vat_rate: 15 }, 'booking').rate, 15);
});

test('no VAT anywhere resolves to none rather than to a guess', () => {
  // The loft's real shape, and the reason its take is understated on
  // every channel.
  assert.deepEqual(effectiveVat({ vat_rate: 0, vat_booking: 0 }, 'booking'), { rate: 0, source: 'none' });
  assert.deepEqual(effectiveVat({}, 'booking'), { rate: 0, source: 'none' });
});

test('a channel VAT of zero cannot say "no VAT here"', () => {
  // Documented rather than fixed: the column has no way to express a
  // deliberate zero, so the property rate overrides it. A property with
  // one genuinely VAT-free channel has to clear the property rate.
  assert.equal(effectiveVat({ vat_booking: 0, vat_rate: 15 }, 'booking').source, 'property');
});

test('VAT with no commission to tax changes nothing', () => {
  // The Lodge's Airbnb: commission unset, so neither the commission nor
  // its VAT is counted and the take reads 0%. VAT cannot rescue a
  // missing commission, which is why that is its own finding.
  assert.equal(configuredTake({ commission_airbnb: 0, vat_airbnb: 15 }, 'airbnb'), 0);
  assert.equal(configuredTake({ commission_airbnb: 0, bank_charge_airbnb: 2.1, vat_airbnb: 15 }, 'airbnb'), 2.4);
});

test('a channel with no VAT on its fees is flagged', () => {
  const found = markupFindings({
    ...settings, vat_rate: 0, vat_booking: 0, guest_markup_booking: 25,
  }).find((f) => f.key === 'no_vat_booking');
  assert.equal(found.severity, 'amber');
  assert.match(found.detail, /charged at 17\.1% here/);
  assert.match(found.detail, /real take is higher/);
});

test('with VAT recorded, nothing is flagged', () => {
  // The Lodge. Its property rate covers both channels, so there is no
  // VAT finding to make.
  const keys = markupFindings({ ...settings, vat_rate: 15 }).map((f) => f.key);
  assert.equal(keys.filter((k) => k.startsWith('no_vat_')).length, 0);
});

test('a rate the property records elsewhere is offered as the comparison', () => {
  // Booking.com has no VAT but Airbnb records 15, so the finding can
  // say what the take would become instead of only that it is wrong.
  const found = markupFindings({
    ...settings, vat_rate: 0, vat_booking: 0, vat_airbnb: 15,
  }).find((f) => f.key === 'no_vat_booking');
  assert.match(found.detail, /At 15% it would be 19\.7%, needing a markup of 24\.5%/);
});

test('no rate anywhere means no invented number', () => {
  // The loft. Nothing is recorded, so the absence is reported without
  // asserting what South African VAT happens to be.
  const found = markupFindings({
    ...settings, vat_rate: 0, vat_booking: 0, vat_airbnb: 0, vat_vrbo: 0,
  }).find((f) => f.key === 'no_vat_booking');
  assert.ok(!/would be/.test(found.detail), found.detail);
});

test('a measured commission is still asked about VAT', () => {
  // Smoobu's figure is the commission on its own — the channel's
  // invoice carries VAT as a separate line, on the commission and the
  // payments fee together — so a measurement never has VAT inside it to
  // find, and a missing rate still understates the take.
  const keys = markupFindings(
    { ...settings, vat_rate: 0, vat_booking: 0 },
    { booking: { commission: 15, bookings: 5 } }
  ).map((f) => f.key);
  assert.equal(keys.includes('no_vat_booking'), true);
});

/* ---------------------------------------------------------------------- *
 * Against the real invoices
 *
 * Two Booking.com invoices, reproduced from room sales. Everything
 * above is arithmetic about a model; this is the model against what the
 * channel actually billed. If these drift, the model is wrong and not
 * the invoice.
 * ---------------------------------------------------------------------- */

/** Booking.com's own figures, to the cent. */
const INVOICES = [
  {
    who: 'The loft, September 2026', sales: 9904.50,
    commission: 1485.68, fee: 207.99, vat: 254.05, total: 1947.72,
    commission_pct: 15, fee_pct: 2.1,
  },
  {
    who: 'Hill Top Lodge, October 2026', sales: 5198.88,
    commission: 779.83, fee: 138.81, vat: 137.79, total: 1056.43,
    commission_pct: 15, fee_pct: 2.67,
  },
];

for (const inv of INVOICES) {
  test(`the fee model reproduces the invoice for ${inv.who}`, () => {
    const property = {
      commission_booking: inv.commission_pct,
      bank_charge_booking: inv.fee_pct,
      vat_rate: 15,
    };
    const take = configuredTake(property, 'booking');
    const billed = inv.total / inv.sales * 100;
    // Within a tenth of a point: configuredTake reports to one decimal
    // and the invoice's own lines are rounded to the cent.
    assert.ok(Math.abs(take - billed) < 0.1,
      `model says ${take}% of sales, the invoice billed ${billed.toFixed(2)}%`);
  });
}

test('VAT is charged on the commission and the payments fee together', () => {
  // Straight off the invoice: "15% VAT on 918.64 ZAR", and 918.64 is
  // 779.83 + 138.81. Not on room sales, which is the reading that would
  // have made the take look like 32%.
  const inv = INVOICES[1];
  assert.equal(Math.round((inv.commission + inv.fee) * 100) / 100, 918.64);
  assert.ok(Math.abs((inv.commission + inv.fee) * 0.15 - inv.vat) < 0.01);
  assert.ok(Math.abs(inv.commission + inv.fee + inv.vat - inv.total) < 0.01);
});

test('a 25% markup is under water at the Lodge\'s billed rate', () => {
  // The invoice took 20.32% of room sales, which needs 25.5%. This is
  // the case the check exists for, and it is not hypothetical.
  const inv = INVOICES[1];
  const property = {
    name: 'Hill Top Lodge', guest_markup_booking: 25,
    commission_booking: inv.commission_pct, bank_charge_booking: inv.fee_pct, vat_rate: 15,
  };
  const found = markupFindings(property).find((f) => f.key === 'markup_short_booking');
  assert.equal(found.severity, 'red');
  assert.match(found.detail, /comes back at 99\.6% of base/);
});
