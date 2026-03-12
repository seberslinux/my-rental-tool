require('dotenv').config();
const express = require('express');
const path = require('path');
const { runMigrations } = require('./src/db/migrations');
const { closeDb } = require('./src/db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Run database migrations on startup
runMigrations();

// Routes
app.use('/api', require('./src/routes/api'));
app.use('/api/properties', require('./src/routes/properties'));
app.use('/api/cleaners', require('./src/routes/cleaners'));
app.use('/api/pricing', require('./src/routes/pricing'));
app.use('/api/analytics', require('./src/routes/analytics'));
app.use('/api/finances', require('./src/routes/finances'));
app.use('/api/maintenance', require('./src/routes/maintenance'));
app.use('/webhook', require('./src/routes/webhook'));

// Cron jobs
require('./src/cron/jobs');

// Graceful shutdown
process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Rental management tool running on http://localhost:${PORT}`);
});

module.exports = app;
