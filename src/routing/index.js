const { recordSuccess, recordFailure } = require('../infra/circuit-breaker');
const { queue } = require('../infra/queue');
const { acquireStreamSlot, releaseStreamSlot } = require('../infra/stream-slots');
const { engines } = require('./engines');
const { buildModelMap, invalidateModelCache, getAliases, seedAliasesFromEnv } = require('./model-cache');
const { resolveProvider, resolveUpstreamModel, selectProvider, getAvailableProviders } = require('./provider-select');
const { routeWithFallback, listProviders } = require('./fallback');

const FALLBACK_ENABLED = (process.env.SHELLM_FALLBACK_ENABLED || 'false') === 'true';

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
    upstream_model: resolveUpstreamModel(model),
    duration_ms: Date.now() - startTime,
    queued_ms: result.queued_ms,
    request_id: request_id || null,
    ...(result.cost_usd != null && { cost_usd: result.cost_usd }),
    ...(result.usage && { usage: result.usage }),
  };
}

module.exports = {
  route,
  queue,
  listProviders,
  resolveProvider,
  resolveUpstreamModel,
  selectProvider,
  providers: engines,
  engines,
  getAliases,
  getAvailableProviders,
  acquireStreamSlot,
  releaseStreamSlot,
  buildModelMap,
  invalidateModelCache,
  seedAliasesFromEnv,
};
