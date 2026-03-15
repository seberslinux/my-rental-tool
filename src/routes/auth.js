const express = require('express');
const router = express.Router();
const passport = require('../auth/passport-setup');

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

// Google SSO
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=google_failed' }),
  (req, res) => res.redirect(req.user.role === 'cleaner' ? '/cleaner-portal.html' : '/')
);

// Logout
router.post('/logout', (req, res) => {
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
  res.status(401).json({ error: 'Not authenticated' });
});

module.exports = router;
