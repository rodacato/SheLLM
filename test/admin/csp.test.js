'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The dashboard shipped a release check that the dashboard's own policy blocked: the page asked
// GitHub for the newest release and the browser refused the connection. Nothing failed loudly —
// the panel said it could not reach GitHub, which reads like someone else's network problem.
describe('dashboard CSP covers what the page fetches', () => {
  const jsDir = path.join(__dirname, '../../src/admin/public/js');
  let request;
  let app;

  before(() => {
    process.env.SHELLM_ADMIN_PASSWORD = 'csp-test-password';
    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
  });

  function externalOrigins() {
    const origins = new Set();
    for (const file of fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(jsDir, file), 'utf8');
      for (const [, origin] of text.matchAll(/fetch\(\s*[`'"](https:\/\/[^/`'"]+)/g)) {
        origins.add(origin);
      }
    }
    return [...origins];
  }

  it('allows every external origin the dashboard fetches', async () => {
    const origins = externalOrigins();
    assert.ok(origins.length > 0, 'found no external fetches — if that became true, delete this test');

    // An asset needs no session, and the policy is set before the static mount.
    const res = await request(app).get('/admin/dashboard/js/system.js').expect(200);
    const policy = res.headers['content-security-policy'];
    assert.ok(policy, 'the dashboard serves no CSP at all');

    const connectSrc = policy.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
    assert.ok(connectSrc, 'connect-src is missing, so connections fall back to default-src');

    for (const origin of origins) {
      assert.ok(
        connectSrc.includes(origin),
        `the dashboard fetches ${origin} but connect-src is "${connectSrc}" — the browser blocks it`,
      );
    }
  });

  it('lets the Playground preview the data: URL images it is about to send', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../../src/admin/views/pages/playground.html'), 'utf8');
    assert.match(html, /<img :src="image\.dataUrl"/, 'the preview is gone — if so, drop data: from img-src');

    const res = await request(app).get('/admin/dashboard/js/playground.js').expect(200);
    const imgSrc = res.headers['content-security-policy'].split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src'));
    assert.match(imgSrc, /\bdata:/, `img-src is "${imgSrc}", so every preview renders as a broken image`);
  });
});
