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

    // Ensure auth is disabled for integration tests
    // Must delete BEFORE requiring server.js (dotenv loads .env at import time)
    delete process.env.SHELLM_CLIENTS;

    // Prevent dotenv from re-injecting SHELLM_CLIENTS from .env
    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    // Clear all cached src modules
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

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

  it('POST /completions with missing model returns error contract', async () => {
    const res = await request(app)
      .post('/completions')
      .send({ prompt: 'hello' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
    assert.ok(res.body.message);
    assert.ok('request_id' in res.body);
  });
});
