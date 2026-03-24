const express = require('express');
const router = express.Router();
const { getAll, getOne, run } = require('../db/database');
const { encrypt, decrypt } = require('../services/encryption');
const smoobu = require('../services/smoobu');

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

// --- Smoobu API Key Management ---

// GET /api/settings/smoobu-key — check connection status
router.get('/smoobu-key', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const user = await getOne(
      'SELECT smoobu_api_key_encrypted, smoobu_api_key_iv FROM users WHERE id = $1',
      [req.user.id]
    );
    const connected = !!(user && user.smoobu_api_key_encrypted && user.smoobu_api_key_iv);
    res.json({ connected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/smoobu-key — connect Smoobu API key (validates first)
router.put('/smoobu-key', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { api_key } = req.body;
    if (!api_key || typeof api_key !== 'string' || api_key.trim().length < 10) {
      return res.status(400).json({ error: 'Invalid API key' });
    }

    // Test the key by fetching properties
    let properties;
    try {
      properties = await smoobu.getProperties(api_key.trim());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid API key — could not connect to Smoobu' });
    }

    // Encrypt and store
    const { encrypted, iv } = encrypt(api_key.trim());
    await run(
      'UPDATE users SET smoobu_api_key_encrypted = $1, smoobu_api_key_iv = $2 WHERE id = $3',
      [encrypted, iv, req.user.id]
    );

    res.json({ connected: true, properties_found: properties.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/smoobu-key — disconnect Smoobu API key
router.delete('/smoobu-key', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    // Check if user owns any properties
    const owned = await getAll(
      'SELECT id FROM properties WHERE owner_user_id = $1',
      [req.user.id]
    );
    if (owned.length > 0) {
      return res.status(400).json({
        error: `Cannot disconnect — you own ${owned.length} properties. Transfer ownership first.`,
      });
    }

    await run(
      "UPDATE users SET smoobu_api_key_encrypted = '', smoobu_api_key_iv = '' WHERE id = $1",
      [req.user.id]
    );
    res.json({ connected: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/smoobu-key/test — test connection without saving
router.post('/smoobu-key/test', async (req, res) => {
  try {
    const { api_key } = req.body;
    if (!api_key) return res.status(400).json({ error: 'API key required' });
    const properties = await smoobu.getProperties(api_key.trim());
    res.json({ success: true, properties_found: properties.length, properties: properties.map(p => ({ id: p.id, name: p.name })) });
  } catch (e) {
    res.status(400).json({ success: false, error: 'Could not connect to Smoobu' });
  }
});

module.exports = router;
