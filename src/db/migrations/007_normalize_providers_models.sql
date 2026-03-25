-- Normalize providers and models into proper database tables
-- Replaces the minimal provider_settings table with a rich providers table
-- and adds a models table linked to providers

-- Providers table (replaces provider_settings)
CREATE TABLE IF NOT EXISTS providers (
  name          TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK(type IN ('subprocess', 'http')),
  enabled       INTEGER NOT NULL DEFAULT 1,
  capabilities  TEXT NOT NULL DEFAULT '{}',
  health_check  TEXT NOT NULL DEFAULT '{}',
  priority      INTEGER NOT NULL DEFAULT 100,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migrate data from provider_settings (preserve enabled state and timestamps)
INSERT OR IGNORE INTO providers (name, type, enabled, capabilities, health_check, priority, updated_at)
  SELECT
    name,
    CASE WHEN name = 'cerebras' THEN 'http' ELSE 'subprocess' END,
    enabled,
    CASE name
      WHEN 'claude' THEN '{"supports_system_prompt":true,"supports_json_output":true,"supports_max_tokens":false}'
      WHEN 'gemini' THEN '{"supports_system_prompt":false,"supports_json_output":false,"supports_max_tokens":false}'
      WHEN 'codex'  THEN '{"supports_system_prompt":false,"supports_json_output":true,"supports_max_tokens":false}'
      WHEN 'cerebras' THEN '{"supports_system_prompt":true,"supports_json_output":false,"supports_max_tokens":true}'
    END,
    CASE name
      WHEN 'claude' THEN '{"command":"claude","args":["--print","--dangerously-skip-permissions","--","test"]}'
      WHEN 'gemini' THEN '{"command":"gemini","args":["--approval-mode","yolo","-p","test"]}'
      WHEN 'codex'  THEN '{"command":"codex","args":["exec","--ephemeral","--skip-git-repo-check","test"]}'
      WHEN 'cerebras' THEN '{"url":"https://api.cerebras.ai/v1/models","auth_env":"CEREBRAS_API_KEY"}'
    END,
    CASE name
      WHEN 'claude' THEN 10
      WHEN 'cerebras' THEN 20
      WHEN 'gemini' THEN 30
      WHEN 'codex' THEN 40
    END,
    updated_at
  FROM provider_settings;

-- Models table
CREATE TABLE IF NOT EXISTS models (
  name            TEXT PRIMARY KEY,
  provider_name   TEXT NOT NULL REFERENCES providers(name),
  upstream_model  TEXT,
  is_alias        INTEGER NOT NULL DEFAULT 0,
  alias_for       TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_name);

-- Seed models from current hardcoded VALID_MODELS arrays

-- Claude models
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude', 'claude');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude-sonnet', 'claude');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude-sonnet-4-6', 'claude');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude-haiku', 'claude');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude-haiku-4-5', 'claude');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude-opus', 'claude');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('claude-opus-4-6', 'claude');

-- Gemini models
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('gemini', 'gemini');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('gemini-pro', 'gemini');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('gemini-flash', 'gemini');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('gemini-2.0-flash', 'gemini');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('gemini-2.5-pro', 'gemini');

-- Codex models
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('codex', 'codex');
INSERT OR IGNORE INTO models (name, provider_name) VALUES ('codex-mini', 'codex');

-- Cerebras models (with upstream_model mapping)
INSERT OR IGNORE INTO models (name, provider_name, upstream_model) VALUES ('cerebras', 'cerebras', 'llama-3.3-70b');
INSERT OR IGNORE INTO models (name, provider_name, upstream_model) VALUES ('cerebras-8b', 'cerebras', 'llama3.1-8b');
INSERT OR IGNORE INTO models (name, provider_name, upstream_model) VALUES ('cerebras-70b', 'cerebras', 'llama-3.3-70b');
INSERT OR IGNORE INTO models (name, provider_name, upstream_model) VALUES ('cerebras-120b', 'cerebras', 'llama-3.3-70b');
INSERT OR IGNORE INTO models (name, provider_name, upstream_model) VALUES ('cerebras-qwen', 'cerebras', 'qwen-3-235b-a22b-instruct-2507');

-- Drop old table
DROP TABLE IF EXISTS provider_settings;
