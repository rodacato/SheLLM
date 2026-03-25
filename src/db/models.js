'use strict';

function getAllModels() {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return [];
  return db.prepare('SELECT * FROM models WHERE enabled = 1 ORDER BY provider_name, name').all();
}

function getModelsForProvider(providerName) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return [];
  return db.prepare('SELECT * FROM models WHERE provider_name = ? ORDER BY name').all(providerName);
}

function getModelByName(name) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return null;
  return db.prepare('SELECT * FROM models WHERE name = ?').get(name) || null;
}

function upsertModel({ name, provider_name, upstream_model = null, is_alias = 0, alias_for = null }) {
  const { getDb } = require('./index');
  const db = getDb();
  db.prepare(`
    INSERT INTO models (name, provider_name, upstream_model, is_alias, alias_for)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      provider_name = excluded.provider_name,
      upstream_model = excluded.upstream_model,
      is_alias = excluded.is_alias,
      alias_for = excluded.alias_for
  `).run(name, provider_name, upstream_model, is_alias ? 1 : 0, alias_for);
  return getModelByName(name);
}

function deleteModel(name) {
  const { getDb } = require('./index');
  const db = getDb();
  const info = db.prepare('DELETE FROM models WHERE name = ?').run(name);
  return info.changes > 0;
}

module.exports = { getAllModels, getModelsForProvider, getModelByName, upsertModel, deleteModel };
