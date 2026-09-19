const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('installable dashboard', () => {
  let request;
  let app;

  before(() => {
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }
    process.env.SHELLM_ADMIN_PASSWORD = 'correct-horse-battery-staple';

    const { initDb, closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');

    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => require('../../src/db').closeDb());

  it('serves the manifest unauthenticated with the right media type', async () => {
    const res = await request(app).get('/admin/manifest.webmanifest');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /application\/manifest\+json/);

    const manifest = JSON.parse(res.text);
    assert.strictEqual(manifest.start_url, '/admin/dashboard/');
    assert.strictEqual(manifest.scope, '/admin/');
    assert.strictEqual(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  });

  it('serves the service worker from /admin so it can claim that scope', async () => {
    const res = await request(app).get('/admin/sw.js');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.match(res.text, /addEventListener\('fetch'/);
  });

  it('caches only the shell, never an account response', async () => {
    const worker = (await request(app).get('/admin/sw.js')).text;
    for (const secret of ['/admin/keys', '/admin/logs', '/admin/stats', '/v1/']) {
      assert.ok(!worker.includes(secret), `service worker references ${secret}`);
    }
    assert.match(worker, /if \(request\.method !== 'GET'\) return;/);
  });

  it('serves the SPA assets without a session but never the page itself', async () => {
    const asset = await request(app).get('/admin/dashboard/js/app.js');
    assert.strictEqual(asset.status, 200);

    const page = await request(app).get('/admin/dashboard/');
    assert.strictEqual(page.status, 401);
  });

  it('every icon the manifest promises is actually served', async () => {
    const manifest = JSON.parse((await request(app).get('/admin/manifest.webmanifest')).text);
    for (const icon of manifest.icons) {
      const res = await request(app).get(icon.src);
      assert.strictEqual(res.status, 200, icon.src);
      assert.match(res.headers['content-type'], /image\/png/);
    }
  });
});
