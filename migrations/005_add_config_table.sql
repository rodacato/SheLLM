-- Config table for server-side secrets (HMAC key, etc.)
CREATE TABLE IF NOT EXISTS _config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
