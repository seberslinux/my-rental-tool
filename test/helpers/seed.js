/**
 * Seed helpers for integration tests. Each helper inserts a minimal row
 * and returns it (with the generated id). Tests compose these into scenarios.
 *
 * Overrides via the `overrides` param customise any field; defaults are
 * chosen to satisfy NOT NULL constraints and to produce valid, realistic
 * data.
 */

const bcrypt = require('bcrypt');
const { pool } = require('../../src/db/database');

let counter = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${++counter}`;

async function seedUser(overrides = {}) {
  const password = overrides.password || 'test-password';
  const passwordHash = overrides.password_hash || await bcrypt.hash(password, 4);
  const row = {
    email: overrides.email || `${uniq('user')}@test.local`,
    name: overrides.name || 'Test User',
    role: overrides.role || 'property_manager',
    password_hash: passwordHash,
    ...overrides,
  };
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [row.email, row.name, row.role, row.password_hash]
  );
  return { ...rows[0], _plaintextPassword: password };
}

async function seedProperty({ owner, ...overrides } = {}) {
  const row = {
    smoobu_id: overrides.smoobu_id ?? Math.floor(Math.random() * 1e9),
    name: overrides.name || uniq('Property'),
    base_price: overrides.base_price ?? 1000,
    base_currency: overrides.base_currency || 'ZAR',
    bedrooms: overrides.bedrooms ?? 2,
    bathrooms: overrides.bathrooms ?? 1,
    max_guests: overrides.max_guests ?? 4,
    owner_user_id: owner?.id ?? overrides.owner_user_id ?? null,
    ...overrides,
  };
  const { rows } = await pool.query(
    `INSERT INTO properties (smoobu_id, name, owner_user_id, base_price, base_currency, bedrooms, bathrooms, max_guests)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [row.smoobu_id, row.name, row.owner_user_id, row.base_price, row.base_currency, row.bedrooms, row.bathrooms, row.max_guests]
  );
  const property = rows[0];
  if (owner) {
    await pool.query(
      `INSERT INTO user_properties (user_id, property_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [owner.id, property.id]
    );
  }
  return property;
}

async function seedBooking({ property, ...overrides } = {}) {
  if (!property && overrides.property_id === undefined) {
    throw new Error('seedBooking requires either `property` or `property_id`');
  }
  const propertyId = property?.id ?? overrides.property_id;
  const checkIn = overrides.check_in || '2025-06-10';
  const checkOut = overrides.check_out || '2025-06-13';
  const los = Math.max(
    1,
    Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (24 * 60 * 60 * 1000)
    )
  );
  const totalPrice = overrides.total_price ?? 3000;
  const row = {
    smoobu_id: overrides.smoobu_id ?? Math.floor(Math.random() * 1e9),
    property_id: propertyId,
    guest_name: overrides.guest_name || 'Test Guest',
    check_in: checkIn,
    check_out: checkOut,
    platform: overrides.platform || 'Airbnb',
    total_price: totalPrice,
    status: overrides.status || 'confirmed',
    num_guests: overrides.num_guests ?? 2,
    length_of_stay: overrides.length_of_stay ?? los,
    price_per_night: overrides.price_per_night ?? Math.round(totalPrice / los),
    currency: overrides.currency || 'ZAR',
    lead_time_days: overrides.lead_time_days ?? 30,
    ...overrides,
  };
  const { rows } = await pool.query(
    `INSERT INTO bookings
       (smoobu_id, property_id, guest_name, check_in, check_out, platform, total_price, status,
        num_guests, length_of_stay, price_per_night, currency, lead_time_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [row.smoobu_id, row.property_id, row.guest_name, row.check_in, row.check_out, row.platform,
      row.total_price, row.status, row.num_guests, row.length_of_stay, row.price_per_night,
      row.currency, row.lead_time_days]
  );
  return rows[0];
}

/**
 * Log a seeded user in via the local strategy and return the supertest agent
 * with the session cookie set. Uses the _plaintextPassword captured by
 * seedUser().
 */
async function loginAs(agent, user) {
  const password = user._plaintextPassword;
  if (!password) {
    throw new Error('loginAs requires a user seeded via seedUser() (needs _plaintextPassword)');
  }
  const res = await agent
    .post('/api/auth/login')
    .send({ email: user.email, password })
    .expect(200);
  return res;
}

module.exports = {
  seedUser,
  seedProperty,
  seedBooking,
  loginAs,
};
