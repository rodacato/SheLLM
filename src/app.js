const express = require('express');
const { getHealthStatus } = require('./infra/health');
const { chatCompletionsHandler } = require('./api/v1/chat-completions');
const { messagesHandler } = require('./api/v1/messages');
const { modelsHandler } = require('./api/v1/models');
const { requestLogger } = require('./middleware/logging');
const { requestId } = require('./middleware/request-id');
const { createAuthMiddleware } = require('./middleware/auth');
const { createAdminAuth } = require('./middleware/admin-auth');
const adminLoginRouter = require('./admin/login');
const adminKeysRouter = require('./admin/keys');
const adminLogsRouter = require('./admin/logs');
const adminStatsRouter = require('./admin/stats');
const adminProvidersRouter = require('./admin/providers');
const { sendApiError, invalidRequest } = require('./errors');
const path = require('node:path');

const app = express();
const auth = createAuthMiddleware();

// --- Global middleware (order matters) ---
app.use(express.json({ limit: '256kb' }));
app.use(requestId);
app.use(requestLogger);

// Validate Content-Type on POST/PATCH requests with body. The login form posts urlencoded.
app.use((req, res, next) => {
  if (req.path.startsWith('/admin/login') || req.path.startsWith('/admin/logout')) return next();
  if ((req.method === 'POST' || req.method === 'PATCH') && req.headers['content-length'] > 0 && !req.is('json')) {
    return sendApiError(req, res, invalidRequest('Content-Type must be application/json'), req.requestId);
  }
  next();
});


// --- API docs (Redocly build output) ---
app.use('/docs', express.static(path.join(__dirname, '..', 'docs')));

// --- Admin auth (created early for /health/detailed) ---
const adminAuth = createAdminAuth();

// --- GET /health (minimal, unauthenticated — Docker healthcheck) ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- GET /health/detailed (full diagnostics, admin auth required) ---
app.get('/health/detailed', adminAuth, async (req, res) => {
  try {
    const status = await getHealthStatus();
    res.json(status);
  } catch (err) {
    sendApiError(req, res, { status: 500, code: 'internal_error', message: err.message }, req.requestId);
  }
});


// --- GET /v1/models (authenticated) ---
app.get('/v1/models', auth, modelsHandler);

// --- POST /v1/chat/completions (authenticated) ---
app.post('/v1/chat/completions', auth, chatCompletionsHandler);

// --- POST /v1/messages (authenticated — Anthropic Messages API format) ---
app.post('/v1/messages', auth, messagesHandler);

// --- Admin routes (Basic auth via SHELLM_ADMIN_PASSWORD) ---
// The SPA's own assets carry no account data; only the page behind them needs a session.
// This mount goes before the authenticated routers, or every asset would answer 401.
app.use('/admin/dashboard', adminSecurityHeaders, express.static(path.join(__dirname, 'admin/public'), {
  index: false,
}));

// PWA files: no account data, and both must sit at /admin/ for the worker to claim that scope
app.get('/admin/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').sendFile(path.join(__dirname, 'admin/public/manifest.webmanifest'));
});
app.get('/admin/sw.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'admin/public/sw.js'));
});

app.use('/admin', adminLoginRouter);
app.use('/admin', adminAuth, adminKeysRouter);
app.use('/admin', adminAuth, adminLogsRouter);
app.use('/admin', adminAuth, adminStatsRouter);
app.use('/admin', adminAuth, adminProvidersRouter);

// Admin health endpoint (detailed, for dashboard)
app.get('/admin/health', adminAuth, async (req, res) => {
  try {
    const status = await getHealthStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      "script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

// The dashboard page itself requires auth
app.get('/admin/dashboard/', adminAuth, adminSecurityHeaders, (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin/public/index.html'));
});

module.exports = app;
