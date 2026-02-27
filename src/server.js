require('dotenv').config({ quiet: true });

const express = require('express');
const logger = require('./lib/logger');
const { getHealthStatus } = require('./health');
const { chatCompletionsHandler } = require('./v1/chat-completions');
const { messagesHandler } = require('./v1/messages');
const { modelsHandler } = require('./v1/models');
const { requestLogger } = require('./middleware/logging');
const { requestId } = require('./middleware/request-id');
const { createAuthMiddleware } = require('./middleware/auth');
const { createAdminAuth } = require('./middleware/admin-auth');
const adminKeysRouter = require('./admin/keys');
const adminLogsRouter = require('./admin/logs');
const adminStatsRouter = require('./admin/stats');
const { initDb } = require('./db');
const { sendError, invalidRequest } = require('./errors');
const path = require('node:path');

// Initialize SQLite (skip if already initialized, e.g. in tests)
initDb();

const app = express();
const PORT = parseInt(process.env.PORT || '6100', 10);
const auth = createAuthMiddleware();

// --- Global middleware (order matters) ---
app.use(express.json({ limit: '256kb' }));
app.use(requestId);
app.use(requestLogger);

// Validate Content-Type on POST/PATCH requests with body
app.use((req, res, next) => {
  if ((req.method === 'POST' || req.method === 'PATCH') && req.headers['content-length'] > 0 && !req.is('json')) {
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

// --- GET /v1/models (authenticated) ---
app.get('/v1/models', auth, modelsHandler);

// --- POST /v1/chat/completions (authenticated) ---
app.post('/v1/chat/completions', auth, chatCompletionsHandler);

// --- POST /v1/messages (authenticated — Anthropic Messages API format) ---
app.post('/v1/messages', auth, messagesHandler);

// --- Admin routes (Basic auth via SHELLM_ADMIN_PASSWORD) ---
const adminAuth = createAdminAuth();
app.use('/admin', adminAuth, adminKeysRouter);
app.use('/admin', adminAuth, adminLogsRouter);
app.use('/admin', adminAuth, adminStatsRouter);

// Admin models endpoint (avoids needing Bearer auth for dashboard)
app.get('/admin/models', adminAuth, modelsHandler);

// Security headers for admin dashboard
function adminSecurityHeaders(req, res, next) {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

// Static dashboard files
app.use('/admin/dashboard', adminAuth, adminSecurityHeaders, express.static(path.join(__dirname, 'admin/public')));

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
