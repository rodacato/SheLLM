'use strict';

function parseProviderRow(row) {
  if (!row) return null;
  return {
    ...row,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : {},
    health_check: row.health_check ? JSON.parse(row.health_check) : {},
  };
}

function getProviders() {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare('SELECT * FROM providers ORDER BY priority ASC, name ASC').all();
  return rows.map(parseProviderRow);
}

function getProvider(name) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return null;
  const row = db.prepare('SELECT * FROM providers WHERE name = ?').get(name);
  return parseProviderRow(row);
}

// Backwards-compatible aliases for existing callers
function getProviderSettings() {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return [];
  return db.prepare('SELECT name, enabled, updated_at FROM providers ORDER BY name').all();
}

function getProviderSetting(name) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return null;
  return db.prepare('SELECT name, enabled, updated_at FROM providers WHERE name = ?').get(name) || null;
}

function setProviderEnabled(name, enabled) {
  const { getDb } = require('./index');
  const db = getDb();
  const result = db.prepare(
    "UPDATE providers SET enabled = ?, updated_at = datetime('now') WHERE name = ?"
  ).run(enabled ? 1 : 0, name);
  if (result.changes === 0) return null;
  return db.prepare('SELECT name, enabled, updated_at FROM providers WHERE name = ?').get(name);
}

function createProvider({ name, type, capabilities = {}, health_check = {}, priority = 100 }) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) throw new Error('Database not initialized');
  db.prepare(`
    INSERT INTO providers (name, type, capabilities, health_check, priority)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name, type,
    typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities),
    typeof health_check === 'string' ? health_check : JSON.stringify(health_check),
    priority
  );
  return getProvider(name);
}

function deleteProvider(name) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return false;
  // Delete associated models first (FK constraint)
  db.prepare('DELETE FROM models WHERE provider_name = ?').run(name);
  const info = db.prepare('DELETE FROM providers WHERE name = ?').run(name);
  return info.changes > 0;
}

function updateProvider(name, fields) {
  const { getDb } = require('./index');
  const db = getDb();
  const allowed = ['enabled', 'capabilities', 'health_check', 'priority'];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      if (key === 'capabilities' || key === 'health_check') {
        sets.push(`${key} = ?`);
        values.push(typeof fields[key] === 'string' ? fields[key] : JSON.stringify(fields[key]));
      } else {
        sets.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = datetime('now')");

  values.push(name);
  db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE name = ?`).run(...values);

  return getProvider(name);
}

function getProviderLastUsage() {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return [];
  return db.prepare(`
    SELECT provider,
           MAX(created_at) as last_used_at,
           (SELECT status FROM request_logs r2
            WHERE r2.provider = r1.provider
            ORDER BY r2.id DESC LIMIT 1) as last_status
    FROM request_logs r1
    WHERE provider IS NOT NULL
    GROUP BY provider
  `).all();
}

module.exports = {
  getProviders,
  getProvider,
  getProviderSettings,
  getProviderSetting,
  setProviderEnabled,
  createProvider,
  deleteProvider,
  updateProvider,
  getProviderLastUsage,
};
