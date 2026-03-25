const { invalidRequest, providerUnavailable } = require('../errors');
const { canSendTraffic } = require('../infra/circuit-breaker');
const { engines } = require('./engines');
const { buildModelMap, getModelToProvider, isModelCacheBuilt } = require('./model-cache');

function resolveProvider(model) {
  if (!isModelCacheBuilt()) buildModelMap();
  // Direct engine name match
  if (engines[model]) return engines[model];
  // Model-to-provider map (from DB)
  const modelToProvider = getModelToProvider();
  const providerName = modelToProvider[model];
  if (providerName && engines[providerName]) return engines[providerName];
  return null;
}

/**
 * Resolve the upstream model name for API-compatible responses.
 * Returns the upstream_model from DB if set, otherwise the alias target or original name.
 */
function resolveUpstreamModel(model) {
  try {
    const { getModelByName } = require('../db');
    const row = getModelByName(model);
    if (row && row.upstream_model) return row.upstream_model;
    if (row && row.alias_for) return row.alias_for;
  } catch { /* DB not ready */ }
  return model;
}

/**
 * Check if a provider is available (enabled, authenticated, circuit closed).
 * Returns null if available, or a reason string if not.
 */
function checkProviderAvailability(provider) {
  const { getProviderSetting } = require('../db');
  const { getCachedProviderStatus } = require('../infra/health');

  const setting = getProviderSetting(provider.name);
  if (setting && !setting.enabled) return 'disabled';

  const healthStatus = getCachedProviderStatus(provider.name);
  if (healthStatus && healthStatus.authenticated === false) return 'not authenticated';

  if (!canSendTraffic(provider.name)) return 'circuit_open';

  return null;
}

/**
 * Select a provider for the given model, running fail-fast checks.
 * Returns the provider object or throws providerUnavailable.
 */
function selectProvider(model) {
  const provider = resolveProvider(model);
  if (!provider) {
    throw invalidRequest(`Unknown provider: ${model}`);
  }

  const reason = checkProviderAvailability(provider);
  if (reason) {
    throw providerUnavailable(`${provider.name} is ${reason}`, {
      available_providers: getAvailableProviders(),
    });
  }

  return provider;
}

/**
 * Get list of currently available provider names.
 */
function getAvailableProviders() {
  return Object.values(engines)
    .filter((p) => !checkProviderAvailability(p))
    .map((p) => p.name);
}

module.exports = { resolveProvider, resolveUpstreamModel, checkProviderAvailability, selectProvider, getAvailableProviders };
