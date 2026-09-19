'use strict';

const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '../../src/admin/public');
const source = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

describe('playground reaches the model the way an application does', () => {
  let request, app, rawKey;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({ stdout: 'v1.0.0', stderr: '', duration_ms: 10 })),
        stripNonPrintable: (t) => t,
      },
    });
    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    const db = require('../../src/db');
    try { db.closeDb(); } catch { /* not open */ }
    db.initDb(':memory:');
    rawKey = db.createClient({ name: 'playground-test', rpm: 100 }).rawKey;

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    require('../../src/db').closeDb();
  });

  it('sends the client key as a bearer token to a real /v1 endpoint', () => {
    const js = source('js/playground.js');
    assert.match(js, /Authorization: `Bearer \$\{this\.apiKey/, 'the key must travel as a bearer token');
    assert.match(js, /'\/v1\/messages'/, 'the Anthropic endpoint is the real one');
    assert.match(js, /'\/v1\/chat\/completions'/, 'the OpenAI endpoint is the real one');
  });

  it('never routes the prompt through an admin-only path', () => {
    const js = source('js/playground.js');
    assert.ok(
      !/API_BASE\}\/(playground|chat|completions|messages)/.test(js),
      'a prompt sent under /admin would skip the key system entirely',
    );

    const adminDir = path.join(__dirname, '../../src/admin');
    const routes = fs.readdirSync(adminDir).filter((f) => f.endsWith('.js'));
    assert.ok(routes.length > 3, 'found almost no admin routes — this check proves nothing');
    for (const file of routes) {
      const text = fs.readFileSync(path.join(adminDir, file), 'utf8');
      assert.ok(!/playground/i.test(text), `${file} exposes a playground route`);
    }
  });

  it('does not borrow the dashboard fetch helper, which would hijack a refused key', () => {
    const js = source('js/playground.js');
    const sendBody = js.slice(js.indexOf('async send()'), js.indexOf('storeKey() {'));
    assert.ok(sendBody.includes('await fetch('), 'the prompt goes out through plain fetch');
    assert.ok(!sendBody.includes('apiFetch('), 'apiFetch would read a 401 as an expired admin session');
  });

  it('the endpoint it posts to rejects a request with no client key', async () => {
    await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
      .expect(401);

    await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ messages: [{ role: 'user', content: 'hi' }] })
      .expect(400);
  });

  // The dashboard's static assets are served without the admin session (src/app.js), so this
  // file is public: it may carry no credential, and the key must stay in the viewer's own tab.
  it('keeps the client key out of the source it ships', async () => {
    const res = await request(app).get('/admin/dashboard/js/playground.js').expect(200);

    assert.ok(!/shellm-[A-Za-z0-9_-]{8,}/.test(res.text), 'a key literal is embedded in the page');
    assert.ok(!res.text.includes(rawKey), 'the served file leaks a real key');
    assert.ok(res.text.includes('sessionStorage'), 'the key is held per tab, not in localStorage');
    assert.ok(!res.text.includes('localStorage'), 'localStorage would outlive the tab the key was typed in');
  });
});
