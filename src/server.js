require('dotenv').config({ path: require('./cli/paths').CONFIG_FILE, quiet: true });

const http = require('node:http');
const https = require('node:https');
const { readFileSync } = require('node:fs');

const config = require('./config');
const logger = require('./lib/logger');
const { initDb } = require('./db');

// Initialize SQLite (skip if already initialized, e.g. in tests)
initDb();

// Load app after DB is initialized
const app = require('./app');

// HTTP/1.1 over TLS. Express does not survive Node's http2 compat layer — an h2 request kills
// the process in IncomingMessage._read — so a browser that needs more than six connections to
// one host gets HTTP/2 from a reverse proxy, not from here. See docs/guides/usage.md.
function tlsOptions() {
  const cert = config.get('SHELLM_TLS_CERT');
  const key = config.get('SHELLM_TLS_KEY');
  if (!cert || !key) return null;
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

function listen(tls, port, host, onListening) {
  const server = tls ? https.createServer(tls, app) : http.createServer(app);
  server.listen(port, host, () => {
    logger.info({ event: 'server_start', host, port: server.address().port, tls: Boolean(tls) });
    onListening(server);
  });
  return server;
}

const extraListeners = new WeakMap();

// The first address is the one returned and reported; the others listen on the port it got, which
// matters only when that port was 0. Closing the returned server closes them too.
function startServer({ port = config.get('PORT'), host = config.get('HOST') } = {}, onListening) {
  const tls = tlsOptions();
  const [primary, ...others] = [].concat(host);
  const extras = [];
  const server = listen(tls, port, primary, (listening) => {
    for (const address of others) extras.push(listen(tls, listening.address().port, address, () => {}));
    if (onListening) onListening(listening);
  });
  extraListeners.set(server, extras);
  server.on('close', () => extras.forEach((extra) => extra.close()));
  return server;
}

// Graceful shutdown: drain in-flight requests before exiting
let shuttingDown = false;
function gracefulShutdown(server, signal) {
  if (shuttingDown) { process.exit(1); return; }
  shuttingDown = true;
  logger.info({ event: 'shutdown', signal });
  const { stopHealthPoller } = require('./infra/health');
  stopHealthPoller();
  for (const extra of extraListeners.get(server) ?? []) extra.close();
  server.close(() => {
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  });
  // Force exit after 5s if connections don't drain
  setTimeout(() => process.exit(1), 5000).unref();
}

// Only start listening when run directly (not when required for testing)
// /v1/models never waits on a CLI (ADR-0009), so the catalog is read here, off the request path,
// and again each time the cache would expire.
function warmModelCatalog() {
  const { readCatalog } = require('./infra/model-catalog');
  const warm = () => Promise.all(['claude', 'codex'].map((p) => readCatalog(p).catch(() => null)));
  warm();
  setInterval(warm, config.get('SHELLM_MODEL_CATALOG_TTL_MS')).unref();
}

if (require.main === module) {
  const { getHealthStatus, startHealthPoller } = require('./infra/health');

  // Startup health gate: warn about unhealthy providers, then proceed
  getHealthStatus().then((health) => {
    for (const [name, status] of Object.entries(health.providers || {})) {
      if (!status.authenticated) {
        logger.warn({ event: 'startup_provider_warning', provider: name, installed: status.installed, authenticated: false, error: status.error || null });
      }
    }

    const server = startServer({}, startHealthPoller);
    warmModelCatalog();

    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  });
}

// Export app, gracefulShutdown and startServer for CLI foreground mode
module.exports = app;
module.exports.gracefulShutdown = gracefulShutdown;
module.exports.startServer = startServer;
