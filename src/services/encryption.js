const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  if (process.env.ENCRYPTION_KEY) {
    return Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  }

  if (process.env.SESSION_SECRET) {
    return crypto.scryptSync(process.env.SESSION_SECRET, 'smoobu-api-key-salt', 32);
  }

  throw new Error('ENCRYPTION_KEY or SESSION_SECRET must be set');
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: iv.toString('hex') };
}

function decrypt(encrypted, iv) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  let plaintext = decipher.update(encrypted, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

module.exports = { encrypt, decrypt };
