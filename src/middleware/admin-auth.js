'use strict';

const { timingSafeEqual } = require('node:crypto');
const { sendError, rateLimited } = require('../errors');
const logger = require('../lib/logger');

const ADMIN_MAX_ATTEMPTS = parseInt(process.env.SHELLM_ADMIN_MAX_ATTEMPTS || '5', 10);
const ADMIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Per-IP failed attempt timestamps
const failedAttempts = new Map();

const WEAK_PASSWORDS = new Set([
  'admin', 'password', 'password1', '123456', '12345678',
  '123456789', '1234567890', 'qwerty', 'letmein', 'welcome',
  'monkey', 'dragon', 'master', 'abc123', 'login',
  'admin123', 'root', 'changeme', 'secret', 'test',
]);

function validatePasswordStrength(password) {
  const warnings = [];
  if (password.length < 12) {
    warnings.push(`SHELLM_ADMIN_PASSWORD is only ${password.length} chars (recommend >= 12)`);
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    warnings.push('SHELLM_ADMIN_PASSWORD is a commonly-used weak password');
  }
  return warnings;
}

function isRateLimited(ip) {
  const timestamps = failedAttempts.get(ip);
  if (!timestamps) return 0;

  const now = Date.now();
  const cutoff = now - ADMIN_WINDOW_MS;

  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length === 0) {
    failedAttempts.delete(ip);
    return 0;
  }

  if (timestamps.length >= ADMIN_MAX_ATTEMPTS) {
    const oldestInWindow = timestamps[0];
    return Math.ceil((oldestInWindow + ADMIN_WINDOW_MS - now) / 1000);
  }

  return 0;
}

function recordFailedAttempt(ip) {
  if (!failedAttempts.has(ip)) {
    failedAttempts.set(ip, []);
  }
  failedAttempts.get(ip).push(Date.now());
}

function createAdminAuth() {
  const password = process.env.SHELLM_ADMIN_PASSWORD;
  const expectedUser = process.env.SHELLM_ADMIN_USER || null;

  // Password strength check at startup
  if (password) {
    const warnings = validatePasswordStrength(password);
    for (const msg of warnings) {
      logger.warn({ event: 'admin_password_weak', message: msg });
    }
  }

  if (!password) {
    return (req, res, _next) => {
      sendError(res, { status: 501, code: 'admin_disabled', message: 'SHELLM_ADMIN_PASSWORD not configured' }, req.requestId);
    };
  }

  const expectedBuf = Buffer.from(password);
  const expectedUserBuf = expectedUser ? Buffer.from(expectedUser) : null;

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    // Brute-force protection: check rate limit before credential validation
    const retryAfter = isRateLimited(ip);
    if (retryAfter > 0) {
      logger.warn({ event: 'admin_auth_blocked', ip, reason: 'rate_limited' });
      return sendError(res, rateLimited('Too many failed admin login attempts', retryAfter), req.requestId);
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Basic\s+(.+)$/i);

    if (!match) {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: 'missing_header' });
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Missing or invalid Authorization header' }, req.requestId);
    }

    let decoded;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: 'invalid_encoding' });
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid Basic auth encoding' }, req.requestId);
    }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: 'invalid_format' });
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid Basic auth format' }, req.requestId);
    }

    const username = decoded.slice(0, colonIdx);
    const providedPassword = decoded.slice(colonIdx + 1);
    const providedBuf = Buffer.from(providedPassword);

    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username, reason: 'wrong_password' });
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid credentials' }, req.requestId);
    }

    // Optional username validation
    if (expectedUserBuf) {
      const usernameBuf = Buffer.from(username);
      if (usernameBuf.length !== expectedUserBuf.length || !timingSafeEqual(usernameBuf, expectedUserBuf)) {
        recordFailedAttempt(ip);
        logger.warn({ event: 'admin_auth_failure', ip, username, reason: 'wrong_username' });
        res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
        return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid credentials' }, req.requestId);
      }
    }

    logger.info({ event: 'admin_auth_success', ip, username });
    next();
  };
}

module.exports = { createAdminAuth, failedAttempts, validatePasswordStrength };
