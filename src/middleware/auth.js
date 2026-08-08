const { getOne, getAll } = require('../db/database');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  // Accept cleaner PIN sessions
  if (req.session && req.session.cleanerId) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

/**
 * A cleaner session may only reach the cleaner portal.
 *
 * requireAuth admits cleaner PIN sessions, and everything under /api sits
 * behind requireAuth alone. That was enough to let a cleaner read the
 * owner's business: /api/dashboard/kpis returned gross and net revenue,
 * /api/analytics/data the full breakdown, /api/bookings guest names and
 * what they paid, and /api/cleaners the other cleaners' pay rates. Every
 * one answered 200 to a session opened with a 4-digit PIN.
 *
 * Property scoping did not help. It narrows those answers to the
 * cleaner's own properties, which is precisely the revenue they should
 * never have seen.
 *
 * So the rule is stated once, here, as an allow-list. A new manager
 * route is closed to cleaners by default rather than open until somebody
 * remembers — which is how the hole arose in the first place.
 */
const CLEANER_ALLOWED_PREFIXES = ['/cleaner-portal'];

/**
 * Is this request coming from the cleaner's app?
 *
 * Two ways in, and both count:
 *
 * A PIN on the session makes it a cleaner session whatever else the
 * session carries. This used to also require `!req.user`, which meant
 * somebody holding both logins at once — a manager who is also a cleaner,
 * signing in on the phone tab without signing out first — turned the whole
 * restriction off. The API then answered them as the manager: revenue,
 * analytics, other cleaners' rates, all 200. Sessions are now kept
 * exclusive at both login routes, so this state should not arise; the test
 * stays broad anyway, because a rule that protects revenue should fail
 * closed rather than depend on a login route elsewhere behaving.
 *
 * A Passport user whose role is cleaner is also a cleaner. The client
 * hands that role the cleaner's app, so the API has to agree — otherwise
 * the same person reaches the manager's data through a Google sign-in
 * instead of a PIN.
 */
function isCleanerSession(req) {
  if (req.session && req.session.cleanerId) return true;
  return Boolean(req.user && req.user.role === 'cleaner');
}

function restrictCleanerSessions(req, res, next) {
  if (!isCleanerSession(req)) return next();

  const path = req.path || '';
  if (CLEANER_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    return next();
  }
  return res.status(403).json({ error: 'Cleaners can only access the cleaner portal' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

async function scopeProperties(req, res, next) {
  // Handle PIN-auth cleaner sessions. Checked before req.user for the same
  // reason as isCleanerSession: a PIN on the session means cleaner, and
  // deferring to a manager login that happens to be there too is how the
  // scoping got skipped.
  if (req.session && req.session.cleanerId) {
    try {
      const rows = await getAll(
        'SELECT property_id FROM cleaner_properties WHERE cleaner_id = $1',
        [req.session.cleanerId]
      );
      req.accessiblePropertyIds = rows.map(r => r.property_id);
      return next();
    } catch (err) { return next(err); }
  }

  if (!req.user) return next();

  if (req.user.role === 'admin') {
    // Admin sees all, but also load their property roles for ownership checks
    const rows = await getAll(
      'SELECT property_id, role FROM user_properties WHERE user_id = $1',
      [req.user.id]
    );
    req.propertyRoles = new Map(rows.map(r => [r.property_id, r.role]));
    req.accessiblePropertyIds = null; // null = all properties
    return next();
  }

  try {
    // Use user_properties for all non-admin users (owner, manager, viewer)
    if (req.user.role === 'property_manager') {
      const rows = await getAll(
        'SELECT property_id, role FROM user_properties WHERE user_id = $1',
        [req.user.id]
      );
      req.propertyRoles = new Map(rows.map(r => [r.property_id, r.role]));
      req.accessiblePropertyIds = rows.map(r => r.property_id);
      return next();
    }

    if (req.user.role === 'cleaner') {
      // Match cleaner by email to get their assigned properties
      const cleaner = await getOne('SELECT id FROM cleaners WHERE email = $1', [req.user.email]);
      if (cleaner) {
        const rows = await getAll(
          'SELECT property_id FROM cleaner_properties WHERE cleaner_id = $1',
          [cleaner.id]
        );
        req.accessiblePropertyIds = rows.map(r => r.property_id);
      } else {
        req.accessiblePropertyIds = [];
      }
      return next();
    }

    req.accessiblePropertyIds = [];
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Enforce property scoping on a parsed property_id filter.
 * Call after scopeProperties. Returns the intersection of requested IDs
 * and the user's accessible IDs (or null if the user has full access and
 * requested all).
 */
function enforcePropertyScope(req, requestedIds) {
  // requestedIds comes from parsePropertyIds: null means "all requested"
  // req.accessiblePropertyIds: null means "admin, full access"
  if (req.accessiblePropertyIds === null) {
    // Admin — honour whatever was requested
    return requestedIds;
  }
  const allowed = req.accessiblePropertyIds;
  if (!requestedIds) {
    // User asked for "all" but is scoped — return their allowed set
    return allowed.length > 0 ? allowed.map(String) : [];
  }
  // Intersect requested with allowed
  const allowedSet = new Set(allowed.map(String));
  return requestedIds.filter(id => allowedSet.has(String(id)));
}

/**
 * Check whether a single property id is within the requesting user's
 * accessible scope. Call after scopeProperties has populated
 * req.accessiblePropertyIds. Returns true for admins (null = full access).
 */
function isPropertyInScope(req, propertyId) {
  if (req.accessiblePropertyIds === null) return true; // admin — full access
  if (propertyId === undefined || propertyId === null) return false;
  return req.accessiblePropertyIds.map(String).includes(String(propertyId));
}

/**
 * Express helper: 403s the response if propertyId is not in the requester's
 * scope. Returns true if it responded (caller should stop handling), false
 * if the request is in scope and may proceed.
 */
function denyIfOutOfScope(req, res, propertyId) {
  if (!isPropertyInScope(req, propertyId)) {
    res.status(403).json({ error: 'Access denied to this property' });
    return true;
  }
  return false;
}

module.exports = {
  restrictCleanerSessions, requireAuth, requireRole, scopeProperties, enforcePropertyScope, isPropertyInScope, denyIfOutOfScope };
