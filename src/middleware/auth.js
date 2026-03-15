const { getDb } = require('../db/database');

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
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

function scopeProperties(req, res, next) {
  if (!req.user) return next();

  if (req.user.role === 'admin') {
    req.accessiblePropertyIds = null; // null = all properties
    return next();
  }

  const db = getDb();

  if (req.user.role === 'property_manager') {
    const rows = db.prepare(
      'SELECT property_id FROM user_property_access WHERE user_id = ?'
    ).all(req.user.id);
    req.accessiblePropertyIds = rows.map(r => r.property_id);
    return next();
  }

  if (req.user.role === 'cleaner') {
    // Match cleaner by email to get their assigned properties
    const cleaner = db.prepare('SELECT id FROM cleaners WHERE email = ?').get(req.user.email);
    if (cleaner) {
      const rows = db.prepare(
        'SELECT property_id FROM cleaner_properties WHERE cleaner_id = ?'
      ).all(cleaner.id);
      req.accessiblePropertyIds = rows.map(r => r.property_id);
    } else {
      req.accessiblePropertyIds = [];
    }
    return next();
  }

  req.accessiblePropertyIds = [];
  next();
}

module.exports = { requireAuth, requireRole, scopeProperties };
