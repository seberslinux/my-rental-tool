/**
 * What each channel keeps of a booking, per property: the one table every
 * fee in the app comes from.
 *
 *   commission | VAT on commission | bank charges | total fees | total markup
 *
 * All as a percentage of what the guest pays. Commission and bank charges
 * are entered from the channel's invoices; the VAT on commission is the
 * property's VAT rate (15%) on the commission. Total fees is their sum;
 * total markup is what Smoobu has to add to the base for the payout to be
 * the base again: 1 / (1 − total fees) − 1.
 *
 * Analytics has always read commission, bank charges and a VAT rate per
 * channel from the property row, and works out
 *
 *   revenue × commission + revenue × bank + (commission + bank) × VAT.
 *
 * Saving the table writes those three back so that formula gives exactly
 * the table's total: the commission, the VAT rate, and the bank charges
 * net of VAT (the formula adds the VAT on them back).
 */

const { getAll, getOne, run } = require('../db/database');

/**
 * A booking's total fees, in percent, from the row in force on the day it
 * was made — as SQL, for every query that feeds calcDeductions. Expects the
 * booking as `b` and its property as `p`; NULL where the property has no
 * row for the channel (or the booking is direct), and calcDeductions then
 * falls back to the property's columns.
 */
const BOOKING_FEE_SQL = `(
  SELECT f.commission * (1 + COALESCE(NULLIF(p.vat_rate, 0), 15) / 100.0) + f.bank_charges
    FROM channel_fees f
   WHERE f.property_id = p.id
     AND f.channel = CASE
           WHEN b.platform ILIKE '%direct%' THEN NULL
           WHEN b.platform ILIKE '%airbnb%' THEN 'airbnb'
           WHEN b.platform ILIKE '%booking%' THEN 'booking'
           WHEN b.platform ILIKE '%vrbo%' OR b.platform ILIKE '%homeaway%' THEN 'vrbo'
         END
     AND f.valid_from <= COALESCE(NULLIF(substring(b.created_at, 1, 10), '')::date, CURRENT_DATE)
   ORDER BY f.valid_from DESC LIMIT 1
) AS fee_total_pct`;

const CHANNELS = [
  { key: 'airbnb', label: 'Airbnb' },
  { key: 'booking', label: 'Booking.com' },
  { key: 'vrbo', label: 'Vrbo' },
];
const KEYS = CHANNELS.map((c) => c.key);
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** Total fees and the markup that pays out the base, for one row. */
function totals({ commission = 0, vat_on_commission = 0, bank_charges = 0 }) {
  const total = Number(commission) + Number(vat_on_commission) + Number(bank_charges);
  return {
    total_fees: round(total),
    total_markup: total < 100 ? round((1 / (1 - total / 100) - 1) * 100) : null,
  };
}

/** VAT on commission: the property's VAT rate on the commission. */
const vatOn = (commission, vatRate) => round(Number(commission) * Number(vatRate) / 100, 4);

/** The three legacy columns that make analytics' formula equal the table. */
function legacyColumns({ commission = 0, bank_charges = 0 }, vatRate = 15) {
  const c = Number(commission), b = Number(bank_charges), v = Number(vatRate);
  return {
    // A commission of 0 would make analytics fall back to Smoobu's figure.
    commission: c > 0 ? c : 0.000001,
    vat: v,
    bank: round(b / (1 + v / 100), 6),
  };
}

const START = '2000-01-01';
const ymd = (d) => String(d).slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Each channel's row in force today, with every row it has had — newest
 * first — so the screen can show what applied when.
 */
async function feesFor(propertyId) {
  const property = await getOne(
    'SELECT id, COALESCE(NULLIF(vat_rate, 0), 15) AS vat_rate, guest_markup_airbnb, guest_markup_booking, guest_markup_vrbo FROM properties WHERE id = $1', [propertyId]
  );
  if (!property) return null;
  const all = await getAll(
    `SELECT channel, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, commission, bank_charges, updated_at FROM channel_fees
      WHERE property_id = $1 ORDER BY channel, valid_from DESC`, [propertyId]
  );
  const vatRate = Number(property.vat_rate);
  const shape = (r) => {
    const values = { commission: Number(r.commission), vat_on_commission: vatOn(r.commission, vatRate), bank_charges: Number(r.bank_charges) };
    const from = ymd(r.valid_from);
    return { valid_from: from === START ? null : from, ...values, ...totals(values) };
  };
  return CHANNELS.map(({ key, label }) => {
    const rows = all.filter((r) => r.channel === key);
    const now = rows.find((r) => ymd(r.valid_from) <= today()) || null;
    const current = now ? shape(now) : null;
    const smoobu = Number(property[`guest_markup_${key}`]) || 0;
    return {
      channel: key, label,
      ...(current || { valid_from: null, commission: null, vat_on_commission: null, bank_charges: null, total_fees: null, total_markup: null }),
      smoobu_markup: smoobu,
      // The payout per rand of base at today's Smoobu markup.
      payout: current ? round((1 + smoobu / 100) * (1 - current.total_fees / 100), 4) : null,
      vat_rate: vatRate,
      history: rows.map(shape),
    };
  });
}

/** The legacy columns follow the row in force today. */
async function syncLegacy(propertyId, channel, vatRate) {
  const now = await getOne(
    `SELECT commission, bank_charges FROM channel_fees WHERE property_id = $1 AND channel = $2 AND valid_from <= CURRENT_DATE
      ORDER BY valid_from DESC LIMIT 1`, [propertyId, channel]
  );
  if (!now) return;
  const legacy = legacyColumns({ commission: now.commission, bank_charges: now.bank_charges }, vatRate);
  await run(
    `UPDATE properties SET commission_${channel} = $2, vat_${channel} = $3, bank_charge_${channel} = $4 WHERE id = $1`,
    [propertyId, legacy.commission, legacy.vat, legacy.bank]
  );
}

/**
 * Save rows. A row without a date applies from the start; one with a date
 * applies from that day, leaving the rows before it as they were — so a
 * change of fee never rewrites the bookings made under the old one.
 */
async function saveFees(propertyId, entries = []) {
  const p = await getOne('SELECT COALESCE(NULLIF(vat_rate, 0), 15) AS vat_rate FROM properties WHERE id = $1', [propertyId]);
  const vatRate = Number(p ? p.vat_rate : 15);
  for (const e of entries) {
    if (!KEYS.includes(e.channel)) throw Object.assign(new Error(`Unknown channel: ${e.channel}`), { status: 400 });
    const from = e.valid_from ? String(e.valid_from).slice(0, 10) : START;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw Object.assign(new Error('The date must be YYYY-MM-DD'), { status: 400 });
    const nums = ['commission', 'bank_charges'].map((k) => Number(e[k] ?? 0));
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 60)) {
      throw Object.assign(new Error('Each fee must be between 0% and 60%'), { status: 400 });
    }
    const [commission, bankCharges] = nums;
    const vatOnCommission = vatOn(commission, vatRate);
    if (commission + vatOnCommission + bankCharges >= 100) {
      throw Object.assign(new Error('The fees cannot add up to 100% or more'), { status: 400 });
    }
    await run(
      `INSERT INTO channel_fees (property_id, channel, valid_from, commission, vat_on_commission, bank_charges, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (property_id, channel, valid_from) DO UPDATE SET commission = EXCLUDED.commission,
         vat_on_commission = EXCLUDED.vat_on_commission, bank_charges = EXCLUDED.bank_charges, updated_at = NOW()`,
      [propertyId, e.channel, from, commission, vatOnCommission, bankCharges]
    );
    await syncLegacy(propertyId, e.channel, vatRate);
  }
}

/** Remove one dated row (a mistake); the row before it applies again. */
async function removeFee(propertyId, channel, validFrom) {
  if (!KEYS.includes(channel)) throw Object.assign(new Error(`Unknown channel: ${channel}`), { status: 400 });
  const from = validFrom && validFrom !== 'start' ? String(validFrom).slice(0, 10) : START;
  await run('DELETE FROM channel_fees WHERE property_id = $1 AND channel = $2 AND valid_from = $3', [propertyId, channel, from]);
  const p = await getOne('SELECT COALESCE(NULLIF(vat_rate, 0), 15) AS vat_rate FROM properties WHERE id = $1', [propertyId]);
  await syncLegacy(propertyId, channel, Number(p ? p.vat_rate : 15));
}

module.exports = { CHANNELS, BOOKING_FEE_SQL, totals, legacyColumns, vatOn, feesFor, saveFees, removeFee };
