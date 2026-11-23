/**
 * The owner's side of direct bookings: quote a stay, make a payment link,
 * see where each link stands, cancel one, retry a booking that did not go
 * through. Admins and property managers, for the properties they manage.
 */

const express = require('express');
const { requireRole, scopeProperties, isPropertyInScope } = require('../middleware/auth');
const links = require('../services/payment-links');
const accounts = require('../services/payment-accounts');
const site = require('../services/website-booking');

const router = express.Router();
router.use(requireRole('admin', 'property_manager'), scopeProperties);

const send = (res, err) => {
  if (!err.status || err.status >= 500) console.error('payment-links:', err.message);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : (err.message || 'Something went wrong') });
};
const inScope = (req, propertyId) => isPropertyInScope(req, Number(propertyId));

router.get('/', async (req, res) => {
  try {
    res.json({
      links: await links.listLinks(req.accessiblePropertyIds),
      accounts: await accounts.accounts(req.accessiblePropertyIds),
      website: await Promise.all((await accounts.accounts(req.accessiblePropertyIds)).map((a) => site.settings(a.property_id))),
      default_discount: links.DEFAULT_DISCOUNT,
    });
  } catch (err) { send(res, err); }
});

router.post('/quote', async (req, res) => {
  const { property_id, check_in, check_out, discount_percent } = req.body || {};
  if (!inScope(req, property_id)) return res.status(403).json({ error: 'Not your property' });
  try {
    res.json(await links.quote({ propertyId: Number(property_id), checkIn: check_in, checkOut: check_out, discountPercent: discount_percent ?? links.DEFAULT_DISCOUNT }));
  } catch (err) { send(res, err); }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!inScope(req, b.property_id)) return res.status(403).json({ error: 'Not your property' });
  try {
    const link = await links.createLink({
      propertyId: Number(b.property_id), checkIn: b.check_in, checkOut: b.check_out,
      adults: b.adults ?? 2, children: b.children ?? 0,
      firstName: b.first_name, lastName: b.last_name, email: b.email, phone: b.phone,
      amount: b.amount, note: b.note, hours: b.hours, createdBy: req.user.id,
    });
    res.status(201).json(link);
  } catch (err) { send(res, err); }
});

async function owned(req, res) {
  const link = await links.byId(Number(req.params.id));
  if (!link || !inScope(req, link.property_id)) { res.status(404).json({ error: 'Link not found' }); return null; }
  return link;
}

router.post('/:id/cancel', async (req, res) => {
  try {
    if (!(await owned(req, res))) return;
    res.json(await links.cancelLink(Number(req.params.id)));
  } catch (err) { send(res, err); }
});

router.post('/:id/retry', async (req, res) => {
  try {
    if (!(await owned(req, res))) return;
    res.json(await links.retryBooking(Number(req.params.id)));
  } catch (err) { send(res, err); }
});

// Which Paystack account a property is paid into. Admins only: it decides
// whose bank account the money reaches.
router.put('/accounts/:propertyId', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.propertyId);
  if (!inScope(req, id)) return res.status(404).json({ error: 'Property not found' });
  try {
    await accounts.connect(id, { secretKey: (req.body || {}).secret_key, accountName: (req.body || {}).account_name });
    res.json({ accounts: await accounts.accounts(req.accessiblePropertyIds) });
  } catch (err) { send(res, err); }
});

router.delete('/accounts/:propertyId', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.propertyId);
  if (!inScope(req, id)) return res.status(404).json({ error: 'Property not found' });
  try {
    await accounts.disconnect(id);
    res.json({ accounts: await accounts.accounts(req.accessiblePropertyIds) });
  } catch (err) { send(res, err); }
});

// Whether a property takes bookings on the website, at which address, and
// on which terms. Admins only, like the account it is paid into.
router.put('/website/:propertyId', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.propertyId);
  if (!inScope(req, id)) return res.status(404).json({ error: 'Property not found' });
  try {
    const b = req.body || {};
    res.json(await site.saveSettings(id, { enabled: Boolean(b.enabled), slug: b.slug, terms: b.terms }));
  } catch (err) { send(res, err); }
});

module.exports = router;
