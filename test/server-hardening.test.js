const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('server hardening (Phase 7)', () => {
  let request;
  let app;
  let testKey;

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
        stripNonPrintable: (t) => t,
      },
    });

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    process.env.SHELLM_GLOBAL_RPM = '200';
    process.env.SHELLM_MAX_CHAT_BODY_BYTES = String(1024 * 1024);

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    const { initDb, closeDb, createClient } = require('../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');
    const client = createClient({ name: 'test-client', rpm: 100 });
    testKey = client.rawKey;

    request = require('supertest');
    app = require('../src/server');
  });

  after(() => {
    delete process.env.SHELLM_MAX_CHAT_BODY_BYTES;
    const { closeDb } = require('../src/db');
    try { closeDb(); } catch { /* ignore */ }
  });

  it('rejects POST without Content-Type application/json', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
      .set('Content-Type', 'text/plain')
      .send('hello');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'invalid_request', 'a /v1 caller gets the OpenAI error shape');
    assert.match(res.body.error.message, /Content-Type/);
  });

  it('rejects body exceeding 256kb limit', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', max_tokens: 16, messages: [{ role: 'user', content: 'x'.repeat(300000) }] });

    assert.strictEqual(res.status, 413);
  });

  describe('the chat body limit, which images need', () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    const bodyOf = (bytes) => ({
      model: 'claude',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
        ],
      }],
      padding: 'x'.repeat(bytes),
    });

    it('accepts a chat body over 256kb', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${testKey}`)
        .send(bodyOf(300 * 1024));
      assert.strictEqual(res.status, 200);
    });

    it('answers a chat body over SHELLM_MAX_CHAT_BODY_BYTES with an OpenAI 413 naming images', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${testKey}`)
        .send(bodyOf(1100 * 1024));
      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.body.error.type, 'invalid_request_error');
      assert.match(res.body.error.message, /exceeds 1048576 bytes; send fewer or smaller images/);
    });

    it('checks the key before reading a large chat body', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .send(bodyOf(1100 * 1024));
      assert.strictEqual(res.status, 401, 'a 413 here means the body was parsed before the key was checked');
    });

    it('keeps the small limit for any other spelling of the path', async () => {
      const res = await request(app)
        .post('/v1/chat/completions/')
        .set('Authorization', `Bearer ${testKey}`)
        .send(bodyOf(300 * 1024));
      assert.strictEqual(res.status, 413);
    });
  });

  it('successful completion includes X-Queue-Depth and X-Queue-Active headers', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
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
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', messages: [{ role: 'user', content: 'a'.repeat(50001) }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /exceeds maximum length/);
  });

  it('rejects invalid max_tokens', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }], max_tokens: -5 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error.message, /max_tokens/);
  });
});
