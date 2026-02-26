require('dotenv').config({ quiet: true });

const express = require('express');
const logger = require('./lib/logger');
const { route, listProviders } = require('./router');
const { getHealthStatus } = require('./health');
const { validateCompletionRequest } = require('./middleware/validate');
const { sanitizeInput } = require('./middleware/sanitize');
const { requestLogger } = require('./middleware/logging');
const { requestId } = require('./middleware/request-id');
const { createAuthMiddleware } = require('./middleware/auth');
const { fromCatchable, sendError } = require('./errors');

const app = express();
const PORT = parseInt(process.env.PORT || '6000', 10);
const auth = createAuthMiddleware();

// --- Global middleware (order matters) ---
app.use(express.json());
app.use(requestId);
app.use(requestLogger);

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

  try {
    const result = await route({ model, prompt, system, max_tokens, request_id: req.requestId });
    res.json(result);
  } catch (err) {
    sendError(res, fromCatchable(err, model), req.requestId);
  }
});

// Only start listening when run directly (not when required for testing)
if (require.main === module) {
  app.listen(PORT, () => {
    const authStatus = process.env.SHELLM_CLIENTS ? 'enabled' : 'disabled';
    logger.info({ event: 'server_start', port: PORT, auth: authStatus });
  });
}

module.exports = app;
