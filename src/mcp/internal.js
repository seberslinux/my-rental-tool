/**
 * Claude's tools answer through the app's own pages, as the person who
 * signed Claude in — so the role and property checks, the safeguards on
 * rate changes and the payment-link rules are the app's, not copies.
 *
 * Each call is a request to the app on this machine only (127.0.0.1, a
 * port of its own) carrying a one-time key that stands for that person.
 * The key lives in this process's memory only, for that one request.
 */

const crypto = require('crypto');
const http = require('http');

const HEADER = 'x-mcp-caller';
const callers = new Map();

/** After sign-in: a request carrying a live key is that person's. */
function attachCaller(req, res, next) {
  const key = req.headers[HEADER];
  if (!key) return next();
  const user = callers.get(key);
  callers.delete(key);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}

const loopbacks = new WeakMap();
function loopback(app) {
  if (!loopbacks.has(app)) {
    const server = http.createServer(app);
    loopbacks.set(app, new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    }));
    server.unref();
  }
  return loopbacks.get(app);
}

/** One request to the app as `user`: { status, body }. */
async function asUser(app, user, { method = 'GET', url, body }) {
  const key = crypto.randomBytes(32).toString('base64url');
  callers.set(key, user);
  try {
    const res = await fetch(`${await loopback(app)}${url}`, {
      method,
      headers: { [HEADER]: key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  } finally {
    callers.delete(key);
  }
}

module.exports = { attachCaller, asUser };
