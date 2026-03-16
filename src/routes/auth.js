const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('../auth/passport-setup');
const { getOne } = require('../db/database');

// Email/password login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    req.logIn(user, (err) => {
      if (err) return next(err);
      res.json({ id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url });
    });
  })(req, res, next);
});

// Cleaner phone+PIN login (no Passport — manual session)
router.post('/cleaner-login', async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN are required' });

  const cleaner = await getOne('SELECT * FROM cleaners WHERE phone = $1', [phone]);
  if (!cleaner) return res.status(401).json({ error: 'Invalid phone or PIN' });
  if (!cleaner.pin) return res.status(401).json({ error: 'PIN not set. Contact your admin.' });

  const match = bcrypt.compareSync(pin, cleaner.pin);
  if (!match) return res.status(401).json({ error: 'Invalid phone or PIN' });

  req.session.cleanerId = cleaner.id;
  req.session.cleanerName = cleaner.name;
  req.session.cleanerPhone = cleaner.phone;
  req.session.save(() => {
    res.json({ id: cleaner.id, name: cleaner.name, phone: cleaner.phone, role: 'cleaner', authType: 'pin' });
  });
});

// Google SSO
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=google_failed' }),
  (req, res) => res.redirect(req.user.role === 'cleaner' ? '/cleaner-portal.html' : '/')
);

// Logout
router.post('/logout', (req, res) => {
  if (req.session && req.session.cleanerId) {
    // PIN-auth cleaner — just destroy session
    return req.session.destroy(() => res.json({ ok: true }));
  }
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

// Current user
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      avatar_url: req.user.avatar_url
    });
  }
  // Fallback: cleaner PIN session
  if (req.session && req.session.cleanerId) {
    return res.json({
      id: req.session.cleanerId,
      name: req.session.cleanerName,
      phone: req.session.cleanerPhone,
      role: 'cleaner',
      authType: 'pin'
    });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

module.exports = router;
