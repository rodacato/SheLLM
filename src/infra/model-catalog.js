'use strict';

const { listCodexModels, listClaudeModels } = require('../providers/model-list');

// Asking a CLI costs a spawn, and a model catalog changes on the order of weeks.
const TTL_MS = parseInt(process.env.SHELLM_MODEL_CATALOG_TTL_MS || String(6 * 60 * 60 * 1000), 10);

const LISTERS = { codex: listCodexModels, claude: listClaudeModels };

function baked() {
  try {
    return require('../catalog/models.json');
  } catch {
    return { generated_at: null, cli: {}, providers: {} };
  }
}

// Read at require time and never spawned for: this is what resolves a bare provider name on the
// request path, where a five-second probe would be worse than a stale answer.
function bakedDefault(provider) {
  const models = baked().providers?.[provider]?.models || [];
  return models.find((m) => m.isDefault)?.id ?? null;
}

// The short names a provider's CLI answers to, as the catalog last saw them. Read from disk so
// the request path can strip a prefix without waiting on a spawn.
function bakedAliases(provider) {
  const prefix = `${provider}-`;
  return new Set((baked().providers?.[provider]?.models || [])
    .map((m) => m.id)
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length)));
}

// The CLI's own aliases, used when there is no catalog at all. Tier names outlive versions, which
// is the whole reason they are safe to hardcode and the version strings are not.
function declared(provider) {
  const { engines } = require('../routing/engines');
  return (engines[provider]?.models || []).map((id) => ({
    id, label: id, description: null, isDefault: false, retiresAt: null, upgradeTo: null,
  }));
}

const cache = new Map();

async function probe(provider) {
  const lister = LISTERS[provider];
  if (!lister) return null;
  const { engines } = require('../routing/engines');
  try {
    return await lister({ env: engines[provider]?.env });
  } catch {
    return null;
  }
}

// Three answers, and the caller is always told which one it got. A catalog that cannot say it is
// stale repeats the defect this dashboard just stopped having.
async function readCatalog(provider) {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.readAt < TTL_MS) return hit.value;

  const live = await probe(provider);
  const file = baked();
  const value = live
    ? { models: live, source: 'cli', readAt: new Date().toISOString(), generatedAt: null, cli: null }
    : file.providers?.[provider]?.models?.length
      ? {
        models: file.providers[provider].models,
        source: 'baked',
        readAt: null,
        generatedAt: file.generated_at,
        cli: file.cli?.[provider] ?? null,
      }
      : { models: declared(provider), source: 'declared', readAt: null, generatedAt: null, cli: null };

  cache.set(provider, { readAt: Date.now(), value });
  return value;
}

function resetCatalogCache() {
  cache.clear();
}

module.exports = { readCatalog, bakedDefault, bakedAliases, resetCatalogCache, declared };
