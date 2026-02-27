'use strict';

const logger = require('../lib/logger');

const QUIET_PATHS = ['/health'];

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const entry = {
      event: 'request',
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration_ms: Date.now() - start,
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
  });

  next();
}

module.exports = { requestLogger };
