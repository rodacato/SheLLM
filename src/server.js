require('dotenv').config({ quiet: true });

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
const PORT = parseInt(process.env.PORT || '6100', 10);

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

    const server = app.listen(PORT, () => {
      logger.info({ event: 'server_start', port: PORT });
      startHealthPoller();
    });

    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  });
}

// Export app and gracefulShutdown for CLI foreground mode
module.exports = app;
module.exports.gracefulShutdown = gracefulShutdown;
