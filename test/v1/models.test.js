const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/models', () => {
  let request;
  let app;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: 'v1.0.0',
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
    app = require('../../src/server');
  });

  it('returns OpenAI model list format', async () => {
    const res = await request(app).get('/v1/models');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'list');
    assert.ok(Array.isArray(res.body.data));
  });

  it('includes models from all providers', async () => {
    const res = await request(app).get('/v1/models');
    const ids = res.body.data.map((m) => m.id);

    // At least one model per provider
    assert.ok(ids.includes('claude'));
    assert.ok(ids.includes('gemini'));
    assert.ok(ids.includes('codex'));
    assert.ok(ids.includes('cerebras'));

    // Model aliases
    assert.ok(ids.includes('claude-opus'));
    assert.ok(ids.includes('gemini-pro'));
  });

  it('each model entry has correct shape', async () => {
    const res = await request(app).get('/v1/models');

    for (const model of res.body.data) {
      assert.strictEqual(typeof model.id, 'string');
      assert.strictEqual(model.object, 'model');
      assert.strictEqual(typeof model.created, 'number');
      assert.strictEqual(model.owned_by, 'shellm');
    }
  });
});
