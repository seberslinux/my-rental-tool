/**
 * What the dashboard asks about the state of the listings.
 *
 * Two endpoints and no judgement: everything that decides what is wrong
 * lives in `services/health-check`, so the cron and the Check-now button
 * cannot drift apart in what they consider healthy.
 */

const express = require('express');
const router = express.Router();
const { scopeProperties } = require('../middleware/auth');
const { runHealthCheck, latestHealth } = require('../services/health-check');

/**
 * This morning's answer, for the listings this account may see.
 *
 * Reads the stored row. A property that has never been checked is
 * absent rather than reported as healthy — the card says "not checked
 * yet", which is the truth and is actionable, where a green tick would
 * be neither.
 */
router.get('/channels', scopeProperties, async (req, res) => {
  try {
    res.json(await latestHealth(req.accessiblePropertyIds));
  } catch (err) {
    console.error(`Health check read failed: ${err.message}`);
    res.status(500).json({ error: 'Could not read the last check' });
  }
});

/**
 * Run it now.
 *
 * Two Smoobu GETs and a handful of queries, so it is a button somebody
 * presses rather than something a page load triggers. It checks every
 * property and stores every answer — the scoping is applied on the way
 * out, by the read above, because a check that covered only the
 * properties of whoever happened to press it would leave the others
 * showing yesterday.
 *
 * Silent: no WhatsApp. Somebody watching the screen does not need to be
 * told by phone what is in front of them, and a button that alerts is a
 * button that can be used to alert.
 */
router.post('/channels/run', scopeProperties, async (req, res) => {
  try {
    await runHealthCheck({ announce: false });
    res.json(await latestHealth(req.accessiblePropertyIds));
  } catch (err) {
    console.error(`Health check failed: ${err.message}`);
    res.status(502).json({ error: `Could not check: ${err.message}` });
  }
});

module.exports = router;
