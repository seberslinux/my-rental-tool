const express = require('express');
const router = express.Router();
const { runPricingEngine } = require('../services/pricing');

// Manually trigger pricing engine
router.post('/run', async (req, res) => {
  try {
    await runPricingEngine();
    res.json({ success: true, message: 'Pricing engine completed' });
  } catch (err) {
    console.error('Pricing engine error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
