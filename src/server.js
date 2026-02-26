const express = require('express');
const { route, listProviders } = require('./router');
const { getHealthStatus } = require('./health');
const { validateCompletionRequest } = require('./middleware/validate');
const { sanitizeInput } = require('./middleware/sanitize');
const { requestLogger } = require('./middleware/logging');

const app = express();
const PORT = parseInt(process.env.PORT || '6000', 10);

app.use(express.json());
app.use(requestLogger);

// --- POST /completions ---
app.post('/completions', sanitizeInput, validateCompletionRequest, async (req, res) => {
  const { model, prompt, system, max_tokens, request_id } = req.body;

  try {
    const result = await route({ model, prompt, system, max_tokens, request_id });
    res.json(result);
  } catch (err) {
    if (err.timeout) {
      return res.status(504).json({
        error: 'timeout',
        message: `${model}: process killed after timeout`,
        request_id: request_id || null,
      });
    }
    if (err.provider_unavailable) {
      return res.status(503).json({
        error: 'provider_unavailable',
        message: err.message,
        request_id: request_id || null,
      });
    }
    if (err.status === 429) {
      return res.status(429).json({
        error: 'rate_limited',
        message: err.message,
        request_id: request_id || null,
      });
    }
    if (err.status === 400) {
      return res.status(400).json({
        error: 'invalid_request',
        message: err.message,
        request_id: request_id || null,
      });
    }

    // CLI execution failure
    const stderr = err.stderr || err.message || 'Unknown error';
    res.status(502).json({
      error: 'cli_failed',
      message: `${model}: ${stderr}`.slice(0, 500),
      request_id: request_id || null,
    });
  }
});

// --- GET /health ---
app.get('/health', async (_req, res) => {
  try {
    const status = await getHealthStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// --- GET /providers ---
app.get('/providers', (_req, res) => {
  res.json({ providers: listProviders() });
});

// Only start listening when run directly (not when required for testing)
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`SheLLM listening on :${PORT}`);
  });
}

module.exports = app;
