const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('/v1/models', () => {
  let request;
  let app;
  let testKey;

  before(() => {
    mock.module(path.resolve(__dirname, '../../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: 'v1.0.0',
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

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    const { initDb, closeDb, createClient } = require('../../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');
    const client = createClient({ name: 'test-client', rpm: 100 });
    testKey = client.rawKey;

    request = require('supertest');
    app = require('../../../src/server');
  });

  after(() => {
    const { closeDb } = require('../../../src/db');
    closeDb();
  });

  it('returns OpenAI model list format', async () => {
    const res = await request(app).get('/v1/models')
      .set('Authorization', `Bearer ${testKey}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'list');
    assert.ok(Array.isArray(res.body.data));
  });

  it('lists only the names that map to a CLI model', async () => {
    const res = await request(app).get('/v1/models')
      .set('Authorization', `Bearer ${testKey}`);
    const ids = res.body.data.map((m) => m.id);

    assert.deepStrictEqual(ids, [
      'claude', 'claude-haiku', 'claude-sonnet', 'claude-opus',
      'gemini', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite',
    ]);
  });

  it('omits models of a disabled provider', async () => {
    const { updateProvider } = require('../../../src/db');
    updateProvider('gemini', { enabled: 0 });
    try {
      const res = await request(app).get('/v1/models')
        .set('Authorization', `Bearer ${testKey}`);
      assert.ok(!res.body.data.some((m) => m.id.startsWith('gemini')));
    } finally {
      updateProvider('gemini', { enabled: 1 });
    }
  });

  it('each model entry has correct shape', async () => {
    const res = await request(app).get('/v1/models')
      .set('Authorization', `Bearer ${testKey}`);

    for (const model of res.body.data) {
      assert.strictEqual(typeof model.id, 'string');
      assert.strictEqual(model.object, 'model');
      assert.strictEqual(typeof model.created, 'number');
      assert.strictEqual(model.owned_by, 'shellm');
    }
  });
});
