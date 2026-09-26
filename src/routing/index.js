const { recordSuccess, recordFailure } = require('../infra/circuit-breaker');
const { isClientError } = require('../errors');
const { queue } = require('../infra/queue');
const { acquireStreamSlot, releaseStreamSlot } = require('../infra/stream-slots');
const { engines } = require('./engines');
const { resolveProvider, selectProvider, getAvailableProviders } = require('./provider-select');
const { routeWithFallback, listProviders } = require('./fallback');
const config = require('../config');

const FALLBACK_ENABLED = config.get('SHELLM_FALLBACK_ENABLED');

async function route({ model, prompt, parts, system, max_tokens, temperature, top_p, response_format, effort, longContext, request_id, allowFallback, job }) {
  const useFallback = allowFallback ?? FALLBACK_ENABLED;
  if (useFallback) {
    return routeWithFallback({ model, prompt, parts, system, max_tokens, temperature, top_p, response_format, effort, longContext, request_id, job });
  }

  const provider = selectProvider(model);
  const startTime = Date.now();

  let result;
  try {
    result = await queue.enqueue(({ queued_ms, position }) => {
      return provider.chat({ prompt, parts, system, max_tokens, temperature, top_p, response_format, effort, longContext, model })
        .then((r) => ({ ...r, queued_ms, queue_position: position }));
    }, { ...job, provider: provider.name, model: model || provider.name });
    recordSuccess(provider.name);
  } catch (err) {
    if (!isClientError(err)) recordFailure(provider.name);
    throw err;
  }

  return {
    content: result.content,
    provider: provider.name,
    model,
    duration_ms: Date.now() - startTime,
    queued_ms: result.queued_ms,
    queue_position: result.queue_position,
    request_id: request_id || null,
    ...(result.cost_usd != null && { cost_usd: result.cost_usd }),
    ...(result.usage && { usage: result.usage }),
    ...(result.metrics && { metrics: result.metrics }),
  };
}

module.exports = {
  route,
  queue,
  listProviders,
  resolveProvider,
  selectProvider,
  providers: engines,
  engines,
  getAvailableProviders,
  acquireStreamSlot,
  releaseStreamSlot,
};
