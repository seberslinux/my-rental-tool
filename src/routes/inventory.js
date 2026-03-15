const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireRole } = require('../middleware/auth');

router.get('/:propertyId', (req, res) => {
  const db = getDb();
  const items = db.prepare(
    'SELECT * FROM inventory_checklists WHERE property_id = ? ORDER BY category, sort_order, item_name'
  ).all(req.params.propertyId);
  res.json(items);
});

router.post('/:propertyId', requireRole('admin', 'property_manager'), (req, res) => {
  const db = getDb();
  const { item_name, category, expected_quantity, sort_order } = req.body;
  if (!item_name) return res.status(400).json({ error: 'item_name required' });
  const result = db.prepare(
    'INSERT INTO inventory_checklists (property_id, item_name, category, expected_quantity, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.propertyId, item_name, category || 'General', expected_quantity || 1, sort_order || 0);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/items/:id', requireRole('admin', 'property_manager'), (req, res) => {
  const db = getDb();
  const { item_name, category, expected_quantity, sort_order } = req.body;
  db.prepare(
    'UPDATE inventory_checklists SET item_name = ?, category = ?, expected_quantity = ?, sort_order = ? WHERE id = ?'
  ).run(item_name, category || 'General', expected_quantity || 1, sort_order || 0, req.params.id);
  res.json({ updated: true });
});

router.delete('/items/:id', requireRole('admin', 'property_manager'), (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM inventory_checklists WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
