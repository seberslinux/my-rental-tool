/**
 * The page Claude sends you to: sign in with your app account (if you
 * are not already) and allow or refuse. Signed in already in this browser,
 * it is one button.
 */

const crypto = require('crypto');
const express = require('express');
const passport = require('passport');
const { page, esc } = require('../routes/pay');
const { pendingRequest, approve, deny, ROLES } = require('./oauth');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

const FORM_CSS = '<style>label{display:block;margin-top:12px;font-size:14px;color:var(--muted)} input{display:block;width:100%;height:44px;margin-top:4px;padding:0 12px;border:1px solid var(--line);border-radius:8px;font-size:16px;color:var(--ink)}</style>';
const card = (title, html) => page(title, `${FORM_CSS}<div class="card">${html}</div>`);
const roleName = { admin: 'admin', property_manager: 'property manager' };
const hostOf = (uri) => { try { return new URL(uri).host; } catch { return ''; } };

function show(req, res, { error } = {}) {
  const id = String(req.query.request || req.body?.request || '');
  const r = pendingRequest(id);
  if (!r) {
    return res.status(400).send(card('Sign-in expired', `<h1>This sign-in has expired</h1><p class="muted">Go back to Claude and connect again.</p>`));
  }
  const who = r.client.client_name || 'Claude';
  const to = hostOf(r.params.redirectUri);
  const note = error ? `<p style="color:var(--warn)">${esc(error)}</p>` : '';

  if (req.user && ROLES.includes(req.user.role)) {
    req.session.mcpCsrf = crypto.randomBytes(18).toString('base64url');
    return res.send(card('Allow Claude', `
      <h1>Allow ${esc(who)}?</h1>
      <p class="muted">${esc(who)} (returning to ${esc(to)}) will be able to use My Rental Tool as
        <b>${esc(req.user.name || req.user.email)}</b> (${esc(roleName[req.user.role])}): read bookings,
        revenue and competitor figures, create payment links and change rates in Smoobu,
        for the properties you have.</p>${note}
      <form method="post" action="/oauth/consent">
        <input type="hidden" name="request" value="${esc(id)}">
        <input type="hidden" name="csrf" value="${esc(req.session.mcpCsrf)}">
        <button name="decision" value="allow">Allow</button>
        <button name="decision" value="deny" style="background:#fff;color:var(--ink);border:1px solid var(--line);margin-top:8px">Refuse</button>
      </form>`));
  }

  const google = `/api/auth/google?next=${encodeURIComponent(`/oauth/consent?request=${id}`)}`;
  res.send(card('Sign in', `
    <h1>Sign in to connect ${esc(who)}</h1>
    <p class="muted">Use your My Rental Tool account.</p>${note}
    <form method="post" action="/oauth/consent/login">
      <input type="hidden" name="request" value="${esc(id)}">
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button>Sign in</button>
    </form>
    <p style="text-align:center;margin-top:16px"><a href="${esc(google)}">Sign in with Google</a></p>`));
}

router.get('/consent', (req, res) => show(req, res));

router.post('/consent/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return show(req, res, { error: (info && info.message) || 'Invalid credentials' });
    if (!ROLES.includes(user.role)) return show(req, res, { error: 'This account cannot connect Claude' });
    req.logIn(user, { keepSessionInfo: true }, (e) => {
      if (e) return next(e);
      res.redirect(303, `/oauth/consent?request=${encodeURIComponent(req.body.request || '')}`);
    });
  })(req, res, next);
});

router.post('/consent', (req, res) => {
  const { request: id, csrf, decision } = req.body || {};
  const expected = req.session && req.session.mcpCsrf;
  if (!req.user || !ROLES.includes(req.user.role) || !expected || csrf !== expected) {
    return show(req, res, { error: 'Please sign in and try again' });
  }
  delete req.session.mcpCsrf;
  const to = decision === 'allow' ? approve(id, req.user) : deny(id);
  if (!to) return show(req, res);
  res.redirect(302, to);
});

module.exports = router;
