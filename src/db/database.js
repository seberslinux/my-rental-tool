const { Pool } = require('pg');

// Internal Railway connections (*.railway.internal) don't use SSL
// Public Railway connections (*.proxy.rlwy.net) require SSL
const dbUrl = process.env.DATABASE_URL || '';
const needsSsl = dbUrl.includes('proxy.rlwy.net') || (dbUrl.includes('railway') && !dbUrl.includes('.internal'));

const pool = new Pool({
  connectionString: dbUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return { rows: result.rows, rowCount: result.rowCount };
}

async function getOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function getAll(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function run(sql, params = []) {
  const result = await pool.query(sql, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function inParams(arr, startIdx) {
  return arr.map((_, i) => `$${startIdx + i}`).join(',');
}

async function closeDb() {
  await pool.end();
}

module.exports = { query, getOne, getAll, run, transaction, inParams, closeDb, pool };
