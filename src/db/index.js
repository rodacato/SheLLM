'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { mkdirSync, chmodSync, existsSync } = require('node:fs');
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      key_hash   TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      rpm        INTEGER NOT NULL DEFAULT 10,
      models     TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id  TEXT,
      client_name TEXT,
      provider    TEXT,
      model       TEXT,
      status      INTEGER,
      duration_ms INTEGER,
      queued_ms   INTEGER,
      tokens      INTEGER,
      cost_usd    REAL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_logs_created ON request_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_client  ON request_logs(client_name);
  `);

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

function createClient({ name, rpm = 10, models = null }) {
  const rawKey = generateKey();
  const key_hash = hashKey(rawKey);
  const key_prefix = rawKey.slice(0, KEY_PREFIX_LEN);
  const modelsJson = models ? JSON.stringify(models) : null;

  const stmt = db.prepare(`
    INSERT INTO clients (name, key_hash, key_prefix, rpm, models)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, key_hash, key_prefix, rpm, modelsJson);

  const row = db.prepare('SELECT id, name, key_prefix, rpm, models, active, created_at FROM clients WHERE id = ?').get(info.lastInsertRowid);
  return {
    ...row,
    models: row.models ? JSON.parse(row.models) : null,
    rawKey,
  };
}

function listClients() {
  const rows = db.prepare('SELECT id, name, key_prefix, rpm, models, active, created_at FROM clients ORDER BY id').all();
  return rows.map((r) => ({
    ...r,
    models: r.models ? JSON.parse(r.models) : null,
  }));
}

function updateClient(id, fields) {
  const allowed = ['rpm', 'models', 'active'];
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

  const row = db.prepare('SELECT id, name, key_prefix, rpm, models, active, created_at FROM clients WHERE id = ?').get(id);
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
  const row = db.prepare('SELECT id, name, rpm, models, active FROM clients WHERE key_hash = ?').get(key_hash);
  if (!row) return null;
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
  db.prepare(`DELETE FROM request_logs WHERE created_at < datetime('now', ?)`).run(`-${days} days`);
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
  // Exposed for testing
  hashKey,
  generateKey,
};
