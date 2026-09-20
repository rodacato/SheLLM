const { describe, it, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const PASSWORD = 'correct-horse-battery-staple';

describe('admin login', () => {
  let request;
  let app;
  let session;

  before(() => {
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    process.env.SHELLM_ADMIN_PASSWORD = PASSWORD;
    process.env.SHELLM_ADMIN_USER = 'admin';

    const { initDb, closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');

    request = require('supertest');
    app = require('../../src/app');
    session = require('../../src/middleware/admin-session');
  });

  beforeEach(() => {
    require('../../src/middleware/admin-auth').failedAttempts.clear();
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_USER;
    require('../../src/db').closeDb();
  });

  function cookieFrom(res) {
    const header = res.headers['set-cookie'] || [];
    return header.find((c) => c.startsWith(`${session.COOKIE_NAME}=`));
  }

  async function login() {
    const res = await request(app).post('/admin/login').type('form')
      .send({ username: 'admin', password: PASSWORD, next: '/admin/dashboard/' });
    return { res, cookie: cookieFrom(res) };
  }

  it('serves a login page instead of a browser dialog', async () => {
    const res = await request(app).get('/admin/login');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /<form method="post" action="\/admin\/login">/);
  });

  it('rejects a wrong password without setting a cookie', async () => {
    const res = await request(app).post('/admin/login').type('form')
      .send({ username: 'admin', password: 'wrong-password' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(cookieFrom(res), undefined);
    assert.match(res.text, /Invalid credentials/);

    const wrongUser = await request(app).post('/admin/login').type('form')
      .send({ username: 'someone-else', password: PASSWORD });
    assert.strictEqual(wrongUser.status, 401);
    assert.strictEqual(cookieFrom(wrongUser), undefined);
  });

  it('logs in and reaches the dashboard and the admin API', async () => {
    const { res, cookie } = await login();
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/admin/dashboard/');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/admin/i);

    const dashboard = await request(app).get('/admin/dashboard/').set('Cookie', cookie);
    assert.strictEqual(dashboard.status, 200);

    const keys = await request(app).get('/admin/keys').set('Cookie', cookie);
    assert.strictEqual(keys.status, 200);
  });

  it('refuses a tampered or expired session', async () => {
    const { cookie } = await login();
    const value = cookie.split(';')[0].split('=')[1];
    const [payload, signature] = value.split('.');

    const tampered = `${session.COOKIE_NAME}=${payload}.${signature.slice(0, -2)}xx`;
    const forged = `${session.COOKIE_NAME}=${Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url')}.${signature}`;
    const expired = `${session.COOKIE_NAME}=${session.issue(Date.now() - session.TTL_MS - 1000)}`;

    for (const bad of [tampered, forged, expired]) {
      const res = await request(app).get('/admin/keys').set('Cookie', bad);
      assert.strictEqual(res.status, 401, bad.slice(0, 40));
    }
  });

  it('still accepts Basic auth for scripts', async () => {
    const res = await request(app).get('/admin/keys').auth('admin', PASSWORD);
    assert.strictEqual(res.status, 200);

    const wrong = await request(app).get('/admin/keys').auth('admin', 'wrong-password');
    assert.strictEqual(wrong.status, 401);
    assert.match(wrong.headers['www-authenticate'], /Basic/);
  });

  it('refuses a cross-site state-changing request', async () => {
    const { cookie } = await login();

    const crossSite = await request(app).post('/admin/keys')
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'cross-site')
      .send({ name: 'from-another-site' });
    assert.strictEqual(crossSite.status, 403);

    const sameOrigin = await request(app).post('/admin/keys')
      .set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin')
      .send({ name: 'from-the-dashboard' });
    assert.strictEqual(sameOrigin.status, 201);
  });

  it('sends browsers to the login page and API clients a 401', async () => {
    const browser = await request(app).get('/admin/dashboard/').set('Accept', 'text/html');
    assert.strictEqual(browser.status, 302);
    assert.strictEqual(browser.headers.location, '/admin/login?next=%2Fadmin%2Fdashboard%2F');

    const api = await request(app).get('/admin/keys');
    assert.strictEqual(api.status, 401);
    assert.strictEqual(api.body.error, 'auth_required');
  });

  // A locked-out operator is who most needs a page. The rate-limited POST answered with raw JSON,
  // so the browser rendered an error object at the one moment there was nothing else to look at.
  it('shows a locked-out browser the page, and still answers a script with JSON', async () => {
    const attempt = (accept) => request(app).post('/admin/login').type('form').set('Accept', accept)
      .send({ username: 'admin', password: 'wrong-password' });

    for (let i = 0; i < 5; i++) await attempt('application/json');

    const browser = await attempt('text/html');
    assert.strictEqual(browser.status, 429);
    assert.match(browser.headers['content-type'], /text\/html/);
    assert.match(browser.headers['retry-after'] || '', /^\d+$/, 'the page lost the Retry-After header');
    assert.match(browser.text, /<form method="post" action="\/admin\/login">/);
    assert.match(browser.text, /Try again in \d+s/);

    const script = await attempt('application/json');
    assert.strictEqual(script.status, 429);
    assert.strictEqual(script.body.error, 'rate_limited');
    assert.ok(script.headers['retry-after'], 'a script lost the Retry-After header');
  });

  it('logs out and invalidates the browser session', async () => {
    const { cookie } = await login();
    const res = await request(app).post('/admin/logout').set('Cookie', cookie).set('Accept', 'text/html');
    assert.strictEqual(res.status, 302);
    assert.match(cookieFrom(res), /shellm_admin=;/);
  });
});
