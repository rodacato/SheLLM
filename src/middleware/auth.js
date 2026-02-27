const { timingSafeEqual } = require('node:crypto');
const { sendError, authRequired, rateLimited } = require('../errors');
const { getDb, findClientByKey } = require('../db');
const logger = require('../lib/logger');

const GLOBAL_RPM = parseInt(process.env.SHELLM_GLOBAL_RPM || '30', 10);
const WINDOW_MS = 60_000;

function loadClients() {
  const raw = process.env.SHELLM_CLIENTS;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const clients = new Map();
    for (const [name, config] of Object.entries(parsed)) {
      clients.set(config.key, {
        name,
        rpm: config.rpm || 10,
        timestamps: [],
      });
    }
    return clients;
  } catch {
    logger.warn({ event: 'config_error', message: 'Failed to parse SHELLM_CLIENTS — auth disabled' });
    return null;
  }
}

// Sliding window: count requests in the last 60 seconds
const globalTimestamps = [];

// Per-client rate limit timestamps (keyed by client name, shared across DB + env clients)
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
  const envClients = loadClients();

  // Pre-compute key buffers for env-based timing-safe comparison
  let keyBuffers = null;
  if (envClients) {
    keyBuffers = new Map();
    for (const [key, client] of envClients) {
      keyBuffers.set(key, { buffer: Buffer.from(key), client });
    }
  }

  // No auth at all: no DB clients, no env clients
  const hasDb = () => {
    const db = getDb();
    if (!db) return false;
    const row = db.prepare('SELECT COUNT(*) as count FROM clients WHERE active = 1').get();
    return row.count > 0;
  };

  return (req, res, next) => {
    // If no env clients and no DB clients, auth is disabled
    if (!keyBuffers && !hasDb()) {
      return next();
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return sendError(res, authRequired(), req.requestId);
    }

    const token = match[1];
    let clientName = null;
    let clientRpm = 10;

    // Try DB first
    const db = getDb();
    if (db) {
      const dbClient = findClientByKey(token);
      if (dbClient && dbClient.active) {
        clientName = dbClient.name;
        clientRpm = dbClient.rpm;
      }
    }

    // Fall back to env var clients (timing-safe)
    if (!clientName && keyBuffers) {
      const tokenBuffer = Buffer.from(token);
      for (const [, entry] of keyBuffers) {
        if (entry.buffer.length === tokenBuffer.length &&
            timingSafeEqual(entry.buffer, tokenBuffer)) {
          clientName = entry.client.name;
          clientRpm = entry.client.rpm;
          break;
        }
      }
    }

    if (!clientName) {
      return sendError(res, authRequired(), req.requestId);
    }

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
