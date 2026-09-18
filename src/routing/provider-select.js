const { invalidRequest, providerUnavailable } = require('../errors');
const { canSendTraffic } = require('../infra/circuit-breaker');
const { engines } = require('./engines');

function resolveProvider(model) {
  if (engines[model]) return engines[model];
  return Object.values(engines).find((engine) => engine.models && model.startsWith(`${engine.name}-`)) || null;
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

module.exports = { resolveProvider, checkProviderAvailability, selectProvider, getAvailableProviders };
