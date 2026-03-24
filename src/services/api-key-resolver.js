const { getOne } = require('../db/database');

let decrypt;
try {
  decrypt = require('./encryption').decrypt;
} catch (e) {
  decrypt = null;
}

/**
 * Get the Smoobu API key for a given property (via its owner).
 * Falls back to process.env.SMOOBU_API_KEY if no owner key is set.
 */
async function getApiKeyForProperty(propertyId) {
  try {
    const row = await getOne(
      `SELECT u.smoobu_api_key_encrypted, u.smoobu_api_key_iv
       FROM properties p JOIN users u ON p.owner_user_id = u.id
       WHERE p.id = $1`,
      [propertyId]
    );
    if (row && row.smoobu_api_key_encrypted && row.smoobu_api_key_iv && decrypt) {
      return decrypt(row.smoobu_api_key_encrypted, row.smoobu_api_key_iv);
    }
  } catch (e) {
    // Fall through to env var
  }
  return process.env.SMOOBU_API_KEY || null;
}

/**
 * Get the Smoobu API key for a given user.
 * Falls back to process.env.SMOOBU_API_KEY if the user has no key.
 */
async function getApiKeyForUser(userId) {
  try {
    const row = await getOne(
      'SELECT smoobu_api_key_encrypted, smoobu_api_key_iv FROM users WHERE id = $1',
      [userId]
    );
    if (row && row.smoobu_api_key_encrypted && row.smoobu_api_key_iv && decrypt) {
      return decrypt(row.smoobu_api_key_encrypted, row.smoobu_api_key_iv);
    }
  } catch (e) {
    // Fall through to env var
  }
  return process.env.SMOOBU_API_KEY || null;
}

module.exports = { getApiKeyForProperty, getApiKeyForUser };
