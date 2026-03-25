-- Settings table for hot-reloadable configuration
-- Values override env vars; env vars override defaults
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'string',
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
