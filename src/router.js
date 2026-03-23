const claude = require('./providers/claude');
const gemini = require('./providers/gemini');
const codex = require('./providers/codex');
const cerebras = require('./providers/cerebras');
const { invalidRequest, rateLimited, providerUnavailable } = require('./errors');
const { canSendTraffic, recordSuccess, recordFailure } = require('./circuit-breaker');
const logger = require('./lib/logger');

const providers = { claude, gemini, codex, cerebras };

// Also register model aliases so "claude-opus" resolves to the claude provider
const modelToProvider = {};
for (const [name, provider] of Object.entries(providers)) {
  for (const model of provider.validModels) {
    modelToProvider[model] = name;
  }
}

// User-defined aliases via SHELLM_ALIASES env var (JSON { alias: target })
const userAliases = (() => {
  try { return JSON.parse(process.env.SHELLM_ALIASES || '{}'); } catch { return {}; }
})();
for (const [alias, target] of Object.entries(userAliases)) {
  const providerName = providers[target] ? target : modelToProvider[target];
  if (providerName) modelToProvider[alias] = providerName;
}

function getAliases() {
  return { ...userAliases };
}

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2', 10);
const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH || '10', 10);
const FALLBACK_ENABLED = (process.env.SHELLM_FALLBACK_ENABLED || 'false') === 'true';
const FALLBACK_ORDER = (process.env.SHELLM_FALLBACK_ORDER || 'claude,cerebras,gemini,codex').split(',').map((s) => s.trim());
const MAX_STREAM_CONCURRENT = parseInt(process.env.MAX_STREAM_CONCURRENT || String(MAX_CONCURRENT), 10);

let activeStreams = 0;

class RequestQueue {
  constructor(maxConcurrent = MAX_CONCURRENT) {
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.pending = [];
  }

  async enqueue(fn) {
    if (this.pending.length >= MAX_QUEUE_DEPTH) {
      logger.warn({ event: 'queue_full', active: this.active, pending: this.pending.length });
      throw rateLimited('Queue is full, try again later');
    }

    if (this.active >= this.maxConcurrent) {
      await new Promise((resolve) => this.pending.push(resolve));
    }

    this.active++;
    logger.debug({ event: 'queue_dequeue', active: this.active, pending: this.pending.length });
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.pending.length > 0) {
        const next = this.pending.shift();
        next();
      }
    }
  }

  get stats() {
    return {
      pending: this.pending.length,
      active: this.active,
      max_concurrent: this.maxConcurrent,
      active_streams: activeStreams,
      max_stream_concurrent: MAX_STREAM_CONCURRENT,
    };
  }
}

const queue = new RequestQueue();

function resolveProvider(model) {
  // Direct name match
  if (providers[model]) return providers[model];
  // Model alias match
  const providerName = modelToProvider[model];
  if (providerName) return providers[providerName];
  return null;
}

/**
 * Check if a provider is available (enabled, authenticated, circuit closed).
 * Returns null if available, or a reason string if not.
 */
function checkProviderAvailability(provider) {
  const { getProviderSetting } = require('./db');
  const { getCachedProviderStatus } = require('./health');

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
  return Object.values(providers)
    .filter((p) => !checkProviderAvailability(p))
    .map((p) => p.name);
}

async function route({ model, prompt, system, max_tokens, temperature, top_p, response_format, request_id, allowFallback }) {
  const useFallback = allowFallback ?? FALLBACK_ENABLED;
  if (useFallback) {
    return routeWithFallback({ model, prompt, system, max_tokens, temperature, top_p, response_format, request_id });
  }

  const provider = selectProvider(model);
  const startTime = Date.now();

  let result;
  try {
    result = await queue.enqueue(() => {
      const execStart = Date.now();
      return provider.chat({ prompt, system, max_tokens, temperature, top_p, response_format, model })
        .then((r) => ({ ...r, queued_ms: execStart - startTime }));
    });
    recordSuccess(provider.name);
  } catch (err) {
    recordFailure(provider.name);
    throw err;
  }

  return {
    content: result.content,
    provider: provider.name,
    model,
    duration_ms: Date.now() - startTime,
    queued_ms: result.queued_ms,
    request_id: request_id || null,
    ...(result.cost_usd != null && { cost_usd: result.cost_usd }),
    ...(result.usage && { usage: result.usage }),
  };
}

async function routeWithFallback({ model, prompt, system, max_tokens, temperature, top_p, response_format, request_id }) {
  const primary = resolveProvider(model);
  if (!primary) {
    throw invalidRequest(`Unknown provider: ${model}`);
  }

  // Build candidate list: primary first, then fallback order (excluding primary)
  const candidates = [primary];
  for (const name of FALLBACK_ORDER) {
    if (providers[name] && providers[name].name !== primary.name) {
      candidates.push(providers[name]);
    }
  }

  const errors = [];
  for (const candidate of candidates) {
    const reason = checkProviderAvailability(candidate);
    if (reason) {
      logger.debug({ event: 'fallback_skip', provider: candidate.name, reason });
      continue;
    }

    const startTime = Date.now();
    try {
      const result = await queue.enqueue(() => {
        const execStart = Date.now();
        return candidate.chat({ prompt, system, max_tokens, temperature, top_p, response_format, model })
          .then((r) => ({ ...r, queued_ms: execStart - startTime }));
      });
      recordSuccess(candidate.name);

      const isFallback = candidate.name !== primary.name;
      if (isFallback) {
        logger.info({ event: 'fallback_success', original: primary.name, actual: candidate.name, request_id });
      }

      return {
        content: result.content,
        provider: candidate.name,
        model,
        duration_ms: Date.now() - startTime,
        queued_ms: result.queued_ms,
        request_id: request_id || null,
        ...(result.cost_usd != null && { cost_usd: result.cost_usd }),
        ...(result.usage && { usage: result.usage }),
        ...(isFallback && { original_provider: primary.name }),
      };
    } catch (err) {
      recordFailure(candidate.name);
      errors.push({ provider: candidate.name, error: err.message });
      logger.warn({ event: 'fallback_attempt', provider: candidate.name, error: err.message, request_id });

      // Don't fallback on client errors (400-level)
      if (err.status && err.status >= 400 && err.status < 500) {
        throw err;
      }
    }
  }

  const available = getAvailableProviders();
  const err = providerUnavailable(`All providers failed for ${model}`);
  err.available_providers = available;
  throw err;
}

function listProviders({ includeDisabled = true } = {}) {
  const { getProviderSettings } = require('./db');
  const settingsMap = {};
  try {
    const rows = getProviderSettings();
    for (const row of rows) settingsMap[row.name] = row;
  } catch { /* DB might not be initialized in tests */ }

  return Object.values(providers)
    .filter((p) => includeDisabled || !settingsMap[p.name] || settingsMap[p.name].enabled)
    .map((p) => ({
      name: p.name,
      models: p.validModels,
      ...p.capabilities,
      enabled: settingsMap[p.name] ? !!settingsMap[p.name].enabled : true,
    }));
}

function acquireStreamSlot() {
  if (activeStreams >= MAX_STREAM_CONCURRENT) return false;
  activeStreams++;
  return true;
}

function releaseStreamSlot() {
  if (activeStreams > 0) activeStreams--;
}

module.exports = { route, queue, listProviders, resolveProvider, selectProvider, providers, getAliases, getAvailableProviders, acquireStreamSlot, releaseStreamSlot };
