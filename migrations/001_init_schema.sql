-- Initial schema: clients, request_logs, provider_settings

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  key_hash   TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  rpm        INTEGER NOT NULL DEFAULT 10,
  models     TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
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

CREATE TABLE IF NOT EXISTS provider_settings (
  name       TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default provider settings
INSERT OR IGNORE INTO provider_settings (name) VALUES ('claude');
INSERT OR IGNORE INTO provider_settings (name) VALUES ('gemini');
INSERT OR IGNORE INTO provider_settings (name) VALUES ('codex');
INSERT OR IGNORE INTO provider_settings (name) VALUES ('cerebras');
