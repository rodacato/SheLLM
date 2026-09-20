'use strict';

const { Router, urlencoded } = require('express');
const { sendError, rateLimited } = require('../errors');
const { checkCredentials, adminEnabled, isRateLimited, recordFailedAttempt } = require('../middleware/admin-auth');
const { setSession, clearSession, verify, readCookie } = require('../middleware/admin-session');
const logger = require('../lib/logger');

const router = Router();

const PAGE = (error, next) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SheLLM — sign in</title>
<style>
  :root { color-scheme: dark; --bg:#101417; --panel:#1c2023; --line:#3b494c; --text:#e0e3e7; --accent:#03e3ff;
          --error:#ffb4ab; --error-bg:#0b0f12; --muted:#849397; --on-accent:#00363e; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding:16px; }
  form { width:100%; max-width:22rem; background:var(--panel); border:1px solid var(--line); padding:2rem; }
  h1 { margin:0 0 .25rem; font-size:1.5rem; letter-spacing:-.02em; }
  h1 img { display:block; height:2rem; width:auto; }
  p { margin:0 0 1.5rem; font-size:.8rem; color:var(--muted); }
  label { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; margin:1rem 0 .35rem; color:var(--muted); }
  input { width:100%; padding:.6rem .7rem; background:var(--bg); border:1px solid var(--line); color:var(--text); font:inherit; }
  input:focus { outline:2px solid var(--accent); outline-offset:-2px; }
  button { width:100%; margin-top:1.5rem; padding:.7rem; background:var(--accent); color:var(--on-accent); border:0;
           font:inherit; font-weight:700; text-transform:uppercase; letter-spacing:.08em; cursor:pointer; }
  .error { margin:1rem 0 0; padding:.6rem .7rem; border-left:3px solid var(--error); background:var(--error-bg); color:var(--error); font-size:.8rem; }
</style>
</head>
<body>
<form method="post" action="/admin/login">
  <h1><img src="/admin/dashboard/img/logo-dark.svg" alt="SheLLM"></h1>
  <p>Admin access</p>
  <input type="hidden" name="next" value="${next}">
  <label for="username">Username</label>
  <input id="username" name="username" autocomplete="username" autofocus>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
  ${error ? `<p class="error">${error}</p>` : ''}
</form>
</body>
</html>
`;

// The fragment is allowed so an expired session returns to the tab it died on; the leading
// /admin/ and the character class are what keep this from becoming an open redirect.
function safeNext(value) {
  return typeof value === 'string' && /^\/admin\/[\w\-./]*(#[\w-]*)?$/.test(value) ? value : '/admin/dashboard/';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sendPage(res, status, error, next) {
  res.status(status).type('html').send(PAGE(error, escapeHtml(next)));
}

function wantsHtml(req) {
  return (req.headers.accept || '').includes('text/html');
}

router.get('/login', (req, res) => {
  if (!adminEnabled()) {
    return sendError(res, { status: 501, code: 'admin_disabled', message: 'SHELLM_ADMIN_PASSWORD not configured' }, req.requestId);
  }
  if (verify(readCookie(req))) return res.redirect(302, safeNext(req.query.next));
  sendPage(res, 200, null, safeNext(req.query.next));
});

router.post('/login', urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
  if (!adminEnabled()) {
    return sendError(res, { status: 501, code: 'admin_disabled', message: 'SHELLM_ADMIN_PASSWORD not configured' }, req.requestId);
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const retryAfter = isRateLimited(ip);
  const { username = '', password = '', next } = req.body || {};

  if (retryAfter > 0) {
    logger.warn({ event: 'admin_auth_blocked', ip, reason: 'rate_limited' });
    if (!wantsHtml(req)) {
      return sendError(res, rateLimited('Too many failed admin login attempts', retryAfter), req.requestId);
    }
    res.set('Retry-After', String(retryAfter));
    return sendPage(res, 429, `Too many failed attempts. Try again in ${retryAfter}s.`, safeNext(next));
  }

  if (!checkCredentials(username, password)) {
    recordFailedAttempt(ip);
    logger.warn({ event: 'admin_auth_failure', ip, username, reason: 'login_form' });
    return sendPage(res, 401, 'Invalid credentials', safeNext(next));
  }

  setSession(req, res);
  logger.info({ event: 'admin_login', ip, username });
  res.redirect(302, safeNext(next));
});

router.post('/logout', (req, res) => {
  clearSession(req, res);
  logger.info({ event: 'admin_logout', ip: req.ip || 'unknown' });
  if (wantsHtml(req)) return res.redirect(302, '/admin/login');
  res.json({ logged_out: true });
});

module.exports = router;
