const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Every caller parses errors as JSON, so nothing that reaches next(err) may answer Express's
// HTML page, and no body may carry a stack trace or a file path.
describe('errors that reach next(err)', () => {
  let request;
  let app;
  let key;
  const adminAuth = `Basic ${Buffer.from('admin:error-shape-pass').toString('base64')}`;

  before(() => {
    process.env.SHELLM_ADMIN_PASSWORD = 'error-shape-pass';
    const db = require('../src/db');
    try { db.closeDb(); } catch { /* not open */ }
    db.initDb(':memory:');
    key = db.createClient({ name: 'error-shape', rpm: 100 }).rawKey;
    request = require('supertest');
    app = require('../src/app');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    require('../src/db').closeDb();
  });

  const malformed = (url, auth) => request(app).post(url).set('Authorization', auth)
    .set('Content-Type', 'application/json').send('{"model": ');

  const noLeak = (res) => assert.doesNotMatch(res.text, /SyntaxError|node_modules|\bat \w+ \(/);

  it('answers a malformed body on /v1/messages in the Anthropic shape', async () => {
    const res = await malformed('/v1/messages', `Bearer ${key}`);
    assert.equal(res.status, 400);
    assert.match(res.headers['content-type'], /json/);
    assert.equal(res.body.type, 'error');
    assert.equal(res.body.error.type, 'invalid_request_error');
    assert.ok(res.headers['x-request-id']);
    assert.equal(res.headers['request-id'], res.headers['x-request-id'], 'the header the Anthropic SDK reads');
    assert.equal(res.body.request_id, res.headers['request-id'], 'the API quotes it in the body too');
    noLeak(res);
  });

  it('answers an unknown /v1 route in the Anthropic shape when the caller sends anthropic-version', async () => {
    const res = await request(app).post('/v1/messages/count_tokens').set('x-api-key', key).set('anthropic-version', '2023-06-01').send({});
    assert.equal(res.status, 404);
    assert.equal(res.body.type, 'error');
    assert.equal(res.body.error.type, 'not_found_error');
  });

  it('answers the same unknown route in the OpenAI shape without anthropic-version', async () => {
    const res = await request(app).post('/v1/messages/count_tokens').set('Authorization', `Bearer ${key}`).send({});
    assert.equal(res.status, 404);
    assert.equal(res.body.type, undefined);
    assert.equal(res.body.error.code, 'not_found');
  });

  it('answers a malformed body on /v1/chat/completions in the OpenAI shape', async () => {
    const res = await malformed('/v1/chat/completions', `Bearer ${key}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_request');
    assert.equal(res.body.error.type, 'invalid_request_error');
    noLeak(res);
  });

  it('answers a malformed body on the admin API in SheLLM\'s shape', async () => {
    const res = await malformed('/admin/keys', adminAuth);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
    noLeak(res);
  });

  it('answers a body past the small limit as a JSON 413', async () => {
    const res = await request(app).post('/v1/messages').set('Authorization', `Bearer ${key}`)
      .set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
    assert.equal(res.status, 413);
    assert.equal(res.body.type, 'error');
    noLeak(res);
  });

  it('answers a thrown error as a JSON 500 that names no file', async () => {
    const { errorHandler } = require('../src/middleware/error-handler');
    const thrower = express();
    thrower.get('/v1/boom', () => { throw new Error('/home/shellmer/shellm/src/secret.js exploded'); });
    thrower.use(errorHandler);

    const res = await request(thrower).get('/v1/boom');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'internal_error');
    assert.doesNotMatch(res.text, /secret\.js|shellmer/);
  });
});
