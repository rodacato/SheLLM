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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#101417">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="SheLLM">
<title>SheLLM — sign in</title>
<link rel="manifest" href="/admin/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/admin/dashboard/img/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/admin/dashboard/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/admin/dashboard/img/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/admin/dashboard/img/favicon-180.png">
<style>
  :root { color-scheme: dark; --bg:#101417; --panel:#1c2023; --line:#3b494c; --text:#e0e3e7; --accent:#03e3ff;
          --error:#ffb4ab; --error-bg:#0b0f12; --muted:#849397; --on-accent:#00363e; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
                  calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left)); }
  form { position:relative; z-index:1; width:100%; max-width:22rem; background:var(--panel); border:1px solid var(--line); padding:2rem; }
  h1 { margin:0 0 .25rem; font-size:1.5rem; letter-spacing:-.02em; }
  h1 img { display:block; height:2rem; width:auto; }
  p { margin:0 0 1.5rem; font-size:.8rem; color:var(--muted); }
  label { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; margin:1rem 0 .35rem; color:var(--muted); }
  input { width:100%; padding:.6rem .7rem; background:var(--bg); border:1px solid var(--line); color:var(--text); font:inherit; }
  input:focus { outline:2px solid var(--accent); outline-offset:-2px; }
  button { width:100%; margin-top:1.5rem; padding:.7rem; background:var(--accent); color:var(--on-accent); border:0;
           font:inherit; font-weight:700; text-transform:uppercase; letter-spacing:.08em; cursor:pointer; }
  .error { margin:1rem 0 0; padding:.6rem .7rem; border-left:3px solid var(--error); background:var(--error-bg); color:var(--error); font-size:.8rem; }

  /* The CRT layers. Decoration only, aria-hidden, and every one of them stops moving under
     prefers-reduced-motion — the sweep is removed outright rather than frozen mid-screen. */
  .crt { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
  .crt-grid { position:absolute; inset:0; animation:drift 20s linear infinite;
              background-image:radial-gradient(circle, color-mix(in srgb, var(--accent) 6%, transparent) 1px, transparent 1px);
              background-size:40px 40px; }
  .crt-glow { position:absolute; top:50%; left:50%; width:min(34rem, 90vw); aspect-ratio:1; transform:translate(-50%,-50%);
              background:radial-gradient(circle, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 70%);
              animation:breathe 4s ease-in-out infinite; }
  .crt-sweep { position:absolute; left:0; width:100%; height:1px; animation:sweep 6s linear infinite;
               background:linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 18%, transparent), transparent); }
  .crt-lines { position:fixed; inset:0; z-index:2; pointer-events:none;
               background:repeating-linear-gradient(rgba(0,0,0,.22) 0 1px, transparent 1px 3px); }
  .cursor::after { content:'_'; color:var(--accent); animation:blink 1s step-end infinite; }

  @keyframes drift   { from { background-position:0 0; } to { background-position:40px 40px; } }
  @keyframes breathe { 0%,100% { opacity:.5; transform:translate(-50%,-50%) scale(1); }
                       50%     { opacity:1;  transform:translate(-50%,-50%) scale(1.1); } }
  @keyframes sweep   { from { top:-1px; } to { top:100%; } }
  @keyframes blink   { 0%,100% { opacity:1; } 50% { opacity:0; } }

  @media (prefers-reduced-motion: reduce) {
    .crt-grid, .crt-glow, .cursor::after { animation:none; }
    .crt-sweep { display:none; }
  }
</style>
</head>
<body>
<div class="crt" aria-hidden="true">
  <div class="crt-grid"></div>
  <div class="crt-glow"></div>
  <div class="crt-sweep"></div>
</div>
<div class="crt-lines" aria-hidden="true"></div>
<form method="post" action="/admin/login">
  <h1><img src="/admin/dashboard/img/logo-dark.svg" alt="SheLLM"></h1>
  <p class="cursor">Admin access</p>
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
