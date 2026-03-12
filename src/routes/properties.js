const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// Get all properties
router.get('/', (req, res) => {
  const db = getDb();
  const properties = db.prepare('SELECT * FROM properties ORDER BY name ASC').all();
  res.json(properties);
});

// Get a single property
router.get('/:id', (req, res) => {
  const db = getDb();
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  res.json(property);
});

// Update property settings
router.put('/:id', (req, res) => {
  const db = getDb();
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const fields = ['address','cleaning_hours_required','base_price','airbnb_url','airbnb_id','booking_url','booking_id_ext','vrbo_url','vrbo_id','commission_airbnb','commission_booking','commission_vrbo','property_type','bedrooms','bathrooms','max_guests','location','neighbourhood'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
