/**
 * The guest's side of a direct booking: the page a payment link opens,
 * the hand-over to Paystack, the way back, and Paystack's webhook.
 *
 * Public — the link's token is the only key. The page shows the stay and
 * its price, and the guest's first name, nothing more.
 */

const express = require('express');
const links = require('../services/payment-links');
const paystack = require('../services/paystack');
const { keyFor } = require('../services/payment-accounts');

const pay = express.Router();
const webhook = express.Router();

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (amount, currency) => `${currency === 'ZAR' ? 'R' : `${currency} `}${Number(amount).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const baseUrl = (req) => (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root { --ink:#222; --muted:#717171; --line:#EBEBEB; --bg:#F7F7F7; --card:#fff; --accent:#222; --ok:#008A05; --warn:#C13515; }
  * { box-sizing:border-box } body { margin:0; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg) }
  main { max-width:480px; margin:0 auto; padding:32px 16px }
  .card { background:var(--card); border-radius:16px; padding:24px; box-shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04) }
  h1 { font-size:22px; margin:0 0 4px } .muted { color:var(--muted) } .row { display:flex; justify-content:space-between; gap:16px; padding:10px 0; border-top:1px solid var(--line) }
  .total { font-weight:700; font-size:18px } button { width:100%; height:52px; border:0; border-radius:10px; background:var(--accent); color:#fff; font-size:17px; font-weight:600; cursor:pointer; margin-top:20px }
  .ok { color:var(--ok); font-weight:600 } .warn { color:var(--warn); font-weight:600 } .small { font-size:13px }
</style></head><body><main>${body}</main></body></html>`;
}

function stay(v) {
  const guests = `${v.adults} adult${v.adults === 1 ? '' : 's'}${v.children ? `, ${v.children} child${v.children === 1 ? '' : 'ren'}` : ''}`;
  return `<h1>${esc(v.property)}</h1><p class="muted">Booking for ${esc(v.first_name)}</p>
  <div class="row"><span>Check-in</span><span>${esc(day(v.check_in))}</span></div>
  <div class="row"><span>Check-out</span><span>${esc(day(v.check_out))}</span></div>
  <div class="row"><span>Nights</span><span>${v.nights}</span></div>
  <div class="row"><span>Guests</span><span>${esc(guests)}</span></div>
  <div class="row total"><span>Total</span><span>${esc(money(v.amount, v.currency))}</span></div>`;
}

pay.get('/:token', async (req, res) => {
  try {
    const v = await links.publicView(req.params.token);
    res.set('Cache-Control', 'no-store');
    if (!v) return res.status(404).send(page('Link not found', '<div class="card"><h1>Link not found</h1><p class="muted">Check the link you were sent, or ask us for a new one.</p></div>'));
    const notice = req.query.e ? `<p class="warn">${esc(req.query.e)}</p>` : '';
    let action;
    if (v.status === 'open' || v.status === 'pending') {
      action = `${notice}<form method="post" action="/pay/${encodeURIComponent(req.params.token)}/start"><button type="submit">Pay ${esc(money(v.amount, v.currency))}</button></form>
        <p class="muted small">Card, Apple Pay or bank payment, through Paystack. The full amount is paid now. This offer is open until ${esc(new Date(v.expires_at).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' }))}.</p>`;
    } else if (v.status === 'booked') {
      action = '<p class="ok">Paid — your booking is confirmed.</p><p class="muted small">Your receipt is on its way by email. We look forward to welcoming you.</p>';
    } else if (v.status === 'booking') {
      action = '<p class="ok">Payment received — confirming your booking.</p><p class="muted small">Refresh this page in a moment.</p>';
    } else if (v.status === 'paid_unbooked') {
      action = '<p class="ok">Payment received.</p><p class="muted small">We will confirm your booking with you personally, shortly.</p>';
    } else {
      action = '<p class="warn">This link is no longer valid.</p><p class="muted small">Ask us for a new one if you would still like to book.</p>';
    }
    res.send(page(`${v.property} — booking`, `<div class="card">${stay(v)}${action}</div>`));
  } catch (err) {
    console.error('pay page:', err.message);
    res.status(500).send(page('Something went wrong', '<div class="card"><h1>Something went wrong</h1><p class="muted">Please try again in a moment.</p></div>'));
  }
});

pay.post('/:token/start', async (req, res) => {
  const back = (msg) => res.redirect(303, `/pay/${encodeURIComponent(req.params.token)}?e=${encodeURIComponent(msg)}`);
  try {
    const url = await links.startPayment(req.params.token, baseUrl(req));
    res.redirect(303, url);
  } catch (err) {
    if (err.status === 404) return res.redirect(303, `/pay/${encodeURIComponent(req.params.token)}`);
    console.error('pay start:', err.message);
    back(err.status && err.status < 500 ? err.message : 'Payment could not be started. Please try again in a moment.');
  }
});

// Paystack sends the guest back here; the link, not the query, says which payment.
pay.get('/:token/return', async (req, res) => {
  try {
    const l = await links.publicView(req.params.token);
    if (l) {
      const row = await require('../db/database').getOne('SELECT paystack_reference FROM payment_links WHERE token = $1', [req.params.token]);
      if (row && row.paystack_reference) await links.settle(row.paystack_reference);
    }
  } catch (err) {
    console.error('pay return:', err.message);
  }
  res.redirect(303, `/pay/${encodeURIComponent(req.params.token)}`);
});

// Each property's account sends its own webhooks; the payment's link says
// which account, and that account's key must have signed the body.
webhook.post('/', async (req, res) => {
  const evt = req.body || {};
  const reference = evt.data && evt.data.reference;
  const link = reference ? await links.byReference(String(reference)).catch(() => null) : null;
  const key = link ? await keyFor(link.property_id) : null;
  if (!paystack.validSignature(key, req.rawBody, req.get('x-paystack-signature'))) {
    // Not ours, or not signed by the account it claims: nothing to do either way.
    return res.status(link ? 401 : 200).end();
  }
  if (evt.event === 'charge.success') {
    try { await links.settle(String(reference)); } catch (err) { console.error('paystack webhook:', err.message); }
  }
  res.status(200).end();
});

module.exports = { pay, webhook, page, esc, baseUrl };
