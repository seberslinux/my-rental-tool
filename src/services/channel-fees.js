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

async function feesFor(propertyId) {
  const property = await getOne(
    'SELECT id, COALESCE(NULLIF(vat_rate, 0), 15) AS vat_rate, guest_markup_airbnb, guest_markup_booking, guest_markup_vrbo FROM properties WHERE id = $1', [propertyId]
  );
  if (!property) return null;
  const rows = new Map((await getAll(
    'SELECT channel, commission, vat_on_commission, bank_charges, updated_at FROM channel_fees WHERE property_id = $1', [propertyId]
  )).map((r) => [r.channel, r]));
  return CHANNELS.map(({ key, label }) => {
    const r = rows.get(key);
    const values = r ? {
      commission: Number(r.commission), vat_on_commission: vatOn(r.commission, property.vat_rate), bank_charges: Number(r.bank_charges),
    } : null;
    const smoobu = Number(property[`guest_markup_${key}`]) || 0;
    const t = values ? totals(values) : { total_fees: null, total_markup: null };
    return {
      channel: key, label, ...(values || { commission: null, vat_on_commission: null, bank_charges: null }), ...t,
      smoobu_markup: smoobu,
      // The payout per rand of base at today's Smoobu markup.
      payout: values && t.total_fees != null ? round((1 + smoobu / 100) * (1 - t.total_fees / 100), 4) : null,
      vat_rate: Number(property.vat_rate),
      updated_at: r ? r.updated_at : null,
    };
  });
}

async function saveFees(propertyId, entries = []) {
  const p = await getOne('SELECT COALESCE(NULLIF(vat_rate, 0), 15) AS vat_rate FROM properties WHERE id = $1', [propertyId]);
  const vatRate = Number(p ? p.vat_rate : 15);
  for (const e of entries) {
    if (!KEYS.includes(e.channel)) throw Object.assign(new Error(`Unknown channel: ${e.channel}`), { status: 400 });
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
      `INSERT INTO channel_fees (property_id, channel, commission, vat_on_commission, bank_charges, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (property_id, channel) DO UPDATE SET commission = EXCLUDED.commission,
         vat_on_commission = EXCLUDED.vat_on_commission, bank_charges = EXCLUDED.bank_charges, updated_at = NOW()`,
      [propertyId, e.channel, commission, vatOnCommission, bankCharges]
    );
    const legacy = legacyColumns({ commission, bank_charges: bankCharges }, vatRate);
    await run(
      `UPDATE properties SET commission_${e.channel} = $2, vat_${e.channel} = $3, bank_charge_${e.channel} = $4 WHERE id = $1`,
      [propertyId, legacy.commission, legacy.vat, legacy.bank]
    );
  }
}

module.exports = { CHANNELS, totals, legacyColumns, vatOn, feesFor, saveFees };
