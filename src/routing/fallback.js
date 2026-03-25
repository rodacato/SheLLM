const { invalidRequest, providerUnavailable } = require('../errors');
const { recordSuccess, recordFailure } = require('../infra/circuit-breaker');
const { queue } = require('../infra/queue');
const { engines } = require('./engines');
const { resolveProvider, resolveUpstreamModel, checkProviderAvailability, getAvailableProviders } = require('./provider-select');
const logger = require('../lib/logger');

const FALLBACK_ORDER_ENV = process.env.SHELLM_FALLBACK_ORDER || null;

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
      const { getProviders } = require('../db');
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
        upstream_model: resolveUpstreamModel(model),
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
    const { getProviders, getModelsForProvider, getDb } = require('../db');
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

module.exports = { routeWithFallback, listProviders };
