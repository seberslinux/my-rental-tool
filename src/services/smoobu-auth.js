const crypto = require('node:crypto');

/**
 * Signing a Smoobu request.
 *
 * The `Api-Key` header stops working on 25 September 2026. What replaces
 * it is an HMAC over the request itself, so a captured header cannot be
 * replayed against a different path or a different body.
 *
 * Four headers travel with every call:
 *
 *   X-API-Key     the key, which is public, like a username
 *   X-Timestamp   UTC ISO 8601, rejected outside five minutes of their clock
 *   X-Nonce       a fresh UUID, good once inside that window
 *   X-Signature   base64 HMAC-SHA256 of the canonical string below
 *
 * The canonical string is seven lines, in this order, joined by newlines:
 *
 *   method
 *   path
 *   sorted query string      (empty for anything without a query)
 *   timestamp
 *   nonce
 *   sha256 of the body       (sha256 of '' when there is no body)
 *   key
 *
 * Query parameters are sorted because the server rebuilds this string
 * from what it received, and axios does not promise an order. Sorting is
 * what makes both sides produce the same bytes.
 */

const ALGO = 'sha256';

/**
 * Query parameters as Smoobu expects to see them.
 *
 * Sorted by name, and arrays repeated rather than bracketed — axios
 * serialises `{apartments: [1,2]}` as `apartments[]=1&apartments[]=2`,
 * so the signed string has to match what actually goes on the wire.
 */
function canonicalQuery(params = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push([`${k}[]`, String(item)]);
    } else {
      parts.push([k, String(v)]);
    }
  }
  parts.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function sha256Hex(input) {
  return crypto.createHash(ALGO).update(input ?? '', 'utf8').digest('hex');
}

/**
 * The bytes both sides agree to hash.
 *
 * Returned separately from the signature so a failing call can be
 * compared against what the server thinks it received, which is the only
 * practical way to debug a signature mismatch.
 */
function canonicalString({ method, path, params, timestamp, nonce, body, key }) {
  return [
    String(method).toUpperCase(),
    path,
    canonicalQuery(params),
    timestamp,
    nonce,
    sha256Hex(body ? JSON.stringify(body) : ''),
    key,
  ].join('\n');
}

function sign({ method, path, params, body, key, secret, timestamp, nonce }) {
  const ts = timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const n = nonce || crypto.randomUUID();
  const canonical = canonicalString({ method, path, params, timestamp: ts, nonce: n, body, key });
  const signature = crypto.createHmac(ALGO, secret).update(canonical, 'utf8').digest('base64');
  return {
    canonical,
    headers: {
      'X-API-Key': key,
      'X-Timestamp': ts,
      'X-Nonce': n,
      'X-Signature': signature,
    },
  };
}

module.exports = { sign, canonicalString, canonicalQuery, sha256Hex };
