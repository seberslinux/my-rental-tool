/**
 * Signing Claude in to the app (OAuth 2.1, as MCP clients expect).
 *
 * Claude registers itself, sends the person here, they sign in with their
 * own app account (email and password, or Google) and allow it; Claude
 * then holds a token that acts as that person — admin or property manager,
 * for the properties they have. Cleaners cannot connect.
 *
 * Only Claude's own addresses (and this computer, for Claude Code and the
 * desktop app) may receive a sign-in: MCP_REDIRECT_HOSTS. Tokens are kept
 * as hashes; an access token lasts an hour, a refresh token 30 days and is
 * replaced each time it is used.
 */

const crypto = require('crypto');
const { getOne, run } = require('../db/database');
const { InvalidGrantError, InvalidTokenError, InvalidClientMetadataError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const ACCESS_SECONDS = 60 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const CODE_MS = 5 * 60 * 1000;
const REQUEST_MS = 15 * 60 * 1000;
const ROLES = ['admin', 'property_manager'];

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const redirectHosts = () => (process.env.MCP_REDIRECT_HOSTS || 'claude.ai,claude.com,localhost,127.0.0.1')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

function allowedRedirect(uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!local && u.protocol !== 'https:') return false;
  return redirectHosts().some((h) => host === h || host.endsWith(`.${h}`));
}

// Sign-ins in progress (the consent page) and codes waiting to be swapped
// for tokens. Short-lived, so memory is enough; a restart just means
// signing in again.
const requests = new Map();
const codes = new Map();
const sweep = (m) => { const now = Date.now(); for (const [k, v] of m) if (v.expires < now) m.delete(k); };

const clientsStore = {
  async getClient(clientId) {
    const row = await getOne('SELECT info FROM mcp_clients WHERE client_id = $1', [clientId]);
    return row ? row.info : undefined;
  },
  async registerClient(client) {
    const uris = client.redirect_uris || [];
    if (!uris.length || !uris.every(allowedRedirect)) {
      throw new InvalidClientMetadataError('This server only signs in Claude');
    }
    await run('INSERT INTO mcp_clients (client_id, info) VALUES ($1, $2)', [client.client_id, client]);
    return client;
  },
};

async function issueTokens({ clientId, userId, scopes, resource }) {
  const access = secret();
  const refresh = secret();
  const row = [clientId, userId, (scopes || []).join(' '), resource || null];
  await run(
    `INSERT INTO mcp_tokens (token_hash, kind, client_id, user_id, scopes, resource, expires_at)
     VALUES ($1, 'access', $2, $3, $4, $5, NOW() + make_interval(secs => $6)),
            ($7, 'refresh', $2, $3, $4, $5, NOW() + make_interval(secs => $8))`,
    [hash(access), ...row, ACCESS_SECONDS, hash(refresh), REFRESH_SECONDS]
  );
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: (scopes || []).join(' ') || undefined };
}

/** The person a token stands for, if they may still use it. */
async function userFor(userId) {
  const u = await getOne('SELECT id, email, name, role, avatar_url, active FROM users WHERE id = $1 AND active = 1', [userId]);
  return u && ROLES.includes(u.role) ? u : null;
}

const provider = {
  clientsStore,

  /** Claude's sign-in request: on to the consent page, signed in or not. */
  async authorize(client, params, res) {
    sweep(requests);
    const id = secret();
    requests.set(id, { client, params, expires: Date.now() + REQUEST_MS });
    res.redirect(302, `/oauth/consent?request=${encodeURIComponent(id)}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const c = codes.get(hash(code));
    if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Invalid or expired code');
    return c.codeChallenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const key = hash(code);
    const c = codes.get(key);
    codes.delete(key); // once only
    if (!c || c.clientId !== client.client_id || c.expires < Date.now()) throw new InvalidGrantError('Invalid or expired code');
    if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('Redirect URI does not match');
    if (!(await userFor(c.userId))) throw new InvalidGrantError('This account cannot connect Claude');
    return issueTokens({ clientId: client.client_id, userId: c.userId, scopes: c.scopes, resource: c.resource });
  },

  async exchangeRefreshToken(client, refreshToken) {
    const row = await getOne(
      `UPDATE mcp_tokens SET revoked_at = NOW()
        WHERE token_hash = $1 AND kind = 'refresh' AND client_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING user_id, scopes, resource`,
      [hash(refreshToken), client.client_id]
    );
    if (!row || !(await userFor(row.user_id))) throw new InvalidGrantError('Invalid or expired refresh token');
    return issueTokens({ clientId: client.client_id, userId: row.user_id, scopes: row.scopes ? row.scopes.split(' ') : [], resource: row.resource });
  },

  async verifyAccessToken(token) {
    const row = await getOne(
      `SELECT client_id, user_id, scopes, resource, EXTRACT(EPOCH FROM expires_at)::bigint AS exp
         FROM mcp_tokens WHERE token_hash = $1 AND kind = 'access' AND revoked_at IS NULL AND expires_at > NOW()`,
      [hash(token)]
    );
    const user = row && (await userFor(row.user_id));
    if (!user) throw new InvalidTokenError('Invalid or expired token');
    return {
      token, clientId: row.client_id, scopes: row.scopes ? row.scopes.split(' ') : [],
      expiresAt: Number(row.exp), resource: row.resource ? new URL(row.resource) : undefined, extra: { user },
    };
  },

  async revokeToken(client, { token }) {
    await run('UPDATE mcp_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND client_id = $2', [hash(token), client.client_id]);
  },
};

/** For the consent page. */
function pendingRequest(id) {
  sweep(requests);
  return requests.get(String(id || '')) || null;
}

/** The person allowed it: a one-time code back to Claude. */
function approve(id, user) {
  const r = pendingRequest(id);
  if (!r) return null;
  requests.delete(id);
  sweep(codes);
  const code = secret();
  codes.set(hash(code), {
    clientId: r.client.client_id, userId: user.id, codeChallenge: r.params.codeChallenge,
    redirectUri: r.params.redirectUri, scopes: r.params.scopes || [],
    resource: r.params.resource ? String(r.params.resource) : null, expires: Date.now() + CODE_MS,
  });
  const to = new URL(r.params.redirectUri);
  to.searchParams.set('code', code);
  if (r.params.state) to.searchParams.set('state', r.params.state);
  return to.href;
}

function deny(id) {
  const r = pendingRequest(id);
  if (!r) return null;
  requests.delete(id);
  const to = new URL(r.params.redirectUri);
  to.searchParams.set('error', 'access_denied');
  if (r.params.state) to.searchParams.set('state', r.params.state);
  return to.href;
}

module.exports = { provider, pendingRequest, approve, deny, allowedRedirect, ROLES };
