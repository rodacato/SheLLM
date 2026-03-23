'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { mkdirSync, chmodSync, existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const KEY_PREFIX_LEN = 8;

let db = null;
let pruneInterval = null;

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateKey() {
  return 'shellm-' + randomBytes(16).toString('hex');
}

function runMigrations(database, dbPath) {
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
    database.exec(sql);
    database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
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
    mkdirSync(dir, { recursive: true });

    const isNew = !existsSync(dbPath);
    db = new Database(dbPath);

    if (isNew) {
      try { chmodSync(dbPath, 0o600); } catch { /* ignore on Windows */ }
    }
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, dbPath);

  // Prune old logs on startup and daily
  pruneOldLogs(30);
  pruneInterval = setInterval(() => pruneOldLogs(30), 24 * 60 * 60 * 1000);
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
}

// --- Client CRUD ---

function createClient({ name, rpm = 10, models = null, expires_at = null }) {
  const rawKey = generateKey();
  const key_hash = hashKey(rawKey);
  const key_prefix = rawKey.slice(0, KEY_PREFIX_LEN);
  const modelsJson = models ? JSON.stringify(models) : null;

  const stmt = db.prepare(`
    INSERT INTO clients (name, key_hash, key_prefix, rpm, models, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, key_hash, key_prefix, rpm, modelsJson, expires_at);

  const row = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, created_at FROM clients WHERE id = ?').get(info.lastInsertRowid);
  return {
    ...row,
    models: row.models ? JSON.parse(row.models) : null,
    rawKey,
  };
}

function listClients() {
  const rows = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, created_at FROM clients ORDER BY id').all();
  return rows.map((r) => ({
    ...r,
    models: r.models ? JSON.parse(r.models) : null,
  }));
}

function updateClient(id, fields) {
  const allowed = ['rpm', 'models', 'active', 'expires_at'];
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

  const row = db.prepare('SELECT id, name, key_prefix, rpm, models, active, expires_at, created_at FROM clients WHERE id = ?').get(id);
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
  const key_hash = hashKey(rawKey);
  const key_prefix = rawKey.slice(0, KEY_PREFIX_LEN);

  db.prepare('UPDATE clients SET key_hash = ?, key_prefix = ? WHERE id = ?').run(key_hash, key_prefix, id);

  return { rawKey, key_prefix };
}

function findClientByKey(rawKey) {
  const key_hash = hashKey(rawKey);
  const row = db.prepare('SELECT id, name, rpm, models, active, expires_at FROM clients WHERE key_hash = ?').get(key_hash);
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

// --- Provider Settings ---

function getProviderSettings() {
  if (!db) return [];
  return db.prepare('SELECT name, enabled, updated_at FROM provider_settings ORDER BY name').all();
}

function getProviderSetting(name) {
  if (!db) return null;
  return db.prepare('SELECT name, enabled, updated_at FROM provider_settings WHERE name = ?').get(name) || null;
}

function setProviderEnabled(name, enabled) {
  const result = db.prepare(
    "UPDATE provider_settings SET enabled = ?, updated_at = datetime('now') WHERE name = ?"
  ).run(enabled ? 1 : 0, name);
  if (result.changes === 0) return null;
  return db.prepare('SELECT name, enabled, updated_at FROM provider_settings WHERE name = ?').get(name);
}

function getProviderLastUsage() {
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
  getProviderSettings,
  getProviderSetting,
  setProviderEnabled,
  getProviderLastUsage,
  // Exposed for testing
  hashKey,
  generateKey,
};
