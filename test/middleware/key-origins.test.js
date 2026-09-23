'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const APP_ORIGIN = 'https://rodacato.github.io';
const OTHER_ORIGIN = 'http://localhost:5173';
const ADMIN_PASSWORD = 'key-origins-password';

// Both suites share one process, and src/app.js reads the admin password when it is first
// required — which the first suite does.
process.env.SHELLM_ADMIN_PASSWORD = ADMIN_PASSWORD;

describe('a key scoped to a set of origins', () => {
  let request;
  let app;
  let scopedKey;
  let openKey;

  before(() => {
    process.env.SHELLM_CORS_ORIGINS = `${APP_ORIGIN}, ${OTHER_ORIGIN}`;
    process.env.SHELLM_GLOBAL_RPM = '500';

    const { initDb, closeDb, createClient } = require('../../src/db');
    try { closeDb(); } catch { /* not open yet */ }
    initDb(':memory:');

    scopedKey = createClient({ name: 'browser-bench', rpm: 100, origins: [APP_ORIGIN] }).rawKey;
    openKey = createClient({ name: 'server-side', rpm: 100 }).rawKey;

    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    delete process.env.SHELLM_CORS_ORIGINS;
    delete process.env.SHELLM_GLOBAL_RPM;
    require('../../src/db').closeDb();
  });

  function models(key, origin) {
    const req = request(app).get('/v1/models').set('Authorization', `Bearer ${key}`);
    return origin ? req.set('Origin', origin) : req;
  }

  it('answers a call from the origin it was scoped to', async () => {
    await models(scopedKey, APP_ORIGIN).expect(200);
  });

  it('rejects the same key from another allowed-by-CORS origin with 403', async () => {
    const res = await models(scopedKey, OTHER_ORIGIN).expect(403);

    assert.equal(res.body.error.code, 'origin_not_allowed');
    assert.match(res.body.error.message, /not allowed for this API key/);
    assert.match(res.body.error.message, new RegExp(OTHER_ORIGIN));
  });

  it('answers a request with no Origin — the list scopes pages, it is not authentication', async () => {
    await models(scopedKey, null).expect(200);
  });

  it('leaves a key without a list reachable from any origin', async () => {
    await models(openKey, APP_ORIGIN).expect(200);
    await models(openKey, OTHER_ORIGIN).expect(200);
    await models(openKey, null).expect(200);
  });

  it('reports the rejection in the format the caller speaks', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${scopedKey}`)
      .set('Origin', OTHER_ORIGIN)
      .send({ model: 'claude', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] })
      .expect(403);

    assert.equal(res.body.type, 'error');
    assert.equal(res.body.error.type, 'permission_error');
  });

  it('still carries the CORS headers, so the browser can read the 403', async () => {
    const res = await models(scopedKey, OTHER_ORIGIN).expect(403);
    assert.equal(res.headers['access-control-allow-origin'], OTHER_ORIGIN);
  });
});

describe('the admin API for a key origin list', () => {
  let request;
  let app;
  let auth;

  before(() => {
    const { initDb, closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* not open yet */ }
    initDb(':memory:');

    auth = `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64')}`;
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    require('../../src/db').closeDb();
  });

  function create(body) {
    return request(app).post('/admin/keys').set('Authorization', auth).send(body);
  }

  it('stores the list and reads it back', async () => {
    const created = await create({ name: 'bench-1', origins: [APP_ORIGIN, OTHER_ORIGIN] }).expect(201);
    assert.deepEqual(created.body.key.origins, [APP_ORIGIN, OTHER_ORIGIN]);

    const listed = await request(app).get('/admin/keys').set('Authorization', auth).expect(200);
    const key = listed.body.keys.find((k) => k.name === 'bench-1');
    assert.deepEqual(key.origins, [APP_ORIGIN, OTHER_ORIGIN]);
  });

  it('leaves origins null when none are given', async () => {
    const created = await create({ name: 'bench-2' }).expect(201);
    assert.equal(created.body.key.origins, null);
  });

  it('refuses a value that is not an origin', async () => {
    for (const bad of ['https://rodacato.github.io/', 'rodacato.github.io', 'https://a.dev/app', 'ftp://a.dev']) {
      const res = await create({ name: `bad-${bad}`, origins: [bad] }).expect(400);
      assert.match(res.body.message, /scheme:\/\/host/);
    }
  });

  it('refuses a list that is not an array', async () => {
    await create({ name: 'bench-3', origins: APP_ORIGIN }).expect(400);
  });

  it('clears the list when PATCHed with null', async () => {
    const created = await create({ name: 'bench-4', origins: [APP_ORIGIN] }).expect(201);

    const patched = await request(app)
      .patch(`/admin/keys/${created.body.key.id}`)
      .set('Authorization', auth)
      .send({ origins: null })
      .expect(200);

    assert.equal(patched.body.key.origins, null);
  });

  it('refuses a bad origin on PATCH too', async () => {
    const created = await create({ name: 'bench-5' }).expect(201);

    await request(app)
      .patch(`/admin/keys/${created.body.key.id}`)
      .set('Authorization', auth)
      .send({ origins: ['not-an-origin'] })
      .expect(400);
  });
});
