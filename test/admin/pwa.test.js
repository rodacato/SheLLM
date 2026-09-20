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

  // viewport-fit=cover plus a translucent status bar puts the web view behind the notch. Nothing
  // reads the insets by accident, so a class dropped here is a bar under the clock on a phone.
  it('keeps the chrome out from under the status bar', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = require('../../src/admin/views').compose();
    const css = fs.readFileSync(path.join(__dirname, '../../src/admin/public/css/custom.css'), 'utf8');

    const used = [...new Set([...html.matchAll(/class="[^"]*?(safe-[\w-]+)/g)].map((m) => m[1]))];
    assert.ok(used.length >= 4, `the markup uses ${used.length} safe-area classes — expected the four`);

    for (const cls of used) {
      assert.match(css, new RegExp(`\\.${cls}\\s`), `${cls} is used by the page but declared nowhere`);
    }
    assert.match(css, /env\(safe-area-inset-top\)/);
    assert.match(css, /env\(safe-area-inset-bottom\)/);

    // The bar owns its own height now. A fixed h-14 back on it is the regression.
    const bar = /<div class="md:hidden fixed top-0[^"]*"/.exec(html);
    assert.ok(bar, 'the mobile bar is gone');
    assert.ok(!/\bh-14\b/.test(bar[0]), 'the mobile bar went back to a fixed height');
  });

  // A coupling no file states on its own: the System page reloads after an update, and a reload
  // does not release a waiting worker, so dropping skipWaiting serves the page it just replaced.
  it('activates at once, because the update flow reloads instead of closing the tab', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '../../src/admin/public');
    const worker = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
    const system = fs.readFileSync(path.join(dir, 'js/system.js'), 'utf8');

    assert.match(worker, /self\.skipWaiting\(\)/, 'without it the reload below is served by the old worker');
    assert.match(worker, /self\.clients\.claim\(\)/, 'and the page that is already open stays uncontrolled');
    assert.match(system, /window\.location\.reload\(\)/,
      'the reload skipWaiting exists for is gone — reconsider P8 in docs/PWA-AUDIT.md');
  });

  it('every icon the manifest promises is actually served', async () => {
    const manifest = JSON.parse((await request(app).get('/admin/manifest.webmanifest')).text);
    for (const icon of manifest.icons) {
      const res = await request(app).get(icon.src);
      assert.strictEqual(res.status, 200, icon.src);
      assert.match(res.headers['content-type'], /image\/png/);
    }
  });

  // Declaring the plain icon as maskable is not a smaller version of having one: the launcher
  // applies its mask either way, and the mark runs to the corners.
  it('ships a maskable icon that is its own artwork', async () => {
    const manifest = JSON.parse((await request(app).get('/admin/manifest.webmanifest')).text);
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
    assert.strictEqual(maskable.length, 1, 'exactly one maskable icon');

    const plain = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.src);
    assert.ok(!plain.includes(maskable[0].src), 'the maskable icon is the plain icon under another purpose');
  });

  // Two icon sets shipped side by side for months: the PNG favicons were an older gradient
  // render while the SVG and every PWA icon were the flat mark. Same app, two logos.
  it('serves the icons assets/favicon/ holds, byte for byte', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '../..');
    const copies = {
      'favicon.svg': 'favicon.svg',
      'favicon-16.png': 'favicon-16.png',
      'favicon-32.png': 'favicon-32.png',
      'favicon-180.png': 'favicon-180.png',
      'icon-192.png': 'favicon-192.png',
      'icon-512.png': 'favicon-512.png',
    };

    for (const [served, canonical] of Object.entries(copies)) {
      const a = fs.readFileSync(path.join(root, 'src/admin/public/img', served));
      const b = fs.readFileSync(path.join(root, 'assets/favicon', canonical));
      assert.ok(a.equals(b), `img/${served} has drifted from assets/favicon/${canonical}`);
    }
  });

  it('declares the same icons on the dashboard and on the front door', async () => {
    const dashboard = require('../../src/admin/views').compose();
    const login = (await request(app).get('/admin/login')).text;

    for (const icon of ['favicon.svg', 'favicon-32.png', 'favicon-16.png', 'favicon-180.png']) {
      assert.ok(dashboard.includes(icon), `the dashboard declares ${icon}`);
      assert.ok(login.includes(icon), `the sign-in page declares ${icon}`);
    }
  });
});
