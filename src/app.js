/**
 * Builds and returns a configured Express app, without calling `.listen()`.
 *
 * Extracted from server.js so integration tests can supertest the app
 * directly. server.js still owns process boot: it calls `runMigrations()`,
 * builds the app, listens on a port, and handles graceful shutdown.
 *
 * Behaviour must stay identical between the two entry points.
 */

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { pool } = require('./db/database');
const passport = require('./auth/passport-setup');
const { requireAuth, restrictCleanerSessions } = require('./middleware/auth');

/**
 * Build the app synchronously. Callers are responsible for running migrations
 * before serving traffic — see server.js and test/helpers/harness.js.
 *
 * Options:
 *   - `sessionSecret`: overrides process.env.SESSION_SECRET; tests pass a
 *     fixed value so the env-var contract doesn't leak into fixtures.
 *   - `disableRateLimits`: when true, replaces the rate-limit middleware
 *     with a no-op. Tests need this because a single test file can easily
 *     make more than 20 login attempts, tripping the production limiter.
 *     Rate-limit behaviour is exercised by a dedicated test elsewhere.
 */
function buildApp({
  sessionSecret = process.env.SESSION_SECRET,
  disableRateLimits = false,
} = {}) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET must be set — refusing to build app with an insecure default');
  }

  const app = express();

  // Railway sits in front of us behind a proxy — trust it so req.secure and
  // secure cookies work correctly.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '10mb' }));

  const noopLimiter = (req, res, next) => next();

  // Rate limiting: auth endpoints (brute-force protection).
  const authLimiter = disableRateLimits ? noopLimiter : rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
  });

  // Rate limiting: public webhook + ical endpoints.
  const publicLimiter = disableRateLimits ? noopLimiter : rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Static assets — React build if present, else public/ fallback.
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const hasClientBuild = fs.existsSync(clientDist);
  if (hasClientBuild) {
    app.use(express.static(clientDist));
  } else {
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  // Session + Passport.
  app.use(session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
    },
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Public routes (no auth required).
  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/webhook', publicLimiter, require('./routes/webhook'));
  app.use('/ical', publicLimiter, require('./routes/ical'));

  // Auth wall — everything under /api requires an authenticated session.
  app.use('/api', requireAuth);
  // …and a cleaner session gets no further than the cleaner portal. See
  // the middleware for what was reachable before this existed.
  app.use('/api', restrictCleanerSessions);

  app.use('/api', require('./routes/api'));
  app.use('/api/properties', require('./routes/properties'));
  app.use('/api/cleaners', require('./routes/cleaners'));
  app.use('/api/pricing', require('./routes/pricing'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/finances', require('./routes/finances'));
  app.use('/api/maintenance', require('./routes/maintenance'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/cleaner-portal', require('./routes/cleaner-portal'));
  app.use('/api/inventory', require('./routes/inventory'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api/admin', require('./routes/admin'));

  // SPA fallback — non-API GETs return index.html so React Router owns them.
  if (hasClientBuild) {
    app.get('{*splat}', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

module.exports = { buildApp };
