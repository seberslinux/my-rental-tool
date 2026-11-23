/**
 * Which Paystack account each property is paid into.
 *
 * Each property has its own: the Loft is paid into one owner's account,
 * the Lodge into the owners' joint one. The secret key is stored
 * encrypted on the property, as the Smoobu key is on its user, and never
 * leaves the server. A property without a key cannot take payments —
 * there is no shared key to fall back on, so no payment can land in
 * another property's account.
 */

const { getAll, getOne, run } = require('../db/database');
const { encrypt, decrypt } = require('./encryption');
const paystack = require('./paystack');

/** The property's secret key, or null. */
async function keyFor(propertyId) {
  const row = await getOne('SELECT paystack_key_encrypted, paystack_key_iv FROM properties WHERE id = $1', [propertyId]);
  if (!row || !row.paystack_key_encrypted || !row.paystack_key_iv) return null;
  try {
    return decrypt(row.paystack_key_encrypted, row.paystack_key_iv);
  } catch (err) {
    console.error(`payment-accounts: cannot decrypt the Paystack key of property ${propertyId}`);
    return null;
  }
}

/** For the screen: per property, whether it is connected, test or live, and whose account. Never the key. */
async function accounts(propertyIds = null) {
  const rows = await getAll(
    `SELECT id, name, paystack_account_name, paystack_key_encrypted IS NOT NULL AS connected FROM properties
      WHERE ($1::int[] IS NULL OR id = ANY($1::int[])) ORDER BY name`, [propertyIds]
  );
  const out = [];
  for (const r of rows) {
    const key = r.connected ? await keyFor(r.id) : null;
    out.push({ property_id: r.id, name: r.name, connected: Boolean(key), mode: key ? paystack.modeOf(key) : null, account_name: r.paystack_account_name || null });
  }
  return out;
}

/** Connect a property to a Paystack account, once Paystack accepts the key. */
async function connect(propertyId, { secretKey, accountName }) {
  const key = String(secretKey || '').trim();
  if (!paystack.modeOf(key)) throw Object.assign(new Error('That is not a Paystack secret key (it starts sk_test_ or sk_live_)'), { status: 400 });
  if (!accountName || !String(accountName).trim()) throw Object.assign(new Error('Say whose account it is, e.g. "Francesca"'), { status: 400 });
  await paystack.check(key);
  const { encrypted, iv } = encrypt(key);
  await run('UPDATE properties SET paystack_key_encrypted = $2, paystack_key_iv = $3, paystack_account_name = $4 WHERE id = $1',
    [propertyId, encrypted, iv, String(accountName).trim().slice(0, 80)]);
}

async function disconnect(propertyId) {
  await run('UPDATE properties SET paystack_key_encrypted = NULL, paystack_key_iv = NULL, paystack_account_name = NULL WHERE id = $1', [propertyId]);
}

module.exports = { keyFor, accounts, connect, disconnect };
