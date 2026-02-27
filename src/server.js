require('dotenv').config({ quiet: true });

const express = require('express');
const logger = require('./lib/logger');
const { route, listProviders, queue } = require('./router');
const { getHealthStatus } = require('./health');
const { validateCompletionRequest } = require('./middleware/validate');
const { sanitizeInput } = require('./middleware/sanitize');
const { requestLogger } = require('./middleware/logging');
const { requestId } = require('./middleware/request-id');
const { createAuthMiddleware } = require('./middleware/auth');
const { fromCatchable, sendError, invalidRequest } = require('./errors');

const app = express();
const PORT = parseInt(process.env.PORT || '6000', 10);
const auth = createAuthMiddleware();

// --- Global middleware (order matters) ---
app.use(express.json({ limit: '256kb' }));
app.use(requestId);
app.use(requestLogger);

// Validate Content-Type on POST requests
app.use((req, res, next) => {
  if (req.method === 'POST' && !req.is('json')) {
    return sendError(res, invalidRequest('Content-Type must be application/json'), req.requestId);
  }
  next();
});

// --- GET /health (unauthenticated — Docker healthcheck) ---
app.get('/health', async (req, res) => {
  try {
    const status = await getHealthStatus();
    res.json(status);
  } catch (err) {
    sendError(res, { status: 500, code: 'internal_error', message: err.message }, req.requestId);
  }
});

// --- GET /providers (authenticated) ---
app.get('/providers', auth, (_req, res) => {
  res.json({ providers: listProviders() });
});

// --- POST /completions (authenticated) ---
app.post('/completions', auth, sanitizeInput, validateCompletionRequest, async (req, res) => {
  const { model, prompt, system, max_tokens } = req.body;
  const startTime = Date.now();

  // Expose provider/model in res.locals for logging middleware
  res.locals.provider = null;
  res.locals.model = model;

  try {
    const result = await route({ model, prompt, system, max_tokens, request_id: req.requestId });
    res.locals.provider = result.provider;
    // Queue depth headers for consumer-side backpressure
    res.set('X-Queue-Depth', String(queue.stats.pending));
    res.set('X-Queue-Active', String(queue.stats.active));
    res.json(result);
  } catch (err) {
    const errObj = fromCatchable(err, model);
    errObj.duration_ms = Date.now() - startTime;
    sendError(res, errObj, req.requestId);
  }
});

// Graceful shutdown: drain in-flight requests before exiting
function gracefulShutdown(server, signal) {
  logger.info({ event: 'shutdown', signal });
  server.close(() => {
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  });
  // Force exit after 30s if connections don't drain
  setTimeout(() => process.exit(1), 30000).unref();
}

// Only start listening when run directly (not when required for testing)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    const authStatus = process.env.SHELLM_CLIENTS ? 'enabled' : 'disabled';
    logger.info({ event: 'server_start', port: PORT, auth: authStatus });
  });

  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
}

// Export app and gracefulShutdown for CLI foreground mode
module.exports = app;
module.exports.gracefulShutdown = gracefulShutdown;
