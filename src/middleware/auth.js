const { getOne, getAll } = require('../db/database');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  // Accept cleaner PIN sessions
  if (req.session && req.session.cleanerId) return next();
  return res.status(401).json({ error: 'Authentication required' });
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
  // Handle PIN-auth cleaner sessions
  if (req.session && req.session.cleanerId && !req.user) {
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

module.exports = { requireAuth, requireRole, scopeProperties, enforcePropertyScope, isPropertyInScope, denyIfOutOfScope };
