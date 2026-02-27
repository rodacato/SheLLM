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
      .post('/v1/chat/completions')
      .set('Content-Type', 'text/plain')
      .send('hello');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
    assert.match(res.body.message, /Content-Type/);
  });

  it('rejects body exceeding 256kb limit', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'x'.repeat(300000) }] });

    assert.strictEqual(res.status, 413);
  });

  it('successful completion includes X-Queue-Depth and X-Queue-Active headers', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 200);
    assert.ok('x-queue-depth' in res.headers);
    assert.ok('x-queue-active' in res.headers);
  });

  it('gracefulShutdown export is a function', () => {
    assert.strictEqual(typeof app.gracefulShutdown, 'function');
  });

  it('rejects prompt exceeding 50000 chars', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'a'.repeat(50001) }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /exceeds maximum length/);
  });

  it('rejects invalid max_tokens', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }], max_tokens: -5 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /max_tokens/);
  });
});
