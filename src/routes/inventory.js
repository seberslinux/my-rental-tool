const express = require('express');
const router = express.Router();
const { getAll, getOne, run } = require('../db/database');
const { requireRole, scopeProperties, denyIfOutOfScope } = require('../middleware/auth');

// Apply property scoping to all inventory routes
router.use(scopeProperties);

router.get('/:propertyId', async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.propertyId)) return;
  const items = await getAll(
    'SELECT * FROM inventory_checklists WHERE property_id = $1 ORDER BY category, sort_order, item_name',
    [req.params.propertyId]
  );
  res.json(items);
});

router.post('/:propertyId', requireRole('admin', 'property_manager'), async (req, res) => {
  if (denyIfOutOfScope(req, res, req.params.propertyId)) return;
  const { item_name, category, expected_quantity, sort_order } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name required' });
  const result = await run(
    'INSERT INTO inventory_checklists (property_id, item_name, category, expected_quantity, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.params.propertyId, item_name, category || 'General', expected_quantity || 1, sort_order || 0]
  );
  res.status(201).json({ id: result.rows[0].id });
});

router.put('/items/:id', requireRole('admin', 'property_manager'), async (req, res) => {
  const existing = await getOne('SELECT property_id FROM inventory_checklists WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  if (denyIfOutOfScope(req, res, existing.property_id)) return;

  const { item_name, category, expected_quantity, sort_order } = req.body;
  await run(
    'UPDATE inventory_checklists SET item_name = $1, category = $2, expected_quantity = $3, sort_order = $4 WHERE id = $5',
    [item_name, category || 'General', expected_quantity || 1, sort_order || 0, req.params.id]
  );
  res.json({ updated: true });
});

router.delete('/items/:id', requireRole('admin', 'property_manager'), async (req, res) => {
  const existing = await getOne('SELECT property_id FROM inventory_checklists WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  if (denyIfOutOfScope(req, res, existing.property_id)) return;

  await run('DELETE FROM inventory_checklists WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

module.exports = router;
