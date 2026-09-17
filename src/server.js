require('dotenv').config({ path: require('./cli/paths').CONFIG_FILE, quiet: true });

const logger = require('./lib/logger');
const { initDb } = require('./db');
const { buildModelMap, seedAliasesFromEnv } = require('./routing');

// Initialize SQLite (skip if already initialized, e.g. in tests)
initDb();

// Build model map from DB and seed env aliases
buildModelMap();
seedAliasesFromEnv();

// Load app after DB is initialized
const app = require('./app');

function startServer({ port = parseInt(process.env.PORT || '6100', 10), host = process.env.HOST || '127.0.0.1' } = {}, onListening) {
  const server = app.listen(port, host, () => {
    logger.info({ event: 'server_start', host, port: server.address().port });
    if (onListening) onListening(server);
  });
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
  server.close(() => {
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  });
  // Force exit after 5s if connections don't drain
  setTimeout(() => process.exit(1), 5000).unref();
}

// Only start listening when run directly (not when required for testing)
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

    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  });
}

// Export app, gracefulShutdown and startServer for CLI foreground mode
module.exports = app;
module.exports.gracefulShutdown = gracefulShutdown;
module.exports.startServer = startServer;
