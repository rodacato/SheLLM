const { sendError, authRequired, rateLimited } = require('../errors');
const { getDb, findClientByKey } = require('../db');
const logger = require('../lib/logger');

const GLOBAL_RPM = parseInt(process.env.SHELLM_GLOBAL_RPM || '30', 10);
const WINDOW_MS = 60_000;

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

function createAuthMiddleware() {
  // Check if DB has any active clients
  const hasDbClients = () => {
    const db = getDb();
    if (!db) return false;
    const row = db.prepare('SELECT COUNT(*) as count FROM clients WHERE active = 1').get();
    return row.count > 0;
  };

  return (req, res, next) => {
    // If no DB clients, auth is disabled
    if (!hasDbClients()) {
      return next();
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return sendError(res, authRequired(), req.requestId);
    }

    const token = match[1];
    const dbClient = findClientByKey(token);

    if (!dbClient || !dbClient.active) {
      return sendError(res, authRequired(), req.requestId);
    }

    const clientName = dbClient.name;
    const clientRpm = dbClient.rpm;

    // Check global rate limit
    const globalRetry = checkRateLimit(globalTimestamps, GLOBAL_RPM);
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
    next();
  };
}

module.exports = { createAuthMiddleware };
