const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('server integration', () => {
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
      },
    });

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    process.env.SHELLM_GLOBAL_RPM = '200';

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
    const { closeDb } = require('../src/db');
    closeDb();
  });

  it('GET /health returns 200 with correct shape', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.ok(['ok', 'degraded', 'down'].includes(res.body.status), `unexpected status: ${res.body.status}`);
    assert.ok(res.body.providers);
    assert.ok(res.body.queue);
    assert.strictEqual(typeof res.body.uptime_seconds, 'number');
  });

  it('POST /v1/chat/completions without auth returns 401', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/chat/completions with auth but missing model returns 400', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ messages: [{ role: 'user', content: 'hello' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.type, 'invalid_request_error');
    assert.ok(res.body.error.message);
  });

  it('legacy /completions returns 404', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ model: 'claude', prompt: 'hello' });

    assert.strictEqual(res.status, 404);
  });

  it('legacy /providers returns 404', async () => {
    const res = await request(app).get('/providers');
    assert.strictEqual(res.status, 404);
  });
});
