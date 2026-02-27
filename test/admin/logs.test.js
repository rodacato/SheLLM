const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('admin /admin/logs', () => {
  let request;
  let app;
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: 'v1.0.0', stderr: '', duration_ms: 10,
        })),
      },
    });

    delete process.env.SHELLM_CLIENTS;
    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';

    mock.module('dotenv', {
      namedExports: { config: () => {} },
      defaultExport: { config: () => {} },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) {
        delete require.cache[key];
      }
    }

    const { initDb, closeDb, insertRequestLog } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');

    // Seed some log entries
    insertRequestLog({ request_id: 'req-1', client_name: 'app1', provider: 'claude', model: 'claude', status: 200, duration_ms: 1500, queued_ms: 100, tokens: 500, cost_usd: 0.01 });
    insertRequestLog({ request_id: 'req-2', client_name: 'app1', provider: 'gemini', model: 'gemini', status: 200, duration_ms: 2000, queued_ms: 50, tokens: 300, cost_usd: 0.005 });
    insertRequestLog({ request_id: 'req-3', client_name: 'app2', provider: 'claude', model: 'claude', status: 400, duration_ms: 10, queued_ms: null, tokens: null, cost_usd: null });
    insertRequestLog({ request_id: 'req-4', client_name: null, provider: 'cerebras', model: 'cerebras', status: 502, duration_ms: 5000, queued_ms: 200, tokens: null, cost_usd: null });

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  it('returns all logs with default pagination', async () => {
    const res = await request(app)
      .get('/admin/logs')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.logs));
    assert.strictEqual(res.body.logs.length, 4);
    assert.strictEqual(res.body.total, 4);
    assert.strictEqual(res.body.limit, 50);
    assert.strictEqual(res.body.offset, 0);
  });

  it('returns logs in descending order', async () => {
    const res = await request(app)
      .get('/admin/logs')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.logs[0].request_id, 'req-4');
    assert.strictEqual(res.body.logs[3].request_id, 'req-1');
  });

  it('respects limit and offset', async () => {
    const res = await request(app)
      .get('/admin/logs?limit=2&offset=1')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.logs.length, 2);
    assert.strictEqual(res.body.total, 4);
    assert.strictEqual(res.body.limit, 2);
    assert.strictEqual(res.body.offset, 1);
  });

  it('caps limit at 200', async () => {
    const res = await request(app)
      .get('/admin/logs?limit=999')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.limit, 200);
  });

  it('filters by provider', async () => {
    const res = await request(app)
      .get('/admin/logs?provider=claude')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.total, 2);
    for (const log of res.body.logs) {
      assert.strictEqual(log.provider, 'claude');
    }
  });

  it('filters by client', async () => {
    const res = await request(app)
      .get('/admin/logs?client=app2')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.total, 1);
    assert.strictEqual(res.body.logs[0].client_name, 'app2');
  });

  it('filters by exact status code', async () => {
    const res = await request(app)
      .get('/admin/logs?status=502')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.total, 1);
    assert.strictEqual(res.body.logs[0].status, 502);
  });

  it('filters by status class (2 → 2xx)', async () => {
    const res = await request(app)
      .get('/admin/logs?status=2')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.total, 2);
    for (const log of res.body.logs) {
      assert.ok(log.status >= 200 && log.status < 300);
    }
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/admin/logs');
    assert.strictEqual(res.status, 401);
  });

  it('each log entry has correct shape', async () => {
    const res = await request(app)
      .get('/admin/logs')
      .set('Authorization', `Basic ${adminCreds}`);

    for (const log of res.body.logs) {
      assert.ok('id' in log);
      assert.ok('request_id' in log);
      assert.ok('provider' in log);
      assert.ok('model' in log);
      assert.ok('status' in log);
      assert.ok('duration_ms' in log);
      assert.ok('created_at' in log);
    }
  });
});
