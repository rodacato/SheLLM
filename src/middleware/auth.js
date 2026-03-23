const { sendError, authRequired, rateLimited } = require('../errors');
const { findClientByKey, listClients } = require('../db');
const logger = require('../lib/logger');

// Dynamic: reads from DB > env > default (30)
function getGlobalRpm() {
  try {
    const { getSetting } = require('../db/settings');
    return getSetting('global_rpm');
  } catch {
    return parseInt(process.env.SHELLM_GLOBAL_RPM || '30', 10);
  }
}
const WINDOW_MS = 60_000;
const REQUIRE_AUTH = process.env.SHELLM_REQUIRE_AUTH !== 'false';
const AUTH_ALERT_THRESHOLD = parseInt(process.env.SHELLM_AUTH_ALERT_THRESHOLD || '10', 10);

// Track auth failures for alerting
const authFailureTimestamps = [];

// Sliding window: count requests in the last 60 seconds
const globalTimestamps = [];

// Per-client rate limit timestamps (keyed by client name, shared across DB clients)
const clientTimestamps = new Map();

function checkRateLimit(timestamps, maxRpm) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Remove old entries
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= maxRpm) {
    const oldestInWindow = timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
    return retryAfter;
  }

  timestamps.push(now);
  return 0;
}

function getOrCreateTimestamps(clientName) {
  if (!clientTimestamps.has(clientName)) {
    clientTimestamps.set(clientName, []);
  }
  return clientTimestamps.get(clientName);
}

function recordAuthFailure() {
  const now = Date.now();
  authFailureTimestamps.push(now);
  // Prune old entries
  while (authFailureTimestamps.length > 0 && authFailureTimestamps[0] < now - WINDOW_MS) {
    authFailureTimestamps.shift();
  }
  if (authFailureTimestamps.length >= AUTH_ALERT_THRESHOLD) {
    sendAuthAlert(authFailureTimestamps.length);
    authFailureTimestamps.length = 0; // Reset after alert
  }
}

function sendAuthAlert(count) {
  const webhookUrl = process.env.SHELLM_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  logger.warn({ event: 'auth_failure_spike', count });
  const payload = {
    text: `[SheLLM] Auth failure spike: ${count} failures in the last minute`,
    event: 'auth_failure_spike',
    count,
    timestamp: new Date().toISOString(),
  };
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

function createAuthMiddleware() {
  // Startup warning: no keys in production
  if (REQUIRE_AUTH && process.env.NODE_ENV === 'production') {
    try {
      const clients = listClients();
      if (clients.length === 0) {
        logger.error({ event: 'auth_no_keys', message: 'CRITICAL: No API keys configured in production. All requests will be rejected until keys are created via /admin/keys.' });
      }
    } catch { /* DB may not be ready yet */ }
  }

  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      // Dev mode: allow anonymous access when no keys exist and auth not required
      if (!REQUIRE_AUTH) {
        try {
          const clients = listClients();
          if (clients.length === 0) {
            req.clientName = '_anonymous';
            req.allowedModels = null;
            return next();
          }
        } catch { /* fall through to reject */ }
      }
      recordAuthFailure();
      return sendError(res, authRequired(), req.requestId);
    }

    const token = match[1];
    const dbClient = findClientByKey(token);

    if (!dbClient || !dbClient.active) {
      recordAuthFailure();
      return sendError(res, authRequired(), req.requestId);
    }

    const clientName = dbClient.name;
    const clientRpm = dbClient.rpm;

    // Check global rate limit
    const globalRetry = checkRateLimit(globalTimestamps, getGlobalRpm());
    if (globalRetry > 0) {
      return sendError(
        res,
        rateLimited('Global rate limit exceeded', globalRetry),
        req.requestId,
      );
    }

    // Check per-client rate limit
    const timestamps = getOrCreateTimestamps(clientName);
    const clientRetry = checkRateLimit(timestamps, clientRpm);
    if (clientRetry > 0) {
      return sendError(
        res,
        rateLimited(`Rate limit exceeded for client: ${clientName}`, clientRetry),
        req.requestId,
      );
    }

    req.clientName = clientName;
    req.allowedModels = dbClient.models || null;
    req.safetyLevel = dbClient.safety_level || 'strict';
    next();
  };
}

module.exports = { createAuthMiddleware, authFailureTimestamps };
