const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('admin /admin/providers', () => {
  let request;
  let app;
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');

  before(() => {
    // Mock base.execute before any provider loads
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: 'v1.0.0',
          stderr: '',
          duration_ms: 10,
        })),
      },
    });

    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';
    process.env.CEREBRAS_API_KEY = 'test-key';

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    // Clear cached modules to pick up env changes
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    // Initialize DB in-memory before requiring server
    const { initDb, closeDb } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    delete process.env.CEREBRAS_API_KEY;
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  it('GET /admin/providers returns all providers', async () => {
    const res = await request(app)
      .get('/admin/providers')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.providers));
    assert.ok(res.body.providers.length >= 4);

    const names = res.body.providers.map((p) => p.name);
    assert.ok(names.includes('claude'));
    assert.ok(names.includes('gemini'));
    assert.ok(names.includes('codex'));
    assert.ok(names.includes('cerebras'));

    // All enabled by default
    for (const prov of res.body.providers) {
      assert.strictEqual(prov.enabled, true);
      assert.ok(Array.isArray(prov.models));
    }
  });

  it('PATCH /admin/providers/:name disables a provider', async () => {
    const res = await request(app)
      .patch('/admin/providers/gemini')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ enabled: 0 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider.enabled, false);
    assert.strictEqual(res.body.provider.name, 'gemini');
  });

  it('PATCH /admin/providers/:name re-enables a provider', async () => {
    const res = await request(app)
      .patch('/admin/providers/gemini')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ enabled: 1 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.provider.enabled, true);
  });

  it('PATCH /admin/providers/:name rejects unknown provider', async () => {
    const res = await request(app)
      .patch('/admin/providers/unknown')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ enabled: 1 });

    assert.strictEqual(res.status, 400);
  });

  it('PATCH /admin/providers/:name rejects missing enabled field', async () => {
    const res = await request(app)
      .patch('/admin/providers/claude')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({});

    assert.strictEqual(res.status, 400);
  });

  it('GET /admin/providers reflects disabled state', async () => {
    // Disable codex
    await request(app)
      .patch('/admin/providers/codex')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ enabled: 0 });

    const res = await request(app)
      .get('/admin/providers')
      .set('Authorization', `Basic ${adminCreds}`);

    const codex = res.body.providers.find((p) => p.name === 'codex');
    assert.strictEqual(codex.enabled, false);

    // Re-enable for other tests
    await request(app)
      .patch('/admin/providers/codex')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ enabled: 1 });
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/admin/providers');
    assert.strictEqual(res.status, 401);
  });
});
