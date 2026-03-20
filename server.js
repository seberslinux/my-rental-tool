require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');
const { runMigrations } = require('./src/db/migrations');
const { closeDb, pool } = require('./src/db/database');
const passport = require('./src/auth/passport-setup');
const { requireAuth } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Serve React build if it exists, otherwise fall back to public/
const clientDist = path.join(__dirname, 'client', 'dist');
const fs = require('fs');
const hasClientBuild = fs.existsSync(clientDist);
if (hasClientBuild) {
  app.use(express.static(clientDist));
} else {
  app.use(express.static(path.join(__dirname, 'public')));
}

async function start() {
  // Run database migrations on startup
  await runMigrations();

  // Session & Passport
  app.use(session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Public routes (no auth required)
  app.use('/api/auth', require('./src/routes/auth'));
  app.use('/webhook', require('./src/routes/webhook'));
  app.use('/ical', require('./src/routes/ical'));

  // Auth wall — all /api routes below require login
  app.use('/api', requireAuth);

  // Protected routes
  app.use('/api', require('./src/routes/api'));
  app.use('/api/properties', require('./src/routes/properties'));
  app.use('/api/cleaners', require('./src/routes/cleaners'));
  app.use('/api/pricing', require('./src/routes/pricing'));
  app.use('/api/analytics', require('./src/routes/analytics'));
  app.use('/api/finances', require('./src/routes/finances'));
  app.use('/api/maintenance', require('./src/routes/maintenance'));
  app.use('/api/users', require('./src/routes/users'));
  app.use('/api/cleaner-portal', require('./src/routes/cleaner-portal'));
  app.use('/api/inventory', require('./src/routes/inventory'));
  app.use('/api/settings', require('./src/routes/settings'));

  // SPA fallback — serve index.html for all non-API routes (React router)
  if (hasClientBuild) {
    app.get('{*splat}', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Cron jobs
  require('./src/cron/jobs');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await closeDb();
    process.exit(0);
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rental management tool running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
