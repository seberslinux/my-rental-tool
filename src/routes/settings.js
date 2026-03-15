const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

const SUPPORTED_CURRENCIES = ['ZAR', 'EUR', 'USD', 'GBP'];

// GET /api/settings — return all app settings as { key: value }
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    // Always include supported currencies list for the frontend
    settings._supported_currencies = SUPPORTED_CURRENCIES;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — upsert settings
router.put('/', (req, res) => {
  try {
    const db = getDb();
    const { display_currency } = req.body;

    if (display_currency !== undefined) {
      if (!SUPPORTED_CURRENCIES.includes(display_currency)) {
        return res.status(400).json({ error: `Unsupported currency. Use one of: ${SUPPORTED_CURRENCIES.join(', ')}` });
      }
      db.prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('display_currency', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      ).run(display_currency);
    }

    // Return updated settings
    const rows = db.prepare('SELECT key, value FROM app_settings').all();
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    settings._supported_currencies = SUPPORTED_CURRENCIES;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
