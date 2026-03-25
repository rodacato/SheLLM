'use strict';

const { mkdirSync, chmodSync, existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

let db = null;
let pruneInterval = null;

function runMigrations(database, _dbPath) {
  database.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');

  const applied = new Set(database.prepare('SELECT name FROM _migrations').all().map(r => r.name));

  // Find migrations directory — handle both normal and :memory: paths
  const migrationsDir = path.join(__dirname, 'migrations');
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
  const { resetHmacCache, getHmacSecret } = require('./clients');
  resetHmacCache();
  getHmacSecret();

  // Prune old logs and expired keys on startup and daily
  const { pruneOldLogs, pruneExpiredKeys } = require('./request-logs');
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
  const { resetHmacCache } = require('./clients');
  resetHmacCache();
}

// Re-export all domain modules (barrel file)
const clients = require('./clients');
const requestLogs = require('./request-logs');
const providers = require('./providers');
const models = require('./models');
const audit = require('./audit');

module.exports = {
  initDb,
  getDb,
  closeDb,
  // clients
  ...clients,
  // request-logs
  ...requestLogs,
  // providers
  ...providers,
  // models
  ...models,
  // audit
  ...audit,
};
