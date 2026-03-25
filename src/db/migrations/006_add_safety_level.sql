-- Per-client safety level: strict (default), standard, permissive
ALTER TABLE clients ADD COLUMN safety_level TEXT NOT NULL DEFAULT 'strict';
