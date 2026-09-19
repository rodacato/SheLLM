'use strict';

const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const COOKIE_NAME = 'shellm_admin';
const TTL_MS = 12 * 60 * 60 * 1000;

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

function verify(value, now = Date.now()) {
  if (typeof value !== 'string') return false;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return false;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return false;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now;
  } catch {
    return false;
  }
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
    sameSite: 'strict',
    secure: isSecureRequest(req),
    path: '/admin',
    maxAge: TTL_MS,
  });
}

function clearSession(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: isSecureRequest(req), path: '/admin' });
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

module.exports = { COOKIE_NAME, TTL_MS, issue, verify, readCookie, setSession, clearSession, isCrossSiteWrite, wantsHtml };
