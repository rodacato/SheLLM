const claude = require('./providers/claude');
const gemini = require('./providers/gemini');
const codex = require('./providers/codex');
const cerebras = require('./providers/cerebras');
const { invalidRequest, rateLimited, providerUnavailable } = require('./errors');
const { canSendTraffic, recordSuccess, recordFailure } = require('./circuit-breaker');
const logger = require('./lib/logger');

// Execution engines — keyed by provider name for chat/chatStream dispatch
const engines = { claude, gemini, codex, cerebras };

// Model-to-provider map — built from DB, rebuilt on invalidation
let modelToProvider = {};
let _modelCacheBuilt = false;

function buildModelMap() {
  try {
    const { getAllModels, getDb } = require('./db');
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
    const { getAllModels } = require('./db');
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
    const { getModelByName, upsertModel } = require('./db');
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

function getMaxConcurrent() {
  try { const { getSetting } = require('./db/settings'); return getSetting('max_concurrent'); }
  catch { return parseInt(process.env.MAX_CONCURRENT || '2', 10); }
}
function getMaxQueueDepth() {
  try { const { getSetting } = require('./db/settings'); return getSetting('max_queue_depth'); }
  catch { return parseInt(process.env.MAX_QUEUE_DEPTH || '10', 10); }
}
const FALLBACK_ENABLED = (process.env.SHELLM_FALLBACK_ENABLED || 'false') === 'true';
const FALLBACK_ORDER_ENV = process.env.SHELLM_FALLBACK_ORDER || null;
const MAX_STREAM_CONCURRENT = parseInt(process.env.MAX_STREAM_CONCURRENT || '2', 10);

let activeStreams = 0;

class RequestQueue {
  constructor() {
    this.active = 0;
    this.pending = [];
  }

  async enqueue(fn) {
    if (this.pending.length >= getMaxQueueDepth()) {
      logger.warn({ event: 'queue_full', active: this.active, pending: this.pending.length });
      throw rateLimited('Queue is full, try again later');
    }

    if (this.active >= getMaxConcurrent()) {
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
      max_concurrent: getMaxConcurrent(),
      active_streams: activeStreams,
      max_stream_concurrent: MAX_STREAM_CONCURRENT,
    };
  }
}

const queue = new RequestQueue();

function resolveProvider(model) {
  if (!_modelCacheBuilt) buildModelMap();
  // Direct engine name match
  if (engines[model]) return engines[model];
  // Model-to-provider map (from DB)
  const providerName = modelToProvider[model];
  if (providerName && engines[providerName]) return engines[providerName];
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
  return Object.values(engines)
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

  // Build candidate list: primary first, then by priority (from DB or env)
  const candidates = [primary];
  let fallbackNames;
  if (FALLBACK_ORDER_ENV) {
    fallbackNames = FALLBACK_ORDER_ENV.split(',').map((s) => s.trim());
  } else {
    try {
      const { getProviders } = require('./db');
      fallbackNames = getProviders().map((p) => p.name);
    } catch {
      fallbackNames = Object.keys(engines);
    }
  }
  for (const name of fallbackNames) {
    if (engines[name] && engines[name].name !== primary.name) {
      candidates.push(engines[name]);
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
  try {
    const { getProviders, getModelsForProvider, getDb } = require('./db');
    if (!getDb()) throw new Error('DB not initialized');
    const dbProviders = getProviders();
    return dbProviders
      .filter((p) => includeDisabled || p.enabled)
      .map((p) => ({
        name: p.name,
        type: p.type,
        models: getModelsForProvider(p.name).map((m) => m.name),
        ...p.capabilities,
        enabled: !!p.enabled,
        priority: p.priority,
      }));
  } catch {
    // DB not initialized (tests) — fall back to engines
    return Object.values(engines).map((p) => ({
      name: p.name,
      models: p.validModels || [],
      ...(p.capabilities || {}),
      enabled: true,
    }));
  }
}

function acquireStreamSlot() {
  if (activeStreams >= MAX_STREAM_CONCURRENT) return false;
  activeStreams++;
  return true;
}

function releaseStreamSlot() {
  if (activeStreams > 0) activeStreams--;
}

module.exports = { route, queue, listProviders, resolveProvider, selectProvider, providers: engines, engines, getAliases, getAvailableProviders, acquireStreamSlot, releaseStreamSlot, buildModelMap, invalidateModelCache, seedAliasesFromEnv };
