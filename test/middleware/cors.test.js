'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ALLOWED = 'https://rodacato.github.io';
const OTHER = 'https://evil.example';

describe('CORS on /v1', () => {
  let request;
  let app;

  before(() => {
    process.env.SHELLM_ADMIN_PASSWORD = 'cors-test-password';
    request = require('supertest');
    app = require('../../src/app');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    delete process.env.SHELLM_CORS_ORIGINS;
  });

  beforeEach(() => {
    process.env.SHELLM_CORS_ORIGINS = `${ALLOWED}, http://localhost:5173`;
  });

  function preflight(origin, path = '/v1/chat/completions') {
    return request(app)
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization, content-type');
  }

  it('answers a preflight from an allowed origin with 204 and the full header set', async () => {
    const res = await preflight(ALLOWED).expect(204);

    assert.equal(res.headers['access-control-allow-origin'], ALLOWED);
    assert.match(res.headers.vary, /Origin/);
    assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, OPTIONS');
    assert.match(res.headers['access-control-allow-headers'], /Authorization/);
    assert.match(res.headers['access-control-allow-headers'], /x-api-key/);
    assert.match(res.headers['access-control-allow-headers'], /anthropic-version/);
    assert.match(res.headers['access-control-allow-headers'], /anthropic-dangerous-direct-browser-access/);
    assert.equal(res.headers['access-control-max-age'], '600');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });

  it('never echoes a wildcard', async () => {
    const res = await preflight('http://localhost:5173').expect(204);
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  });

  it('denies a preflight from an origin that is not on the list', async () => {
    const res = await preflight(OTHER).expect(403);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('is off when SHELLM_CORS_ORIGINS is empty', async () => {
    process.env.SHELLM_CORS_ORIGINS = '';
    const res = await preflight(ALLOWED).expect(403);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('exposes the headers a browser client has to read', async () => {
    const res = await preflight(ALLOWED).expect(204);
    const exposed = res.headers['access-control-expose-headers'];

    for (const header of ['request-id', 'x-request-id', 'retry-after', 'x-shellm-queue-ms', 'x-shellm-queue-position']) {
      assert.match(exposed, new RegExp(header), `${header} is not exposed`);
    }
  });

  it('grants private network access only to an allowed origin', async () => {
    const allowed = await preflight(ALLOWED)
      .set('Access-Control-Request-Private-Network', 'true')
      .expect(204);
    assert.equal(allowed.headers['access-control-allow-private-network'], 'true');

    const denied = await preflight(OTHER)
      .set('Access-Control-Request-Private-Network', 'true')
      .expect(403);
    assert.equal(denied.headers['access-control-allow-private-network'], undefined);
  });

  it('does not grant private network access when the preflight did not ask for it', async () => {
    const res = await preflight(ALLOWED).expect(204);
    assert.equal(res.headers['access-control-allow-private-network'], undefined);
  });

  it('puts the headers on a real /v1 response, not just on the preflight', async () => {
    const res = await request(app).get('/v1/models').set('Origin', ALLOWED).expect(401);
    assert.equal(res.headers['access-control-allow-origin'], ALLOWED);
    assert.match(res.headers.vary, /Origin/);
  });

  it('puts the headers on a body the parser rejects, so the browser can read the error', async () => {
    const malformed = await request(app).post('/v1/messages').set('Origin', ALLOWED)
      .set('Content-Type', 'application/json').send('{bad').expect(400);
    const oversized = await request(app).post('/v1/messages').set('Origin', ALLOWED)
      .set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'a'.repeat(300_000) })).expect(413);

    assert.equal(malformed.headers['access-control-allow-origin'], ALLOWED);
    assert.equal(oversized.headers['access-control-allow-origin'], ALLOWED);
  });

  it('varies on Origin even when the origin is refused, so a cache cannot cross the two', async () => {
    const res = await request(app).get('/v1/models').set('Origin', OTHER).expect(401);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.match(res.headers.vary, /Origin/);
  });

  it('never answers an admin endpoint with CORS headers', async () => {
    for (const path of ['/admin/keys', '/admin/stats', '/admin/logs', '/admin/dashboard/']) {
      const res = await request(app).get(path).set('Origin', ALLOWED);
      assert.equal(res.headers['access-control-allow-origin'], undefined, `${path} leaked a CORS header`);
    }

    const pre = await request(app).options('/admin/keys').set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'GET');
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
  });

  it('leaves a request with no Origin exactly as it was', async () => {
    const res = await request(app).get('/v1/models').expect(401);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});
