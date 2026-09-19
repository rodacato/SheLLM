'use strict';

const { timingSafeEqual } = require('node:crypto');
const { sendError, rateLimited } = require('../errors');
const { verify, readCookie, isCrossSiteWrite, wantsHtml, isBrowserRequest } = require('./admin-session');
const logger = require('../lib/logger');

function getAdminMaxAttempts() {
  return parseInt(process.env.SHELLM_ADMIN_MAX_ATTEMPTS || '5', 10);
}
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

  if (timestamps.length >= getAdminMaxAttempts()) {
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

let credentials = { password: undefined, expectedUser: null };

// Read from the environment and drop the password from it, so a subprocess cannot inherit it.
// Called once at boot; the login route reuses what it captured.
function loadCredentials() {
  credentials = {
    password: process.env.SHELLM_ADMIN_PASSWORD,
    expectedUser: process.env.SHELLM_ADMIN_USER || null,
  };
  delete process.env.SHELLM_ADMIN_PASSWORD;
  return credentials;
}

function matches(provided, expected) {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

function checkCredentials(username, password) {
  const { password: expected, expectedUser } = credentials;
  if (!expected || !matches(password, expected)) return false;
  return !expectedUser || matches(username, expectedUser);
}

function adminEnabled() {
  return !!credentials.password;
}

// A browser answers this header with its native credential prompt, which is not the admin login
// page and cannot renew a session cookie.
function challenge(req, res) {
  if (!isBrowserRequest(req)) res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
}

function createAdminAuth() {
  const { password, expectedUser } = loadCredentials();

  // Password strength check at startup
  if (password) {
    const warnings = validatePasswordStrength(password);
    for (const msg of warnings) {
      logger.warn({ event: 'admin_password_weak', message: msg });
    }
    // F-04: Refuse to start with weak password in production
    if (process.env.NODE_ENV === 'production' && warnings.length > 0) {
      throw new Error(`Refusing to start: admin password is too weak. ${warnings.join('; ')}`);
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

    if (verify(readCookie(req))) {
      if (isCrossSiteWrite(req)) {
        logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: 'cross_site' });
        return sendError(res, { status: 403, code: 'forbidden', message: 'Cross-site request refused' }, req.requestId);
      }
      return next();
    }

    // Brute-force protection: check rate limit before credential validation
    const retryAfter = isRateLimited(ip);
    if (retryAfter > 0) {
      logger.warn({ event: 'admin_auth_blocked', ip, reason: 'rate_limited' });
      return sendError(res, rateLimited('Too many failed admin login attempts', retryAfter), req.requestId);
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Basic\s+(.+)$/i);

    if (!match) {
      if (wantsHtml(req)) return res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
      // No credentials were offered, so there is nothing to guess and nothing to rate limit.
      // Counting it would let the dashboard's own polling lock the maintainer out once its
      // session cookie expires.
      const expired = !!readCookie(req);
      logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: expired ? 'session_expired' : 'missing_header' });
      challenge(req, res);
      const message = expired ? 'Admin session expired' : 'Missing or invalid Authorization header';
      return sendError(res, { status: 401, code: 'auth_required', message }, req.requestId);
    }

    let decoded;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: 'invalid_encoding' });
      challenge(req, res);
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid Basic auth encoding' }, req.requestId);
    }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username: null, reason: 'invalid_format' });
      challenge(req, res);
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid Basic auth format' }, req.requestId);
    }

    const username = decoded.slice(0, colonIdx);
    const providedPassword = decoded.slice(colonIdx + 1);
    const providedBuf = Buffer.from(providedPassword);

    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      recordFailedAttempt(ip);
      logger.warn({ event: 'admin_auth_failure', ip, username, reason: 'wrong_password' });
      challenge(req, res);
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid credentials' }, req.requestId);
    }

    // Optional username validation
    if (expectedUserBuf) {
      const usernameBuf = Buffer.from(username);
      if (usernameBuf.length !== expectedUserBuf.length || !timingSafeEqual(usernameBuf, expectedUserBuf)) {
        recordFailedAttempt(ip);
        logger.warn({ event: 'admin_auth_failure', ip, username, reason: 'wrong_username' });
        challenge(req, res);
        return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid credentials' }, req.requestId);
      }
    }

    logger.info({ event: 'admin_auth_success', ip, username });
    next();
  };
}

module.exports = {
  createAdminAuth, failedAttempts, validatePasswordStrength,
  isRateLimited, recordFailedAttempt, checkCredentials, adminEnabled,
};
