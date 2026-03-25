const claude = require('../providers/claude');
const gemini = require('../providers/gemini');
const codex = require('../providers/codex');
const logger = require('../lib/logger');

// Execution engines — keyed by provider name for chat/chatStream dispatch
// Hardcoded engines for subprocess providers only; HTTP providers registered from DB
const engines = { claude, gemini, codex };

// Register DB-only HTTP providers as generic engines
function registerHttpProviders() {
  try {
    const { getProviders, getDb } = require('../db');
    if (!getDb()) return;
    const { createHttpProvider } = require('../providers/http-generic');
    const dbProviders = getProviders();
    for (const p of dbProviders) {
      if (p.type === 'http' && !engines[p.name]) {
        engines[p.name] = createHttpProvider(p);
        logger.info({ event: 'http_provider_registered', provider: p.name });
      }
    }
  } catch { /* ignore */ }
}

module.exports = { engines, registerHttpProviders };
