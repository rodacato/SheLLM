'use strict';

const logger = require('../lib/logger');
const { getDb, insertRequestLog } = require('../db');

const QUIET_PATHS = ['/health'];

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

    // Persist /v1/* requests to SQLite
    if (req.url.startsWith('/v1/') && getDb()) {
      const usage = res.locals.usage;
      insertRequestLog({
        request_id: req.requestId || null,
        client_name: req.clientName || null,
        provider: res.locals.provider || null,
        model: res.locals.model || null,
        status: res.statusCode,
        duration_ms,
        queued_ms: res.locals.queued_ms || null,
        tokens: usage ? ((usage.input_tokens || 0) + (usage.output_tokens || 0)) : null,
        cost_usd: res.locals.cost_usd || null,
      });
    }
  });

  next();
}

module.exports = { requestLogger };
