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

const CLIENT_COLUMNS = 'id, name, key_prefix, rpm, models, origins, active, expires_at, description, created_at';

// models and origins are both JSON arrays or NULL; a row is only usable once both are decoded.
function decodeClient(row) {
  if (!row) return null;
  return {
    ...row,
    models: row.models ? JSON.parse(row.models) : null,
    origins: row.origins ? JSON.parse(row.origins) : null,
  };
}

function encodeList(list) {
  return list ? JSON.stringify(list) : null;
}

function createClient({ name, rpm = 10, models = null, origins = null, expires_at = null, description = null }) {
  const { getDb } = require('./index');
  const db = getDb();
  const rawKey = generateKey();
  const secret = getHmacSecret();
  const key_hash = hashKey(rawKey, secret);
  const key_prefix = rawKey.slice(0, KEY_PREFIX_LEN);

  const stmt = db.prepare(`
    INSERT INTO clients (name, key_hash, key_prefix, rpm, models, origins, expires_at, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, key_hash, key_prefix, rpm, encodeList(models), encodeList(origins), expires_at, description);

  const row = db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`).get(info.lastInsertRowid);
  return { ...decodeClient(row), rawKey };
}

function listClients() {
  const { getDb } = require('./index');
  const db = getDb();
  const rows = db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY id`).all();
  return rows.map(decodeClient);
}

function updateClient(id, fields) {
  const { getDb } = require('./index');
  const db = getDb();
  const allowed = ['rpm', 'models', 'origins', 'active', 'expires_at', 'description'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(key === 'models' || key === 'origins' ? encodeList(fields[key]) : fields[key]);
    }
  }

  if (sets.length === 0) return null;

  values.push(id);
  db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return decodeClient(db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`).get(id));
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
  const lookup = 'SELECT id, name, rpm, models, origins, active, expires_at FROM clients WHERE key_hash = ?';
  let row = db.prepare(lookup).get(hmacHash);

  if (!row) {
    // Legacy fallback: try plain SHA-256 and auto-upgrade
    const legacyHash = hashKeyLegacy(rawKey);
    row = db.prepare(lookup).get(legacyHash);
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
  return decodeClient(row);
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
