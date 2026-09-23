const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const PASSWORD = 'correct-horse-battery-staple';

describe('entry point and unmatched routes', () => {
  let request;
  let app;

  before(() => {
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    process.env.SHELLM_ADMIN_PASSWORD = PASSWORD;

    const { initDb, closeDb } = require('../src/db');
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');

    request = require('supertest');
    app = require('../src/app');
  });

  after(() => {
    require('../src/db').closeDb();
  });

  it('sends a browser at the root to the dashboard', async () => {
    const res = await request(app).get('/').set('Accept', 'text/html');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/admin/dashboard/');
  });

  it('lands a browser without a session on the login page', async () => {
    const root = await request(app).get('/').set('Accept', 'text/html');
    const dashboard = await request(app).get(root.headers.location).set('Accept', 'text/html');
    assert.strictEqual(dashboard.status, 302);
    assert.strictEqual(dashboard.headers.location, '/admin/login?next=%2Fadmin%2Fdashboard%2F');

    const login = await request(app).get(dashboard.headers.location).set('Accept', 'text/html');
    assert.strictEqual(login.status, 200);
    assert.match(login.text, /<form method="post" action="\/admin\/login">/);
  });

  it('sends an authenticated /admin to the dashboard rather than answering 404', async () => {
    const res = await request(app).get('/admin').set('Accept', 'text/html').auth('any-username', PASSWORD);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/admin/dashboard/');
  });

  it('sends /admin without a session to the login page', async () => {
    const res = await request(app).get('/admin').set('Accept', 'text/html');
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.location, /^\/admin\/login\?next=/);
  });

  it('answers a client on the root with JSON, not a redirect', async () => {
    const res = await request(app).get('/').set('Accept', 'application/json');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'not_found');
    assert.strictEqual(res.body.message, 'No route for GET /');
  });

  it('answers an unknown path with SheLLM\'s error shape', async () => {
    const res = await request(app).get('/nope');
    assert.strictEqual(res.status, 404);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.strictEqual(res.body.error, 'not_found');
    assert.ok(res.body.request_id);
  });

  it('answers a mistyped /v1 path in the OpenAI error shape', async () => {
    const res = await request(app).post('/v1/chat/completion').send({});
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.strictEqual(res.body.error.code, 'not_found');
  });

  it('answers the Anthropic endpoint reached by the wrong method in its own error shape', async () => {
    const res = await request(app).get('/v1/messages');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.type, 'error');
    assert.strictEqual(res.body.error.type, 'not_found_error');
  });

  it('truncates the path it echoes back', async () => {
    const res = await request(app).get(`/${'a'.repeat(300)}`);
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.message.length < 120, res.body.message.length);
  });

  it('does not advertise the server it runs on', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['x-powered-by'], undefined);
  });
});
