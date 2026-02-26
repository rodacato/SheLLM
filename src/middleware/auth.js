const { timingSafeEqual } = require('node:crypto');
const { sendError, authRequired, rateLimited } = require('../errors');
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

function createAuthMiddleware() {
  const clients = loadClients();

  if (!clients) {
    return (_req, _res, next) => next();
  }

  // Pre-compute key buffers for timing-safe comparison
  const keyBuffers = new Map();
  for (const [key, client] of clients) {
    keyBuffers.set(key, { buffer: Buffer.from(key), client });
  }

  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return sendError(res, authRequired(), req.requestId);
    }

    const token = match[1];
    const tokenBuffer = Buffer.from(token);

    // Find matching client (timing-safe)
    let matched = null;
    for (const [, entry] of keyBuffers) {
      if (entry.buffer.length === tokenBuffer.length &&
          timingSafeEqual(entry.buffer, tokenBuffer)) {
        matched = entry.client;
        break;
      }
    }

    if (!matched) {
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
    const clientRetry = checkRateLimit(matched.timestamps, matched.rpm);
    if (clientRetry > 0) {
      return sendError(
        res,
        rateLimited(`Rate limit exceeded for client: ${matched.name}`, clientRetry),
        req.requestId,
      );
    }

    req.clientName = matched.name;
    next();
  };
}

function getClientCount() {
  const clients = loadClients();
  return clients ? clients.size : 0;
}

module.exports = { createAuthMiddleware, loadClients };
