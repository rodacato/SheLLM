const { engines, registerHttpProviders } = require('./engines');

// Model-to-provider map — built from DB, rebuilt on invalidation
let modelToProvider = {};
let _modelCacheBuilt = false;

function buildModelMap() {
  registerHttpProviders();
  try {
    const { getAllModels, getDb } = require('../db');
    if (!getDb()) throw new Error('DB not initialized');
    const models = getAllModels();
    const map = {};
    for (const m of models) {
      map[m.name] = m.provider_name;
    }
    modelToProvider = map;
    _modelCacheBuilt = true;
  } catch {
    // DB not initialized yet (tests, early boot) — fall back to engine validModels
    if (!_modelCacheBuilt) {
      const map = {};
      for (const [name, engine] of Object.entries(engines)) {
        if (engine.validModels) {
          for (const model of engine.validModels) {
            map[model] = name;
          }
        }
      }
      modelToProvider = map;
    }
  }
}

function invalidateModelCache() {
  _modelCacheBuilt = false;
  buildModelMap();
}

function getAliases() {
  const aliases = {};
  try {
    const { getAllModels } = require('../db');
    const models = getAllModels();
    for (const m of models) {
      if (m.is_alias) aliases[m.name] = m.alias_for || m.provider_name;
    }
  } catch { /* ignore */ }
  return aliases;
}

// Seed SHELLM_ALIASES env var into DB on first boot
function seedAliasesFromEnv() {
  try {
    const raw = process.env.SHELLM_ALIASES;
    if (!raw) return;
    const aliases = JSON.parse(raw);
    const { getModelByName, upsertModel } = require('../db');
    for (const [alias, target] of Object.entries(aliases)) {
      if (!getModelByName(alias)) {
        const providerName = engines[target] ? target : modelToProvider[target];
        if (providerName) {
          upsertModel({ name: alias, provider_name: providerName, is_alias: 1, alias_for: target });
        }
      }
    }
  } catch { /* ignore */ }
}

function getModelToProvider() {
  return modelToProvider;
}

function isModelCacheBuilt() {
  return _modelCacheBuilt;
}

module.exports = { buildModelMap, invalidateModelCache, getAliases, seedAliasesFromEnv, getModelToProvider, isModelCacheBuilt };
