/**
 * Paystack, for direct bookings: start a payment, ask whether it was paid,
 * and check that a webhook really came from Paystack. Nothing else — no
 * stored cards, no refunds from code.
 *
 * The secret key lives in PAYSTACK_SECRET_KEY on Railway (a test key,
 * sk_test_…, until going live). Amounts are in cents.
 */

const crypto = require('crypto');

const BASE = 'https://api.paystack.co';

let fetchImpl = (...args) => fetch(...args);
/** Tests replace the network; pass null to put it back. */
function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

const secret = () => process.env.PAYSTACK_SECRET_KEY || '';
const configured = () => Boolean(secret());

async function call(method, path, body) {
  if (!configured()) throw Object.assign(new Error('Payments are not set up (PAYSTACK_SECRET_KEY is missing)'), { status: 503 });
  const res = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw Object.assign(new Error(`Paystack: ${json.message || `status ${res.status}`}`), { status: 502 });
  }
  return json.data;
}

/** A checkout for one payment; the guest is sent to `authorization_url`. */
async function initialize({ email, amountCents, currency = 'ZAR', reference, callbackUrl, metadata }) {
  const data = await call('POST', '/transaction/initialize', {
    email, amount: amountCents, currency, reference, callback_url: callbackUrl, metadata,
  });
  return { authorizationUrl: data.authorization_url, reference: data.reference };
}

/** What Paystack says about a payment: its status, amount (cents) and currency. */
async function verify(reference) {
  const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: data.status, amountCents: Number(data.amount), currency: data.currency, paidAt: data.paid_at || null };
}

/** A webhook is Paystack's when its body, signed with our secret, matches the header. */
function validSignature(rawBody, signature) {
  if (!configured() || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', secret()).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { configured, initialize, verify, validSignature, setFetch };
