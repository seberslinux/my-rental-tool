/**
 * Subscribing a device to push.
 *
 * Both audiences use these: a signed-in owner (req.user) and a signed-in
 * cleaner (req.cleaner). Whichever it is, the subscription is stored
 * against that identity, so a shared phone that switches accounts does
 * not keep notifying the previous one.
 */

const express = require('express');
const { run, getOne } = require('../db/database');
const push = require('../services/push');

const router = express.Router();

/**
 * The public key, served rather than baked into the bundle.
 *
 * Compiled in, rotating the pair would mean a rebuild and a redeploy.
 * Served, it is a variable change and a restart.
 */
router.get('/key', (req, res) => {
  res.json({ key: push.publicKey(), configured: push.isConfigured() });
});

function whoAmI(req) {
  if (req.user) return { userId: req.user.id, cleanerId: null };
  if (req.cleaner) return { userId: null, cleanerId: req.cleaner.id };
  return null;
}

router.post('/subscribe', async (req, res) => {
  const me = whoAmI(req);
  if (!me) return res.status(401).json({ error: 'Sign in first' });

  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'That is not a push subscription' });
  }

  // The same device re-subscribing must land on its existing row. It can
  // also have changed hands, so the owner is overwritten rather than kept.
  await run(
    `INSERT INTO push_subscriptions (user_id, cleaner_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       cleaner_id = EXCLUDED.cleaner_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent`,
    [me.userId, me.cleanerId, endpoint, keys.p256dh, keys.auth,
    (req.get('user-agent') || '').slice(0, 300)]
  );

  res.json({ ok: true });
});

router.delete('/subscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Which subscription?' });
  await run('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  res.json({ ok: true });
});

/** Prove it reaches this device, which is the only way to be sure. */
router.post('/test', async (req, res) => {
  const me = whoAmI(req);
  if (!me) return res.status(401).json({ error: 'Sign in first' });
  if (!push.isConfigured()) {
    return res.status(400).json({ error: 'Push is not configured on the server' });
  }
  const result = await push.sendTo(me, {
    title: 'Notifications are on',
    body: 'This is what a job alert will look like.',
    link: '/',
  });
  res.json(result);
});

module.exports = router;
