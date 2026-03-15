const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const { requireRole } = require('../middleware/auth');

// All user routes require admin
router.use(requireRole('admin'));

// List all users
router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, email, name, role, avatar_url, active, created_at FROM users ORDER BY name'
  ).all();

  // Attach property access for property_managers
  const accessStmt = db.prepare('SELECT property_id FROM user_property_access WHERE user_id = ?');
  for (const user of users) {
    if (user.role === 'property_manager') {
      user.property_ids = accessStmt.all(user.id).map(r => r.property_id);
    } else {
      user.property_ids = [];
    }
  }

  res.json(users);
});

// Create user
router.post('/', (req, res) => {
  const db = getDb();
  const { email, name, role, password, property_ids } = req.body;

  if (!email || !name || !role) {
    return res.status(400).json({ error: 'email, name, and role are required' });
  }

  if (!['admin', 'property_manager', 'cleaner'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Check for duplicate email
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

  const result = db.prepare(
    'INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)'
  ).run(email, name, role, passwordHash);

  const userId = result.lastInsertRowid;

  // Set property access for property_manager
  if (role === 'property_manager' && Array.isArray(property_ids)) {
    const ins = db.prepare('INSERT INTO user_property_access (user_id, property_id) VALUES (?, ?)');
    for (const pid of property_ids) {
      ins.run(userId, pid);
    }
  }

  res.json({ id: userId, email, name, role });
});

// Update user
router.put('/:id', (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);
  const { name, role, active, password, property_ids } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Prevent admin from deactivating themselves
  if (userId === req.user.id && active === 0) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (role !== undefined) {
    if (!['admin', 'property_manager', 'cleaner'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.push('role = ?'); params.push(role);
  }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
  if (password) { updates.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }

  if (updates.length > 0) {
    updates.push('updated_at = datetime(\'now\')');
    params.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  // Update property access
  const effectiveRole = role !== undefined ? role : user.role;
  if (effectiveRole === 'property_manager' && Array.isArray(property_ids)) {
    db.prepare('DELETE FROM user_property_access WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO user_property_access (user_id, property_id) VALUES (?, ?)');
    for (const pid of property_ids) {
      ins.run(userId, pid);
    }
  } else if (effectiveRole !== 'property_manager') {
    // Clear property access if role changed away from property_manager
    db.prepare('DELETE FROM user_property_access WHERE user_id = ?').run(userId);
  }

  res.json({ ok: true });
});

// Soft-delete user
router.delete('/:id', (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(userId);
  res.json({ ok: true });
});

module.exports = router;
