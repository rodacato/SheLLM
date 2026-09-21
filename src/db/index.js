'use strict';

const { mkdirSync, chmodSync, existsSync } = require('node:fs');
const path = require('node:path');

const { runMigrations } = require('./migrate');

let db = null;
let pruneInterval = null;

function initDb(dbPath) {
  if (db) return db;

  const Database = require('better-sqlite3');

  if (dbPath === ':memory:') {
    db = new Database(':memory:');
  } else {
    if (!dbPath) dbPath = require('../cli/paths').DB_FILE;

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

  runMigrations(db);

  // Initialize HMAC secret (auto-generates if needed)
  const { resetHmacCache, getHmacSecret } = require('./clients');
  resetHmacCache();
  getHmacSecret();

  // Prune old logs and expired keys on startup and daily
  const { pruneOldLogs, pruneExpiredKeys } = require('./request-logs');
  pruneOldLogs();
  pruneExpiredKeys();
  pruneInterval = setInterval(() => { pruneOldLogs(); pruneExpiredKeys(); }, 24 * 60 * 60 * 1000);
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
  // audit
  ...audit,
};
