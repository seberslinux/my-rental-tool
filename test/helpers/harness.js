/**
 * Integration-test harness. Provides:
 *
 *   - `getApp()` — a cached Express app instance built with the test session
 *     secret. First call runs migrations against TEST_DATABASE_URL.
 *   - `getAgent()` — a supertest agent that shares a cookie jar across calls
 *     so login-then-request flows work.
 *   - `resetDb()` — truncates all data tables; call before each test.
 *   - `closePool()` — close the DB pool at the end of the run.
 *
 * Environment: TEST_DATABASE_URL must point at a Postgres the tests can
 * write to and wipe. Defaults to the docker-compose.test.yml container
 * (see that file for the exact URL). Setting DATABASE_URL to the same value
 * happens automatically before src/db/database.js is imported, so
 * production code paths connect to the test DB without knowing they're
 * being tested.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5433/rental_test';

// These must be set BEFORE requiring anything that touches the DB or app.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-not-for-prod';
// Silence Passport when no Google OAuth env vars are present.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret';

const request = require('supertest');
const { pool } = require('../../src/db/database');
const { runMigrations } = require('../../src/db/migrations');
const { buildApp } = require('../../src/app');

let cachedApp = null;

async function getApp() {
  if (cachedApp) return cachedApp;
  await runMigrations();
  cachedApp = buildApp({ sessionSecret: process.env.SESSION_SECRET });
  return cachedApp;
}

async function getAgent() {
  const app = await getApp();
  return request.agent(app);
}

/**
 * TRUNCATE every table in the public schema. Discovers the tables at call
 * time so the harness doesn't need updating as the schema evolves.
 * CASCADE handles foreign keys; RESTART IDENTITY resets sequence values so
 * IDs are stable across tests.
 */
async function resetDb() {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  if (rows.length === 0) return;
  const tableList = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

async function closePool() {
  await pool.end();
}

module.exports = {
  getApp,
  getAgent,
  resetDb,
  closePool,
  TEST_DATABASE_URL,
};
