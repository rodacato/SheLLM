'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');
const { mkdirSync, chmodSync, existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const KEY_PREFIX_LEN = 8;

let db = null;
let pruneInterval = null;
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

function generateKey() {
  return 'shellm-' + randomBytes(16).toString('hex');
}

function runMigrations(database, _dbPath) {
  database.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

  const applied = new Set(database.prepare('SELECT name FROM _migrations').all().map(r => r.name));

  // Find migrations directory — handle both normal and :memory: paths
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  if (!existsSync(migrationsDir)) return;

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      database.exec(sql);
    } catch (err) {
      // Ignore "duplicate column" errors for idempotent ALTER TABLE migrations
      if (err.message && err.message.includes('duplicate column')) { /* ok */ }
      else throw err;
    }
    database.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(file);
  }
}

function initDb(dbPath) {
  if (db) return db;

  const Database = require('better-sqlite3');

  if (dbPath === ':memory:') {
    db = new Database(':memory:');
  } else {
    if (!dbPath) {
      const { SHELLM_DIR } = require('../cli/paths');
      dbPath = path.join(SHELLM_DIR, 'shellm.db');
    }

    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    const isNew = !existsSync(dbPath);
    db = new Database(dbPath);

    if (isNew) {
      try { chmodSync(dbPath, 0o600); } catch { /* ignore on Windows */ }
    }
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, dbPath);

  // Initialize HMAC secret (auto-generates if needed)
  _hmacSecret = null; // reset cache for fresh DB
  getHmacSecret();

  // Prune old logs and expired keys on startup and daily
  pruneOldLogs(30);
  pruneExpiredKeys();
  pruneInterval = setInterval(() => { pruneOldLogs(30); pruneExpiredKeys(); }, 24 * 60 * 60 * 1000);
  pruneInterval.unref();

  return db;
}

function getDb() {
  return db;
}

function closeDb() {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  _hmacSecret = null;
}

// --- Client CRUD ---

function createClient({ name, rpm = 10, models = null, expires_at = null, description = null, safety_level = 'strict' }) {
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
  const rows = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, description, safety_level, created_at FROM clients ORDER BY id').all();
  return rows.map((r) => ({
    ...r,
    models: r.models ? JSON.parse(r.models) : null,
  }));
}

function updateClient(id, fields) {
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
  const info = db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return info.changes > 0;
}

function rotateClientKey(id) {
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

// --- Request Logs ---

function insertRequestLog({ request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd }) {
  db.prepare(`
    INSERT INTO request_logs (request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(request_id ?? null, client_name ?? null, provider ?? null, model ?? null, status ?? null, duration_ms ?? null, queued_ms ?? null, tokens ?? null, cost_usd ?? null);
}

function pruneOldLogs(days = 30) {
  if (!db) return;
  db.prepare('DELETE FROM request_logs WHERE created_at < datetime(\'now\', ?)').run(`-${days} days`);
}

function pruneExpiredKeys() {
  if (!db) return;
  db.prepare("UPDATE clients SET active = 0 WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND active = 1").run();
}

// --- Providers ---

function parseProviderRow(row) {
  if (!row) return null;
  return {
    ...row,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : {},
    health_check: row.health_check ? JSON.parse(row.health_check) : {},
  };
}

function getProviders() {
  if (!db) return [];
  const rows = db.prepare('SELECT * FROM providers ORDER BY priority ASC, name ASC').all();
  return rows.map(parseProviderRow);
}

function getProvider(name) {
  if (!db) return null;
  const row = db.prepare('SELECT * FROM providers WHERE name = ?').get(name);
  return parseProviderRow(row);
}

// Backwards-compatible aliases for existing callers
function getProviderSettings() {
  if (!db) return [];
  return db.prepare('SELECT name, enabled, updated_at FROM providers ORDER BY name').all();
}

function getProviderSetting(name) {
  if (!db) return null;
  return db.prepare('SELECT name, enabled, updated_at FROM providers WHERE name = ?').get(name) || null;
}

function setProviderEnabled(name, enabled) {
  const result = db.prepare(
    "UPDATE providers SET enabled = ?, updated_at = datetime('now') WHERE name = ?"
  ).run(enabled ? 1 : 0, name);
  if (result.changes === 0) return null;
  return db.prepare('SELECT name, enabled, updated_at FROM providers WHERE name = ?').get(name);
}

function createProvider({ name, type, capabilities = {}, health_check = {}, priority = 100 }) {
  if (!db) throw new Error('Database not initialized');
  db.prepare(`
    INSERT INTO providers (name, type, capabilities, health_check, priority)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name, type,
    typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities),
    typeof health_check === 'string' ? health_check : JSON.stringify(health_check),
    priority
  );
  return getProvider(name);
}

function deleteProvider(name) {
  if (!db) return false;
  // Delete associated models first (FK constraint)
  db.prepare('DELETE FROM models WHERE provider_name = ?').run(name);
  const info = db.prepare('DELETE FROM providers WHERE name = ?').run(name);
  return info.changes > 0;
}

function updateProvider(name, fields) {
  const allowed = ['enabled', 'capabilities', 'health_check', 'priority'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      if (key === 'capabilities' || key === 'health_check') {
        sets.push(`${key} = ?`);
        values.push(typeof fields[key] === 'string' ? fields[key] : JSON.stringify(fields[key]));
      } else {
        sets.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = datetime('now')");

  values.push(name);
  db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE name = ?`).run(...values);

  return getProvider(name);
}

function getProviderLastUsage() {
  if (!db) return [];
  return db.prepare(`
    SELECT provider,
           MAX(created_at) as last_used_at,
           (SELECT status FROM request_logs r2
            WHERE r2.provider = r1.provider
            ORDER BY r2.id DESC LIMIT 1) as last_status
    FROM request_logs r1
    WHERE provider IS NOT NULL
    GROUP BY provider
  `).all();
}

// --- Models ---

function getAllModels() {
  if (!db) return [];
  return db.prepare('SELECT * FROM models WHERE enabled = 1 ORDER BY provider_name, name').all();
}

function getModelsForProvider(providerName) {
  if (!db) return [];
  return db.prepare('SELECT * FROM models WHERE provider_name = ? ORDER BY name').all(providerName);
}

function getModelByName(name) {
  if (!db) return null;
  return db.prepare('SELECT * FROM models WHERE name = ?').get(name) || null;
}

function upsertModel({ name, provider_name, upstream_model = null, is_alias = 0, alias_for = null }) {
  db.prepare(`
    INSERT INTO models (name, provider_name, upstream_model, is_alias, alias_for)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      provider_name = excluded.provider_name,
      upstream_model = excluded.upstream_model,
      is_alias = excluded.is_alias,
      alias_for = excluded.alias_for
  `).run(name, provider_name, upstream_model, is_alias ? 1 : 0, alias_for);
  return getModelByName(name);
}

function deleteModel(name) {
  const info = db.prepare('DELETE FROM models WHERE name = ?').run(name);
  return info.changes > 0;
}

// --- Audit Log ---

function insertAuditLog({ action, resource, resource_id = null, details = null }) {
  if (!db) return;
  db.prepare('INSERT INTO admin_audit_logs (action, resource, resource_id, details) VALUES (?, ?, ?, ?)')
    .run(action, resource, resource_id, details);
}

function getAuditLogs({ limit = 100, resource_id = null } = {}) {
  if (!db) return [];
  if (resource_id) {
    return db.prepare('SELECT * FROM admin_audit_logs WHERE resource_id = ? ORDER BY id DESC LIMIT ?').all(resource_id, limit);
  }
  return db.prepare('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  createClient,
  listClients,
  updateClient,
  deleteClient,
  rotateClientKey,
  findClientByKey,
  insertRequestLog,
  pruneOldLogs,
  pruneExpiredKeys,
  getProviderSettings,
  getProviderSetting,
  setProviderEnabled,
  getProviders,
  getProvider,
  createProvider,
  deleteProvider,
  updateProvider,
  getProviderLastUsage,
  getAllModels,
  getModelsForProvider,
  getModelByName,
  upsertModel,
  deleteModel,
  insertAuditLog,
  getAuditLogs,
  // Exposed for testing
  hashKey,
  hashKeyLegacy,
  generateKey,
  getHmacSecret,
};
