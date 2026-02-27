'use strict';

const { timingSafeEqual } = require('node:crypto');
const { sendError } = require('../errors');

function createAdminAuth() {
  const password = process.env.SHELLM_ADMIN_PASSWORD;

  if (!password) {
    return (req, res, _next) => {
      sendError(res, { status: 501, code: 'admin_disabled', message: 'SHELLM_ADMIN_PASSWORD not configured' }, req.requestId);
    };
  }

  const expectedBuf = Buffer.from(password);

  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const match = header.match(/^Basic\s+(.+)$/i);

    if (!match) {
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Missing or invalid Authorization header' }, req.requestId);
    }

    let decoded;
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid Basic auth encoding' }, req.requestId);
    }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid Basic auth format' }, req.requestId);
    }

    const providedPassword = decoded.slice(colonIdx + 1);
    const providedBuf = Buffer.from(providedPassword);

    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      res.set('WWW-Authenticate', 'Basic realm="shellm-admin"');
      return sendError(res, { status: 401, code: 'auth_required', message: 'Invalid credentials' }, req.requestId);
    }

    next();
  };
}

module.exports = { createAdminAuth };
