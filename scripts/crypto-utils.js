const crypto = require('crypto');

const SALT = Buffer.from('ig-dashboard-v1-salt', 'utf8');
const ITER = 100000;

function deriveKey(passphrase) {
  return crypto.pbkdf2Sync(passphrase, SALT, ITER, 32, 'sha256');
}

function encrypt(passphrase, obj) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, tag]);
  return combined.toString('base64');
}

function decrypt(passphrase, b64) {
  const key = deriveKey(passphrase);
  const combined = Buffer.from(b64, 'base64');
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const encrypted = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { encrypt, decrypt, deriveKey, SALT, ITER };
