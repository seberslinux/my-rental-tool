/**
 * What Claude can do with My Rental Tool. Every tool answers through the
 * app's own pages as the signed-in person (see internal.js), so a property
 * manager sees only their properties and the app's rules apply unchanged.
 */

const { z } = require('zod');
const { asUser } = require('./internal');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

const PROPERTY_FIELDS = ['id', 'name', 'max_guests', 'bedrooms', 'base_price', 'base_currency', 'check_in_time', 'check_out_time', 'location'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const guestUrl = (token) => `${(process.env.PUBLIC_BASE_URL || process.env.APP_URL || '').replace(/\/$/, '')}/pay/${token}`;

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

function register(server, { app, userOf }) {
  const call = async (extra, req) => {
    const res = await asUser(app, userOf(extra), req);
    if (res.status >= 400) {
      const msg = res.body && typeof res.body === 'object' ? res.body.error || JSON.stringify(res.body) : String(res.body);
      const err = new Error(msg || `Request failed (${res.status})`);
      err.toolResult = fail(err.message);
      throw err;
    }
    return res.body;
  };
  const tool = (name, config, fn) => server.registerTool(name, config, async (args, extra) => {
    try { return await fn(args, extra); } catch (err) { return err.toolResult || fail(err.message); }
  });
  const read = { readOnlyHint: true, openWorldHint: false };

  tool('list_properties', {
    title: 'Properties',
    description: 'The properties you manage: id, name, guests, bedrooms, minimum (base) price, currency. Use the id in other tools.',
    inputSchema: {},
    annotations: read,
  }, async (_a, extra) => ok((await call(extra, { url: '/api/properties' })).map((p) => pick(p, PROPERTY_FIELDS))));

  tool('get_performance', {
    title: 'Revenue and occupancy',
    description: 'Gross and net revenue (after commission, bank charges and VAT on them), nights, occupancy, ADR, RevPAR by month, by property and by channel; length-of-stay, lead-time, day-of-week and cancellation breakdowns; the same summary for the period before. Amounts in the display currency (ZAR). Bookings counted by stay dates.',
    inputSchema: {
      from: day.optional().describe('First stay date, default a year ago'),
      to: day.optional().describe('Last stay date, default today'),
      property_id: z.number().int().optional().describe('One property; all of yours if left out'),
    },
    annotations: read,
  }, async ({ from, to, property_id }, extra) => {
    const d = await call(extra, { url: `/api/analytics/data?${qs({ from, to, property_id })}` });
    delete d.recent_reviews;
    return ok(d);
  });

  tool('list_bookings', {
    title: 'Bookings',
    description: 'Bookings that overlap a date range: property, dates, nights, channel, guests, gross and net payout, when it was booked and the lead time in days. Cancelled bookings and owner blocks are marked by status/channel. Guest contact details are left out.',
    inputSchema: {
      from: day.optional().describe('Default 30 days ago'),
      to: day.optional().describe('Default a year ahead'),
      property_id: z.number().int().optional(),
      include_cancelled: z.boolean().optional(),
    },
    annotations: read,
  }, async ({ from = addDays(today(), -30), to = addDays(today(), 365), property_id, include_cancelled = false }, extra) => {
    const { bookings, display_currency } = await call(extra, { url: '/api/bookings' });
    const rows = bookings
      .filter((b) => String(b.check_out).slice(0, 10) >= from && String(b.check_in).slice(0, 10) <= to)
      .filter((b) => !property_id || b.property_id === property_id)
      .filter((b) => include_cancelled || b.status !== 'cancelled')
      .map((b) => ({
        id: b.id, property_id: b.property_id, check_in: String(b.check_in).slice(0, 10), check_out: String(b.check_out).slice(0, 10),
        nights: b.length_of_stay, channel: b.platform, status: b.status, guest: String(b.guest_name || '').split(' ')[0] || null,
        adults: b.num_guests, children: b.children, gross: b.converted_total_price ?? b.total_price, net: b.net_payout,
        booked_on: b.created_at ? String(b.created_at).slice(0, 10) : null, lead_days: b.lead_time_days, country: b.guest_country || null,
      }));
    return ok({ currency: display_currency, count: rows.length, bookings: rows });
  });

  tool('competitor_sales', {
    title: 'What the competitors sold',
    description: 'Stays the competitor listings sold (read from their Airbnb calendars), with check-in, nights, lead days and estimated price, summed by week found, by stay month and season and by listing — next to your own sales — plus the leaders and pricing suggestions. Money is an estimate where marked.',
    inputSchema: {
      property_id: z.number().int().optional(),
      weeks: z.number().int().min(1).max(52).optional().describe('Recent weeks of individual sales to include, default 6'),
    },
    annotations: read,
  }, async ({ property_id, weeks = 6 }, extra) => {
    const { properties } = await call(extra, { url: '/api/peers/analysis' });
    return ok(properties.filter((p) => !property_id || p.id === property_id).map((p) => ({ ...p, weeks: (p.weeks || []).slice(0, weeks) })));
  });

  tool('compare_prices', {
    title: 'Prices and occupancy against the competitors',
    description: 'Per property, month by month for the coming months: how much of each competitor\'s calendar is sold versus yours, the benchmark and the peer median; and asking prices per night for coming weekends and weekdays (yours, each competitor\'s, and the median), with the Airbnb markup and average cleaning fee. Recent competitor sales included.',
    inputSchema: { property_id: z.number().int().optional() },
    annotations: read,
  }, async ({ property_id }, extra) => {
    const d = await call(extra, { url: '/api/peers' });
    return ok({ ...d, properties: d.properties.filter((p) => !property_id || p.id === property_id) });
  });

  tool('get_rates', {
    title: 'Nightly rates',
    description: 'Your nightly base rates, minimum stays and availability per date as last read from Smoobu (Airbnb guests see base × (1 + Airbnb markup)).',
    inputSchema: { property_id: z.number().int(), from: day.optional().describe('Default today'), to: day.optional().describe('Default 90 days ahead') },
    annotations: read,
  }, async ({ property_id, from = today(), to }, extra) => {
    const { rates } = await call(extra, { url: `/api/calendar/rates?${qs({ from, to: to || addDays(from, 90) })}` });
    return ok(rates.filter((r) => r.property_id === property_id).map((r) => ({ date: String(r.date).slice(0, 10), price: r.price, min_stay: r.min_stay, available: r.available })));
  });

  tool('set_rates', {
    title: 'Change rates in Smoobu',
    description: 'Sets the nightly base rate (and optionally the minimum stay) for every night from `from` to `to` inclusive, in Smoobu — live, on every channel. Nights already booked are skipped; a rate below the property\'s minimum (base) price is refused. Confirm the dates and price with the user before calling.',
    inputSchema: {
      property_id: z.number().int(), from: day, to: day.optional().describe('Default: same as from'),
      price: z.number().positive().describe('Nightly base rate in the property currency'),
      min_stay: z.number().int().min(1).max(30).optional().describe('Left out, minimum stays are not changed'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ property_id, from, to, price, min_stay }, extra) => ok(await call(extra, {
    method: 'PUT', url: `/api/properties/${property_id}/rates`, body: { from, to: to || from, price, min_stay },
  })));

  tool('quote_stay', {
    title: 'Quote a direct booking',
    description: 'What a stay would cost on Airbnb (rates × Airbnb markup + cleaning) and the direct price (10% below by default), whether the dates are free and meet the minimum stay, and what you would be paid out.',
    inputSchema: { property_id: z.number().int(), check_in: day, check_out: day, discount_percent: z.number().min(0).max(50).optional() },
    annotations: read,
  }, async ({ property_id, check_in, check_out, discount_percent }, extra) => ok(await call(extra, {
    method: 'POST', url: '/api/payment-links/quote', body: { property_id, check_in, check_out, discount_percent },
  })));

  tool('create_payment_link', {
    title: 'Create a payment link',
    description: 'Creates a payment link for a direct booking: the guest pays the full amount through the property\'s payment account and the stay is booked in Smoobu once paid. Amount defaults to the quoted direct price. Returns the link to send the guest. Confirm the details with the user before calling.',
    inputSchema: {
      property_id: z.number().int(), check_in: day, check_out: day,
      first_name: z.string().min(1), last_name: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(),
      adults: z.number().int().min(1).optional(), children: z.number().int().min(0).optional(),
      amount: z.number().positive().optional().describe('Total in rand; default the quoted direct price'),
      note: z.string().optional(), hours: z.number().int().min(1).max(720).optional().describe('How long the link stays open'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (a, extra) => {
    const link = await call(extra, { method: 'POST', url: '/api/payment-links', body: a });
    return ok({ ...link, url: guestUrl(link.token) });
  });

  tool('list_payment_links', {
    title: 'Payment links',
    description: 'Payment links and website bookings: guest, dates, amount, status (open, pending, booked, paid but not booked, expired, cancelled) and where each one came from.',
    inputSchema: { status: z.string().optional() },
    annotations: read,
  }, async ({ status }, extra) => {
    const { links } = await call(extra, { url: '/api/payment-links' });
    return ok(links.filter((l) => !status || l.status === status).map((l) => ({ ...l, url: guestUrl(l.token) })));
  });
}

module.exports = { register };
