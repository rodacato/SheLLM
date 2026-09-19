'use strict';

const logger = require('../lib/logger');
const { getDb, insertRequestLog } = require('../db');

const QUIET_PATHS = ['/health'];

// Cache reads and writes are billed and dominate the count; summing only in/out under-reports
// a cached request by orders of magnitude and stops `tokens` from matching `cost_usd`.
function billableTokens(usage) {
  if (!usage) return null;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration_ms = Date.now() - start;
    const entry = {
      event: 'request',
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration_ms,
      request_id: req.requestId || null,
      client: req.clientName || null,
      provider: res.locals.provider || null,
      model: res.locals.model || null,
    };

    if (res.statusCode >= 500) {
      logger.error(entry);
    } else if (res.statusCode >= 400) {
      logger.warn(entry);
    } else if (QUIET_PATHS.some((p) => req.url.startsWith(p))) {
      logger.debug(entry);
    } else {
      logger.info(entry);
    }

    // Persist /v1/* requests to SQLite and emit for live feed
    if (req.url.startsWith('/v1/') && getDb()) {
      const usage = res.locals.usage;
      const metrics = res.locals.metrics || {};
      insertRequestLog({
        request_id: req.requestId || null,
        client_name: req.clientName || null,
        provider: res.locals.provider || null,
        model: res.locals.model || null,
        status: res.statusCode,
        duration_ms,
        queued_ms: res.locals.queued_ms || null,
        tokens: billableTokens(usage),
        cost_usd: res.locals.cost_usd || null,
        tokens_in: usage?.input_tokens ?? null,
        tokens_out: usage?.output_tokens ?? null,
        cache_write_tokens: usage?.cache_creation_input_tokens ?? null,
        cache_read_tokens: usage?.cache_read_input_tokens ?? null,
        ttft_ms: metrics.ttft_ms ?? null,
        api_ms: metrics.api_ms ?? null,
        upstream_model: metrics.upstream_model ?? null,
        streamed: res.locals.streamed ? 1 : 0,
        api_error_status: metrics.api_error_status ?? null,
      });
    }
  });

  next();
}

module.exports = { requestLogger };
