-- Add expires_at to clients if missing (for pre-migration DBs)
-- SQLite ALTER TABLE ADD COLUMN is a no-op if column already exists when wrapped in a try

ALTER TABLE clients ADD COLUMN expires_at TEXT;
