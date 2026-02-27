const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('server integration', () => {
  let request;
  let app;

  before(() => {
    // Mock base.execute before any provider loads
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

    request = require('supertest');
    app = require('../src/server');
  });

  it('GET /health returns 200 with correct shape', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.providers);
    assert.ok(res.body.queue);
    assert.strictEqual(typeof res.body.uptime_seconds, 'number');
  });

  it('POST /v1/chat/completions with missing model returns OpenAI error', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
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
