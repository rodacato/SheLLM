'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');

const KEY_PREFIX_LEN = 8;
let _hmacSecret = null;

function hashKeyLegacy(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function hashKey(rawKey, secret) {
  if (secret) {
    return createHmac('sha256', secret).update(rawKey).digest('hex');
  }
  return hashKeyLegacy(rawKey);
}

function getHmacSecret() {
  if (_hmacSecret) return _hmacSecret;
  if (process.env.SHELLM_HMAC_SECRET) {
    _hmacSecret = process.env.SHELLM_HMAC_SECRET;
    return _hmacSecret;
  }
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return null;
  const row = db.prepare("SELECT value FROM _config WHERE key = 'hmac_secret'").get();
  if (row) {
    _hmacSecret = row.value;
    return _hmacSecret;
  }
  // Auto-generate and persist
  const secret = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO _config (key, value) VALUES ('hmac_secret', ?)").run(secret);
  _hmacSecret = secret;
  return _hmacSecret;
}

function resetHmacCache() {
  _hmacSecret = null;
}

function generateKey() {
  return 'shellm-' + randomBytes(16).toString('hex');
}

// --- Client CRUD ---

function createClient({ name, rpm = 10, models = null, expires_at = null, description = null, safety_level = 'strict' }) {
  const { getDb } = require('./index');
  const db = getDb();
  const rawKey = generateKey();
  const secret = getHmacSecret();
  const key_hash = hashKey(rawKey, secret);
  const key_prefix = rawKey.slice(0, KEY_PREFIX_LEN);
  const modelsJson = models ? JSON.stringify(models) : null;

  const stmt = db.prepare(`
    INSERT INTO clients (name, key_hash, key_prefix, rpm, models, expires_at, description, safety_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, key_hash, key_prefix, rpm, modelsJson, expires_at, description, safety_level);

  const row = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, description, safety_level, created_at FROM clients WHERE id = ?').get(info.lastInsertRowid);
  return {
    ...row,
    models: row.models ? JSON.parse(row.models) : null,
    rawKey,
  };
}

function listClients() {
  const { getDb } = require('./index');
  const db = getDb();
  const rows = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, description, safety_level, created_at FROM clients ORDER BY id').all();
  return rows.map((r) => ({
    ...r,
    models: r.models ? JSON.parse(r.models) : null,
  }));
}

function updateClient(id, fields) {
  const { getDb } = require('./index');
  const db = getDb();
  const allowed = ['rpm', 'models', 'active', 'expires_at', 'description', 'safety_level'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      if (key === 'models') {
        sets.push('models = ?');
        values.push(fields.models ? JSON.stringify(fields.models) : null);
      } else {
        sets.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }
  }

  if (sets.length === 0) return null;

  values.push(id);
  db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  const row = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, description, safety_level, created_at FROM clients WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, models: row.models ? JSON.parse(row.models) : null };
}

function deleteClient(id) {
  const { getDb } = require('./index');
  const db = getDb();
  const info = db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return info.changes > 0;
}

function rotateClientKey(id) {
  const { getDb } = require('./index');
  const db = getDb();
  const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!existing) return null;

  const rawKey = generateKey();
  const secret = getHmacSecret();
  const key_hash = hashKey(rawKey, secret);
  const key_prefix = rawKey.slice(0, KEY_PREFIX_LEN);

  db.prepare('UPDATE clients SET key_hash = ?, key_prefix = ? WHERE id = ?').run(key_hash, key_prefix, id);

  return { rawKey, key_prefix };
}

function findClientByKey(rawKey) {
  const { getDb } = require('./index');
  const db = getDb();
  const secret = getHmacSecret();
  const hmacHash = hashKey(rawKey, secret);
  let row = db.prepare('SELECT id, name, rpm, models, active, expires_at, safety_level FROM clients WHERE key_hash = ?').get(hmacHash);

  if (!row) {
    // Legacy fallback: try plain SHA-256 and auto-upgrade
    const legacyHash = hashKeyLegacy(rawKey);
    row = db.prepare('SELECT id, name, rpm, models, active, expires_at, safety_level FROM clients WHERE key_hash = ?').get(legacyHash);
    if (row) {
      // Upgrade to HMAC hash on successful match
      db.prepare('UPDATE clients SET key_hash = ? WHERE id = ?').run(hmacHash, row.id);
    }
  }

  if (!row) return null;
  // Check expiration
  if (row.expires_at && new Date(row.expires_at + 'Z') < new Date()) {
    return null;
  }
  return { ...row, models: row.models ? JSON.parse(row.models) : null };
}

module.exports = {
  createClient,
  listClients,
  updateClient,
  deleteClient,
  rotateClientKey,
  findClientByKey,
  hashKey,
  hashKeyLegacy,
  generateKey,
  getHmacSecret,
  resetHmacCache,
};
