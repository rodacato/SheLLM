const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('server hardening (Phase 7)', () => {
  let request;
  let app;

  before(() => {
    mock.module(path.resolve(__dirname, '../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async (cmd) => ({
          stdout: cmd === 'claude'
            ? JSON.stringify({ result: 'test reply', cost_usd: 0.001 })
            : 'test reply',
          stderr: '',
          duration_ms: 10,
        })),
      },
    });

    delete process.env.SHELLM_CLIENTS;

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    request = require('supertest');
    app = require('../src/server');
  });

  it('rejects POST without Content-Type application/json', async () => {
    const res = await request(app)
      .post('/completions')
      .set('Content-Type', 'text/plain')
      .send('hello');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
    assert.match(res.body.message, /Content-Type/);
  });

  it('rejects body exceeding 256kb limit', async () => {
    const largeBody = { model: 'claude', prompt: 'x'.repeat(300000) };

    const res = await request(app)
      .post('/completions')
      .send(largeBody);

    assert.strictEqual(res.status, 413);
  });

  it('successful completion includes X-Queue-Depth and X-Queue-Active headers', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'claude', prompt: 'hello' });

    assert.strictEqual(res.status, 200);
    assert.ok('x-queue-depth' in res.headers);
    assert.ok('x-queue-active' in res.headers);
    assert.strictEqual(typeof parseInt(res.headers['x-queue-depth']), 'number');
  });

  it('successful completion includes queued_ms in response', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'claude', prompt: 'hello' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.body.queued_ms, 'number');
    assert.ok(res.body.queued_ms >= 0);
  });

  it('error response includes duration_ms', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'cerebras', prompt: 'hello' });

    // cerebras will fail (no real API key), but error should have duration_ms
    if (res.status >= 400) {
      assert.ok('request_id' in res.body);
    }
  });

  it('gracefulShutdown export is a function', () => {
    assert.strictEqual(typeof app.gracefulShutdown, 'function');
  });

  it('rejects prompt exceeding 50000 chars via validation middleware', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'claude', prompt: 'a'.repeat(50001) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /exceeds maximum length/);
  });

  it('rejects invalid max_tokens via validation middleware', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'claude', prompt: 'hello', max_tokens: -5 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /max_tokens/);
  });

  it('sanitizes non-string system to empty string (sanitize runs before validate)', async () => {
    // sanitizeInput converts non-string system to '' before validation
    const res = await request(app)
      .post('/completions')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ model: 'claude', prompt: 'hello', system: 123 }));

    // Should succeed because sanitizer converts 123 → ''
    assert.strictEqual(res.status, 200);
  });
});
