const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('../auth/passport-setup');
const { getOne, getAll } = require('../db/database');
// Two numbers are the same line however they were typed — see the module
// header for why an exact string match locked cleaners out.
const { samePhone } = require('../services/phone');

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

  // The number is matched on its digits, not as a string.
  //
  // This was `WHERE phone = $1`, an exact match, while the login field's
  // own placeholder reads "+27 82 123 4567" — spaces included. Typing
  // what the hint showed could never match a number stored as
  // "+27821234567", and the failure came back as "Invalid phone or PIN",
  // blaming the one thing the cleaner would then retype forever.
  //
  // The table holds one row per person, so scanning it and comparing
  // normalised forms costs nothing and keeps a single definition of what
  // makes two numbers equal.
  const candidates = await getAll('SELECT * FROM cleaners');
  const matches = candidates.filter((c) => samePhone(c.phone, phone));
  if (matches.length === 0) return res.status(401).json({ error: 'Invalid phone or PIN' });
  // Two rows normalising to one number is a data fault, not a login.
  // Taking the first would sign this person in as somebody else and show
  // them another cleaner's jobs, so refuse and say so plainly.
  if (matches.length > 1) {
    console.error(`Cleaner login: ${matches.length} cleaners share the number ${phone} (ids ${matches.map((c) => c.id).join(', ')})`);
    return res.status(409).json({ error: 'This number is on more than one cleaner profile. Contact your admin.' });
  }
  const cleaner = matches[0];
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

// Magic-link token login (for WhatsApp links)
router.post('/cleaner-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const row = await getOne('SELECT * FROM ical_tokens WHERE token = $1', [token]);
  if (!row) return res.status(401).json({ error: 'Invalid or expired token' });

  const cleaner = await getOne('SELECT * FROM cleaners WHERE id = $1', [row.cleaner_id]);
  if (!cleaner) return res.status(401).json({ error: 'Cleaner not found' });

  req.session.cleanerId = cleaner.id;
  req.session.cleanerName = cleaner.name;
  req.session.cleanerPhone = cleaner.phone;
  req.session.save(() => {
    res.json({ id: cleaner.id, name: cleaner.name, phone: cleaner.phone, role: 'cleaner', authType: 'token' });
  });
});

// Google SSO
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => res.redirect(req.user.role === 'cleaner' ? '/cleaner-portal' : '/')
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
      avatar_url: req.user.avatar_url,
      has_smoobu_key: !!(req.user.smoobu_api_key_encrypted && req.user.smoobu_api_key_iv),
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
