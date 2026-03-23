'use strict';

const { getDb } = require('./index');

// --- Setting Registry (declarative) ---
// Each entry defines a known setting with its type, env var fallback, default value, and description.
const REGISTRY = {
  global_rpm: {
    type: 'number',
    env: 'SHELLM_GLOBAL_RPM',
    default: 30,
    description: 'Global rate limit (requests per minute)',
  },
  timeout_ms: {
    type: 'number',
    env: 'TIMEOUT_MS',
    default: 120000,
    description: 'Provider request timeout (milliseconds)',
  },
  max_concurrent: {
    type: 'number',
    env: 'MAX_CONCURRENT',
    default: 2,
    description: 'Maximum concurrent requests',
  },
  max_queue_depth: {
    type: 'number',
    env: 'MAX_QUEUE_DEPTH',
    default: 10,
    description: 'Maximum pending requests in queue',
  },
  log_level: {
    type: 'string',
    env: 'LOG_LEVEL',
    default: 'info',
    description: 'Logging level (debug, info, warn, error)',
  },
};

// --- In-memory cache ---
const cache = new Map();

function castValue(value, type) {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number': return Number(value);
    case 'boolean': return value === 'true' || value === '1' || value === true;
    case 'json':
      try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; }
    default: return String(value);
  }
}

/**
 * Get a setting value with fallback chain: DB > env > default
 */
function getSetting(key) {
  // 1. Check cache
  if (cache.has(key)) return cache.get(key);

  const reg = REGISTRY[key];
  const type = reg?.type || 'string';

  // 2. Check DB
  const db = getDb();
  if (db) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
      const val = castValue(row.value, type);
      cache.set(key, val);
      return val;
    }
  }

  // 3. Check env var
  if (reg?.env && process.env[reg.env] !== undefined) {
    const val = castValue(process.env[reg.env], type);
    cache.set(key, val);
    return val;
  }

  // 4. Default
  const val = reg?.default ?? null;
  cache.set(key, val);
  return val;
}

/**
 * Determine where the current effective value comes from
 */
function getSettingSource(key) {
  const db = getDb();
  if (db) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) return 'db';
  }
  const reg = REGISTRY[key];
  if (reg?.env && process.env[reg.env] !== undefined) return 'env';
  return 'default';
}

/**
 * Set a setting value in DB
 */
function setSetting(key, value) {
  const reg = REGISTRY[key];
  if (!reg) throw new Error(`Unknown setting: ${key}`);

  // Validate type
  const type = reg.type;
  if (type === 'number' && isNaN(Number(value))) {
    throw new Error(`Setting "${key}" must be a number`);
  }

  const db = getDb();
  if (!db) throw new Error('Database not initialized');

  const strValue = String(value);
  db.prepare(`
    INSERT INTO settings (key, value, type, description, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `).run(key, strValue, type, reg.description || null);

  // Invalidate cache for this key
  cache.set(key, castValue(strValue, type));

  return { key, value: castValue(strValue, type), source: 'db' };
}

/**
 * Delete a setting from DB (revert to env/default)
 */
function deleteSetting(key) {
  const db = getDb();
  if (!db) return false;
  const info = db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  cache.delete(key);
  return info.changes > 0;
}

/**
 * List all settings with effective values and sources
 */
function listSettings() {
  return Object.entries(REGISTRY).map(([key, reg]) => ({
    key,
    value: getSetting(key),
    source: getSettingSource(key),
    type: reg.type,
    description: reg.description,
    env_var: reg.env,
    default: reg.default,
  }));
}

/**
 * Invalidate all cached values (for testing)
 */
function invalidateCache() {
  cache.clear();
}

module.exports = { getSetting, setSetting, deleteSetting, listSettings, invalidateCache, REGISTRY };
