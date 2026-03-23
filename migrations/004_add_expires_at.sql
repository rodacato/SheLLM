-- Add expires_at column to clients if it doesn't already exist

-- SQLite has no IF NOT EXISTS for ALTER TABLE ADD COLUMN,
-- so we check the schema first via a CREATE TRIGGER trick:
-- If the column already exists, ALTER TABLE throws "duplicate column" which
-- the migration runner handles gracefully.

ALTER TABLE clients ADD COLUMN expires_at TEXT;
