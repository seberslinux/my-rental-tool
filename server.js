require('dotenv').config();

const { runMigrations } = require('./src/db/migrations');
const { closeDb } = require('./src/db/database');
const { buildApp } = require('./src/app');

const PORT = process.env.PORT || 3000;

async function start() {
  await runMigrations();
  const app = buildApp();

  // Cron jobs — only in the long-running server, not when the app is
  // instantiated in tests.
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
