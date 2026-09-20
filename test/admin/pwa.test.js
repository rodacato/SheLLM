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

    // Without an id the install identity is start_url, so moving the dashboard path would
    // orphan every install that already exists rather than update it.
    assert.strictEqual(manifest.id, '/admin/');
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

  // A page added to index.html without its script in the shell leaves an installed PWA serving
  // markup that asks for a file it never cached. The stylesheet counts twice over: it declares
  // every colour the Tailwind config refers to, so without it the app paints nothing.
  it('caches every local file the page loads', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '../../src/admin/public');
    const html = require('../../src/admin/views').compose();
    const worker = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');

    const assets = [
      ...[...html.matchAll(/<script src="(js\/[^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map((m) => m[1]),
    ];
    assert.ok(assets.some((a) => a.startsWith('js/')), 'found no local scripts — this check proves nothing');
    assert.ok(assets.some((a) => a.startsWith('css/')), 'found no local stylesheet — this check proves nothing');

    for (const src of assets) {
      assert.ok(worker.includes(`/admin/dashboard/${src}`), `${src} is loaded by the page but absent from the shell cache`);
    }
  });

  // cache.put rejects a redirected response, so precaching a page that 302s without a session
  // fails the install outright and leaves the previous worker serving forever.
  it('precaches the assets but not the page, which redirects without a session', async () => {
    const worker = (await request(app).get('/admin/sw.js')).text;
    assert.match(worker, /cache\.addAll\(PRECACHE\)/, 'install still precaches the raw shell list');
    assert.match(worker, /PRECACHE = SHELL\.filter\(\(url\) => url !== '\/admin\/dashboard\/'\)/);
    assert.ok(worker.includes("'/admin/dashboard/',"), 'the page is still served from cache when offline');
  });

  it('serves the SPA assets without a session but never the page itself', async () => {
    const asset = await request(app).get('/admin/dashboard/js/app.js');
    assert.strictEqual(asset.status, 200);

    const page = await request(app).get('/admin/dashboard/');
    assert.strictEqual(page.status, 401);

    // The shell used to sit in public/, where the static mount served it straight past the
    // session check. Composing it from views/ is what takes it back behind auth.
    const byFilename = await request(app).get('/admin/dashboard/index.html');
    assert.notStrictEqual(byFilename.status, 200);
  });

  // An installed app lands here every time the 12-hour session ends. Without the manifest link
  // and the theme colour it renders as a different application inside the same window.
  it('keeps the sign-in page inside the installed app', async () => {
    const res = await request(app).get('/admin/login');
    assert.strictEqual(res.status, 200);
    assert.match(res.text, /<link rel="manifest" href="\/admin\/manifest\.webmanifest">/);
    assert.match(res.text, /<meta name="theme-color"/);
    assert.match(res.text, /viewport-fit=cover/);

    for (const layer of ['crt', 'crt-lines']) {
      const tag = new RegExp(`<div class="${layer}"[^>]*>`).exec(res.text);
      assert.ok(tag, `the ${layer} layer is gone`);
      assert.match(tag[0], /aria-hidden="true"/, `${layer} is decoration and must stay out of the tree`);
    }
    assert.match(res.text, /prefers-reduced-motion/);
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
