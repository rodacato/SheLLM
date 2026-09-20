const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PASSWORD = 'correct-horse-battery-staple';

// send() refuses any path holding a dot-directory, so a file served by absolute path answers 404
// or 200 depending on where the checkout happens to sit. Running a copy of the app from under
// one is what tells a route that resolves against its own root from one that does not.
describe('the dashboard installed under a dot-directory', () => {
  let request;
  let app;
  let tmp;
  let installed;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-install-'));
    installed = path.join(tmp, '.hidden');
    fs.mkdirSync(installed);
    fs.cpSync(path.join(__dirname, '../../src'), path.join(installed, 'src'), { recursive: true });
    fs.symlinkSync(path.join(__dirname, '../../node_modules'), path.join(installed, 'node_modules'));

    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });
    process.env.SHELLM_ADMIN_PASSWORD = PASSWORD;
    process.env.SHELLM_ADMIN_USER = 'admin';

    require(path.join(installed, 'src/db')).initDb(':memory:');
    request = require('supertest');
    app = require(path.join(installed, 'src/app'));
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_USER;
    try { require(path.join(installed, 'src/db')).closeDb(); } catch { /* not open */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serves the manifest and the service worker', async () => {
    const manifest = await request(app).get('/admin/manifest.webmanifest');
    assert.strictEqual(manifest.status, 200);
    assert.strictEqual(JSON.parse(manifest.text).scope, '/admin/');

    const worker = await request(app).get('/admin/sw.js');
    assert.strictEqual(worker.status, 200);
    assert.match(worker.text, /addEventListener\('fetch'/);
  });

  it('serves the page and its assets to a session', async () => {
    const asset = await request(app).get('/admin/dashboard/js/app.js');
    assert.strictEqual(asset.status, 200);

    const login = await request(app).post('/admin/login').type('form')
      .send({ username: 'admin', password: PASSWORD, next: '/admin/dashboard/' });
    const cookie = (login.headers['set-cookie'] || []).find((c) => c.includes('='));
    assert.ok(cookie, 'login returned no session cookie');

    const page = await request(app).get('/admin/dashboard/').set('Cookie', cookie);
    assert.strictEqual(page.status, 200);
    assert.match(page.text, /<!DOCTYPE html>/i);
  });
});
