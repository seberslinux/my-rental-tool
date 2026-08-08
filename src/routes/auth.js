const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const passport = require('../auth/passport-setup');
const { getOne, getAll, run } = require('../db/database');
// Two numbers are the same line however they were typed — see the module
// header for why an exact string match locked cleaners out.
const { samePhone } = require('../services/phone');

/**
 * Start a cleaner session, and only a cleaner session.
 *
 * Every way into the cleaner's app goes through here — PIN, invitation,
 * and the magic link in a WhatsApp message — because the rule only holds
 * if it holds on all of them. The magic link is the one that matters
 * most: it is tapped on a phone, by somebody who may well be signed into
 * the main app in the same browser.
 *
 * Regenerating first drops everything the old session held, Passport's
 * entry included. What comes out is a cleaner and nothing else, so there
 * is no manager identity left to fall back to. Getting into the main app
 * means going back to the login screen.
 *
 * It also gives each sign-in a fresh session id, which is the standard
 * defence against a fixed one being planted beforehand.
 */
async function signInAsCleaner(req, res, cleaner, authType) {
  try {
    await new Promise((resolve, reject) =>
    req.session.regenerate((err) => err ? reject(err) : resolve())
    );
  } catch (err) {
    console.error(`cleaner sign-in (${authType}): could not regenerate the session — ${err.message}`);
    return res.status(500).json({ error: 'Could not sign you in. Try again.' });
  }

  req.session.cleanerId = cleaner.id;
  req.session.cleanerName = cleaner.name;
  req.session.cleanerPhone = cleaner.phone;
  req.session.save(() => {
    res.json({ id: cleaner.id, name: cleaner.name, phone: cleaner.phone, role: 'cleaner', authType });
  });
}

/**
 * The reverse: signing into the main app ends any cleaner session.
 *
 * Passport 0.7 regenerates the session inside req.logIn, which would
 * clear these anyway. Stating it here does not depend on that staying
 * true — the separation is a rule of this app, not a side effect of a
 * library default that a future upgrade could reasonably change.
 */
function clearCleanerSession(req) {
  delete req.session.cleanerId;
  delete req.session.cleanerName;
  delete req.session.cleanerPhone;
}

// Email/password login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    req.logIn(user, (err) => {
      if (err) return next(err);
      clearCleanerSession(req);
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

  return signInAsCleaner(req, res, cleaner, 'pin');
});

/**
 * Look at an invitation without spending it.
 *
 * Lets the page greet the cleaner by name before they choose a PIN, so
 * they can tell a link meant for them from one sent to the wrong number.
 * Deliberately does not return the phone number: the link may have been
 * forwarded, and a stranger holding it should learn nothing.
 *
 * Invalid, expired and already-used give one answer. Telling them apart
 * would confirm to someone probing tokens which ones once existed.
 */
router.get('/invite/:token', async (req, res) => {
  const invite = await getOne(
    `SELECT c.name FROM cleaner_invites i
       JOIN cleaners c ON c.id = i.cleaner_id
      WHERE i.token = $1 AND i.used_at IS NULL AND i.expires_at > NOW()`,
    [req.params.token]
  );
  if (!invite) return res.status(404).json({ error: 'This invitation is no longer valid' });
  res.json({ name: invite.name });
});

/**
 * Spend the invitation: the cleaner sets their own PIN and is signed in.
 *
 * The invite is claimed with a conditional UPDATE rather than a read
 * followed by a write. Two taps on the same link — a double submit, or a
 * forwarded copy opened at the same moment — would otherwise both pass
 * the check and both set a PIN. Here one claim wins, and the second
 * updates no rows and is refused.
 */
router.post('/invite/:token', async (req, res) => {
  const { pin } = req.body;
  if (!/^\d{4}$/.test(String(pin || ''))) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  }

  const claimed = await getOne(
    `UPDATE cleaner_invites SET used_at = NOW()
      WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING cleaner_id`,
    [req.params.token]
  );
  if (!claimed) return res.status(404).json({ error: 'This invitation is no longer valid' });

  const cleaner = await getOne('SELECT * FROM cleaners WHERE id = $1', [claimed.cleaner_id]);
  if (!cleaner) return res.status(404).json({ error: 'This invitation is no longer valid' });

  await run('UPDATE cleaners SET pin = $1 WHERE id = $2', [bcrypt.hashSync(pin, 10), cleaner.id]);

  return signInAsCleaner(req, res, cleaner, 'invite');
});

// Magic-link token login (for WhatsApp links)
router.post('/cleaner-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const row = await getOne('SELECT * FROM ical_tokens WHERE token = $1', [token]);
  if (!row) return res.status(401).json({ error: 'Invalid or expired token' });

  const cleaner = await getOne('SELECT * FROM cleaners WHERE id = $1', [row.cleaner_id]);
  if (!cleaner) return res.status(401).json({ error: 'Cleaner not found' });

  return signInAsCleaner(req, res, cleaner, 'token');
});

// Google SSO
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google_failed' }),
  (req, res) => {
    clearCleanerSession(req);
    res.redirect(req.user.role === 'cleaner' ? '/cleaner-portal' : '/');
  }
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
  // The cleaner is checked first, not as a fallback.
  //
  // This is what the browser uses to decide which app to render, and it
  // used to prefer the Passport user: a session holding both answered
  // "admin", so signing in with a PIN put the manager's app on screen.
  // Sessions are exclusive now, but the order still matters — if the two
  // ever coexist again, the answer should be the smaller of the two.
  if (req.session && req.session.cleanerId) {
    return res.json({
      id: req.session.cleanerId,
      name: req.session.cleanerName,
      phone: req.session.cleanerPhone,
      role: 'cleaner',
      authType: 'pin'
    });
  }
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
  res.status(401).json({ error: 'Not authenticated' });
});

module.exports = router;
