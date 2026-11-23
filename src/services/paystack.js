/**
 * Paystack, for direct bookings: start a payment, ask whether it was paid,
 * and check that a webhook really came from Paystack. Nothing else — no
 * stored cards, no refunds from code.
 *
 * Every call takes the secret key of the account to use: each property is
 * paid into its own Paystack account (see payment-accounts). Amounts are
 * in cents.
 */

const crypto = require('crypto');

const BASE = 'https://api.paystack.co';

let fetchImpl = (...args) => fetch(...args);
/** Tests replace the network; pass null to put it back. */
function setFetch(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

async function call(key, method, path, body) {
  if (!key) throw Object.assign(new Error('This property has no Paystack account yet'), { status: 503 });
  const res = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw Object.assign(new Error(`Paystack: ${json.message || `status ${res.status}`}`), { status: res.status === 401 ? 400 : 502 });
  }
  return json.data;
}

/** A checkout for one payment; the guest is sent to `authorizationUrl`. */
async function initialize(key, { email, amountCents, currency = 'ZAR', reference, callbackUrl, metadata }) {
  const data = await call(key, 'POST', '/transaction/initialize', {
    email, amount: amountCents, currency, reference, callback_url: callbackUrl, metadata,
  });
  return { authorizationUrl: data.authorization_url, reference: data.reference };
}

/** What Paystack says about a payment: its status, amount (cents) and currency. */
async function verify(key, reference) {
  const data = await call(key, 'GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  return { status: data.status, amountCents: Number(data.amount), currency: data.currency, paidAt: data.paid_at || null };
}

/** Whether a secret key works: Paystack answers its balance only to the right key. */
async function check(key) {
  await call(key, 'GET', '/balance');
  return true;
}

/** Test or live, from the key itself. */
const modeOf = (key) => (/^sk_live_/.test(key || '') ? 'live' : /^sk_test_/.test(key || '') ? 'test' : null);

/** A webhook is the account's when its body, signed with that account's key, matches the header. */
function validSignature(key, rawBody, signature) {
  if (!key || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', key).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { initialize, verify, check, modeOf, validSignature, setFetch };
