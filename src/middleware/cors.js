'use strict';

// CORS for /v1 only. The admin endpoints are deliberately absent: they answer to a browser
// session, so a cross-origin page must never be able to read them.

const config = require('../config');

const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
].join(', ');

// Everything a browser client needs to read off a response it did not originate the headers for.
const EXPOSED_HEADERS = [
  'request-id',
  'x-request-id',
  'retry-after',
  'x-queue-depth',
  'x-queue-active',
  'x-shellm-queue-ms',
  'x-shellm-queue-position',
  'x-shellm-fallback-provider',
].join(', ');

const MAX_AGE = '600';

function allowedOrigins() {
  return config.get('SHELLM_CORS_ORIGINS');
}

function isAllowedOrigin(origin) {
  return Boolean(origin) && allowedOrigins().includes(origin);
}

// An origin is a scheme, a host and an optional port — nothing else. Comparing a stored value
// that carries a path or a trailing slash against a browser's Origin header never matches, so it
// is rejected when it is written rather than silently locking the key out.
function isValidOrigin(value) {
  if (typeof value !== 'string') return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin === value;
}

function corsV1(req, res, next) {
  // Set before the decision: a cache that saw a denied response must not hand it to an allowed
  // origin later.
  res.vary('Origin');

  if (!isAllowedOrigin(req.headers.origin)) {
    // No CORS headers is what makes the browser refuse the call. A 204 here would read as success
    // in the network tab while the real request never leaves.
    if (req.method === 'OPTIONS') return res.status(403).end();
    return next();
  }

  res.set('Access-Control-Allow-Origin', req.headers.origin);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  res.set('Access-Control-Max-Age', MAX_AGE);

  if (req.method !== 'OPTIONS') return next();

  // Chrome will not let a public https page reach 127.0.0.1 without this opt-in.
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.set('Access-Control-Allow-Private-Network', 'true');
  }
  return res.status(204).end();
}

module.exports = { corsV1, isAllowedOrigin, isValidOrigin, allowedOrigins, ALLOWED_HEADERS, EXPOSED_HEADERS };
