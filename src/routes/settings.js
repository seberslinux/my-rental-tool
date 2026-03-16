const express = require('express');
const router = express.Router();
const { getAll, run } = require('../db/database');

const SUPPORTED_CURRENCIES = ['ZAR', 'EUR', 'USD', 'GBP'];

// GET /api/settings — return all app settings as { key: value }
router.get('/', async (req, res) => {
  try {
    const rows = await getAll('SELECT key, value FROM app_settings');
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
router.put('/', async (req, res) => {
  try {
    const { display_currency } = req.body;

    if (display_currency !== undefined) {
      if (!SUPPORTED_CURRENCIES.includes(display_currency)) {
        return res.status(400).json({ error: `Unsupported currency. Use one of: ${SUPPORTED_CURRENCIES.join(', ')}` });
      }
      await run(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('display_currency', $1, NOW()) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
        [display_currency]
      );
    }

    // Return updated settings
    const rows = await getAll('SELECT key, value FROM app_settings');
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    settings._supported_currencies = SUPPORTED_CURRENCIES;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
