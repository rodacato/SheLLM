'use strict';

const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const COOKIE_NAME = 'shellm_admin';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Renewed on use, at most once an hour, so a dashboard left polling does not rewrite its cookie
// every few seconds.
const RENEW_AFTER_MS = 60 * 60 * 1000;

let fallbackKey = null;

// Derived from the key-hashing secret so a session cannot be forged from the admin password alone.
function sessionKey() {
  try {
    const { getHmacSecret } = require('../db/clients');
    const secret = getHmacSecret();
    if (secret) return createHmac('sha256', secret).update('admin-session').digest();
  } catch { /* database not ready */ }
  if (!fallbackKey) fallbackKey = randomBytes(32);
  return fallbackKey;
}

function sign(payload) {
  return createHmac('sha256', sessionKey()).update(payload).digest('base64url');
}

function issue(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function expiryOf(value) {
  if (typeof value !== 'string') return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function verify(value, now = Date.now()) {
  const exp = expiryOf(value);
  return exp !== null && exp > now;
}

function needsRenewal(value, now = Date.now()) {
  const exp = expiryOf(value);
  return exp !== null && exp > now && exp - now < TTL_MS - RENEW_AFTER_MS;
}

function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setSession(req, res) {
  res.cookie(COOKIE_NAME, issue(), {
    httpOnly: true,
    // Strict dropped the cookie when an installed app was launched from the home screen, which
    // some browsers treat as arriving from elsewhere. Writes stay guarded by isCrossSiteWrite.
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/admin',
    maxAge: TTL_MS,
  });
}

function clearSession(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req), path: '/admin' });
}

// Sec-Fetch-Site is sent by every browser that honours SameSite; a missing header means a
// non-browser client, which cannot have obtained the cookie in the first place.
function isCrossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const site = req.headers['sec-fetch-site'];
  return !!site && site !== 'same-origin';
}

function wantsHtml(req) {
  return (req.headers.accept || '').includes('text/html');
}

// Only a browser sends the Sec-Fetch metadata headers. Their absence means curl, an SDK or a
// script — the clients a Basic auth challenge is still meant for.
function isBrowserRequest(req) {
  return !!(req.headers['sec-fetch-site'] || req.headers['sec-fetch-mode'] || req.headers['sec-fetch-dest']);
}

module.exports = {
  COOKIE_NAME, TTL_MS, RENEW_AFTER_MS, issue, verify, needsRenewal, readCookie, setSession, clearSession,
  isCrossSiteWrite, wantsHtml, isBrowserRequest,
};
