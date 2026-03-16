const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getAll, getOne, run } = require('../db/database');
const { requireRole } = require('../middleware/auth');

// All user routes require admin
router.use(requireRole('admin'));

// List all users
router.get('/', async (req, res) => {
  const users = await getAll(
    'SELECT id, email, name, role, avatar_url, active, created_at FROM users ORDER BY name'
  );

  // Attach property access for property_managers
  for (const user of users) {
    if (user.role === 'property_manager') {
      const rows = await getAll('SELECT property_id FROM user_property_access WHERE user_id = $1', [user.id]);
      user.property_ids = rows.map(r => r.property_id);
    } else {
      user.property_ids = [];
    }
  }

  res.json(users);
});

// Create user
router.post('/', async (req, res) => {
  const { email, name, role, password, property_ids } = req.body;

  if (!email || !name || !role) {
    return res.status(400).json({ error: 'email, name, and role are required' });
  }

  if (!['admin', 'property_manager', 'cleaner'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Check for duplicate email
  const existing = await getOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

  const result = await run(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, name, role, passwordHash]
  );

  const userId = result.rows[0].id;

  // Set property access for property_manager
  if (role === 'property_manager' && Array.isArray(property_ids)) {
    for (const pid of property_ids) {
      await run('INSERT INTO user_property_access (user_id, property_id) VALUES ($1, $2)', [userId, pid]);
    }
  }

  res.json({ id: userId, email, name, role });
});

// Update user
router.put('/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { name, role, active, password, property_ids } = req.body;

  const user = await getOne('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Prevent admin from deactivating themselves
  if (userId === req.user.id && active === 0) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' });
  }

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
  if (role !== undefined) {
    if (!['admin', 'property_manager', 'cleaner'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.push(`role = $${paramIndex++}`); params.push(role);
  }
  if (active !== undefined) { updates.push(`active = $${paramIndex++}`); params.push(active ? 1 : 0); }
  if (password) { updates.push(`password_hash = $${paramIndex++}`); params.push(bcrypt.hashSync(password, 10)); }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    params.push(userId);
    await run(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);
  }

  // Update property access
  const effectiveRole = role !== undefined ? role : user.role;
  if (effectiveRole === 'property_manager' && Array.isArray(property_ids)) {
    await run('DELETE FROM user_property_access WHERE user_id = $1', [userId]);
    for (const pid of property_ids) {
      await run('INSERT INTO user_property_access (user_id, property_id) VALUES ($1, $2)', [userId, pid]);
    }
  } else if (effectiveRole !== 'property_manager') {
    // Clear property access if role changed away from property_manager
    await run('DELETE FROM user_property_access WHERE user_id = $1', [userId]);
  }

  res.json({ ok: true });
});

// Soft-delete user
router.delete('/:id', async (req, res) => {
  const userId = parseInt(req.params.id);

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = await getOne('SELECT id FROM users WHERE id = $1', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await run('UPDATE users SET active = 0, updated_at = NOW() WHERE id = $1', [userId]);
  res.json({ ok: true });
});

module.exports = router;
