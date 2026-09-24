const express = require('express');
const { getHealthStatus } = require('./infra/health');
const { chatCompletionsHandler } = require('./api/v1/chat-completions');
const { messagesHandler } = require('./api/v1/messages');
const { modelsHandler } = require('./api/v1/models');
const { requestLogger } = require('./middleware/logging');
const { requestId } = require('./middleware/request-id');
const { createAuthMiddleware } = require('./middleware/auth');
const { corsV1 } = require('./middleware/cors');
const config = require('./config');
const { createAdminAuth } = require('./middleware/admin-auth');
const adminLoginRouter = require('./admin/login');
const adminKeysRouter = require('./admin/keys');
const adminLogsRouter = require('./admin/logs');
const adminStatsRouter = require('./admin/stats');
const adminProvidersRouter = require('./admin/providers');
const adminUpdateRouter = require('./admin/update');
const adminConfigRouter = require('./admin/config');
const { dashboardHtml } = require('./admin/views');
const { wantsHtml } = require('./middleware/admin-session');
const { sendApiError, invalidRequest, notFound, payloadTooLarge } = require('./errors');
const path = require('node:path');

const app = express();
app.disable('x-powered-by');

// Off by default: with no proxy in front, an X-Forwarded-For header is whatever the caller wrote,
// and the admin login lockout counts per IP. Set it only when something really does sit in front.
const trustProxy = config.get('SHELLM_TRUST_PROXY');
if (trustProxy) {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? parseInt(trustProxy, 10) : trustProxy);
}

const auth = createAuthMiddleware();

// Every static file is served relative to this root rather than by absolute path: send() refuses
// any path with a dot-directory in it, so an absolute one makes the answer depend on where the
// checkout happens to live.
const ADMIN_PUBLIC = path.join(__dirname, 'admin/public');

const CHAT_PATH = '/v1/chat/completions';
const smallJson = express.json({ limit: '256kb' });
const chatBodyLimit = config.get('SHELLM_MAX_CHAT_BODY_BYTES');
const chatJson = express.json({ limit: chatBodyLimit });

// Images make chat bodies large, so that one route parses after the key is checked: a caller
// without a key never gets more than a header read. Any other spelling of the path falls back to
// the small limit, which fails safe.
function parseChatBody(req, res, next) {
  chatJson(req, res, (err) => {
    if (err?.type !== 'entity.too.large') return next(err);
    sendApiError(req, res, payloadTooLarge(
      `Request body exceeds ${chatBodyLimit} bytes; send fewer or smaller images`,
    ), req.requestId);
  });
}

// --- Global middleware (order matters) ---
app.use((req, res, next) => (req.path === CHAT_PATH ? next() : smallJson(req, res, next)));
app.use(requestId);
app.use(requestLogger);

// Before the auth routes: a browser sends no Authorization header on a preflight.
app.use('/v1', corsV1);

// Validate Content-Type on POST/PATCH requests with body. The login form posts urlencoded.
app.use((req, res, next) => {
  if (req.path.startsWith('/admin/login') || req.path.startsWith('/admin/logout')) return next();
  if ((req.method === 'POST' || req.method === 'PATCH') && req.headers['content-length'] > 0 && !req.is('json')) {
    return sendApiError(req, res, invalidRequest('Content-Type must be application/json'), req.requestId);
  }
  next();
});


// --- GET / (a browser lands on the dashboard, which bounces it to the login without a session) ---
// Anything else is an API client on the base URL: it falls through to the 404 its SDK can parse.
app.get('/', (req, res, next) => {
  if (!wantsHtml(req)) return next();
  res.redirect(302, '/admin/dashboard/');
});

// --- GET /docs/openapi.json (the bundled spec, so tooling can read it off a live instance) ---
app.get('/docs/openapi.json', (_req, res) => {
  res.type('application/json').sendFile('bundled.json', { root: path.join(__dirname, '..', 'docs/api') });
});

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
app.post(CHAT_PATH, auth, parseChatBody, chatCompletionsHandler);

// --- POST /v1/messages (authenticated — Anthropic Messages API format) ---
app.post('/v1/messages', auth, messagesHandler);

// --- Admin routes (Basic auth via SHELLM_ADMIN_PASSWORD) ---
// The SPA's own assets carry no account data; only the page behind them needs a session.
// This mount goes before the authenticated routers, or every asset would answer 401.
app.use('/admin/dashboard', adminSecurityHeaders, express.static(ADMIN_PUBLIC, {
  index: false,
}));

// PWA files: no account data, and both must sit at /admin/ for the worker to claim that scope
app.get('/admin/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').sendFile('manifest.webmanifest', { root: ADMIN_PUBLIC });
});
app.get('/admin/sw.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile('sw.js', { root: ADMIN_PUBLIC });
});

app.use('/admin', adminLoginRouter);
app.use('/admin', adminAuth, adminKeysRouter);
app.use('/admin', adminAuth, adminLogsRouter);
app.use('/admin', adminAuth, adminStatsRouter);
app.use('/admin', adminAuth, adminProvidersRouter);
app.use('/admin', adminAuth, adminUpdateRouter);
app.use('/admin', adminAuth, adminConfigRouter);

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
      // The System page asks GitHub for the newest release from the browser, so the service
      // needs no outbound network to report what it is running.
      "connect-src 'self' https://api.github.com",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

// `/admin` is the address the README and `shellm init` print; the page lives one level down.
app.get('/admin', adminAuth, (_req, res) => {
  res.redirect(302, '/admin/dashboard/');
});

// The dashboard page itself requires auth
app.get('/admin/dashboard/', adminAuth, adminSecurityHeaders, (_req, res) => {
  res.type('html').send(dashboardHtml());
});

// Last: an unmatched route reaches Express's own handler otherwise, which answers HTML to a
// caller that asked for JSON.
app.use((req, res) => {
  sendApiError(req, res, notFound(req.method, req.path.slice(0, 100)), req.requestId);
});

module.exports = app;
