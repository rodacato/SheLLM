const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('admin /admin/stats', () => {
  let request;
  let app;
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: 'v1.0.0', stderr: '', duration_ms: 10,
        })),
        stripNonPrintable: (t) => t,
      },
    });

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

    const { initDb, closeDb, insertRequestLog, createClient } = require('../../src/db');
    try { closeDb(); } catch { /* ignore */ }
    initDb(':memory:');

    // Seed data
    insertRequestLog({ request_id: 'r1', client_name: 'app1', provider: 'claude', model: 'claude', status: 200, duration_ms: 1000, queued_ms: 50, tokens: 400, cost_usd: 0.01 });
    insertRequestLog({ request_id: 'r2', client_name: 'app1', provider: 'claude', model: 'claude', status: 200, duration_ms: 2000, queued_ms: 100, tokens: 600, cost_usd: 0.02 });
    insertRequestLog({ request_id: 'r3', client_name: 'app2', provider: 'codex', model: 'codex', status: 400, duration_ms: 10, queued_ms: null, tokens: null, cost_usd: null });

    createClient({ name: 'active-client' });
    createClient({ name: 'inactive-client' });
    // Deactivate one
    const { updateClient, listClients } = require('../../src/db');
    const clients = listClients();
    updateClient(clients.find((c) => c.name === 'inactive-client').id, { active: 0 });

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  it('returns stats with default 24h period', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.period, '24h');
    assert.strictEqual(res.body.total_requests, 3);
    assert.strictEqual(res.body.total_tokens, 1000);
    assert.strictEqual(res.body.total_cost_usd, 0.03);
    assert.strictEqual(typeof res.body.avg_duration_ms, 'number');
    assert.ok(res.body.by_provider);
    assert.ok(res.body.by_status);
    assert.strictEqual(typeof res.body.active_clients, 'number');
  });

  it('by_provider groups correctly', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.by_provider.claude, 2);
    assert.strictEqual(res.body.by_provider.codex, 1);
  });

  it('by_status groups correctly', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.by_status['200'], 2);
    assert.strictEqual(res.body.by_status['400'], 1);
  });

  it('active_clients counts only active', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.active_clients, 1);
  });

  it('accepts period=7d', async () => {
    const res = await request(app)
      .get('/admin/stats?period=7d')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.period, '7d');
  });

  it('accepts period=30d', async () => {
    const res = await request(app)
      .get('/admin/stats?period=30d')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.period, '30d');
  });

  it('defaults invalid period to 24h', async () => {
    const res = await request(app)
      .get('/admin/stats?period=invalid')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.body.period, '24h');
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/admin/stats');
    assert.strictEqual(res.status, 401);
  });
  it('groups the error breakdown by who, what and which route', async () => {
    const { insertRequestLog } = require('../../src/db');
    insertRequestLog({ client_name: 'app2', model: 'claude', status: 400, error_code: 'invalid_request', method: 'POST', path: '/v1/chat/completions' });
    insertRequestLog({ client_name: 'app2', model: 'claude', status: 400, error_code: 'invalid_request', method: 'POST', path: '/v1/chat/completions' });
    insertRequestLog({ client_name: null, status: 401, error_code: 'auth_required', method: 'POST', path: '/v1/messages' });

    const res = await request(app)
      .get('/admin/stats?period=24h')
      .set('Authorization', `Basic ${adminCreds}`);

    const rows = res.body.error_breakdown;
    assert.ok(Array.isArray(rows), 'expected an error_breakdown array');

    const invalid = rows.find((r) => r.error_code === 'invalid_request' && r.client_name === 'app2');
    assert.strictEqual(invalid.count, 2);
    assert.strictEqual(invalid.path, '/v1/chat/completions');
    assert.ok(invalid.last_seen_at, 'expected the last occurrence');

    const unauthenticated = rows.find((r) => r.error_code === 'auth_required');
    assert.strictEqual(unauthenticated.client_name, '(unauthenticated)');

    assert.ok(!rows.some((r) => r.status < 400), 'successful requests are not errors');
  });

  it('returns timeline buckets a chart can be drawn from', async () => {
    const res = await request(app)
      .get('/admin/stats?period=24h')
      .set('Authorization', `Basic ${adminCreds}`);

    const timeline = res.body.timeline;
    assert.ok(timeline.length > 0, 'expected at least one bucket');
    for (const bucket of timeline) {
      assert.ok(bucket.bucket, 'every bucket names its period');
      assert.strictEqual(typeof bucket.requests, 'number');
      assert.strictEqual(typeof bucket.errors, 'number');
    }
  });
});
