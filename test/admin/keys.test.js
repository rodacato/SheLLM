const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('admin /admin/keys', () => {
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
        stripNonPrintable: (t) => t,
      },
    });

    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';

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
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/admin/keys');
    assert.strictEqual(res.status, 401);
  });

  it('GET /admin/keys returns empty list initially', async () => {
    const res = await request(app)
      .get('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.keys, []);
  });

  it('POST /admin/keys creates a new key', async () => {
    const res = await request(app)
      .post('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ name: 'test-client', rpm: 15 });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.key.raw_key.startsWith('shellm-'));
    assert.strictEqual(res.body.key.name, 'test-client');
    assert.strictEqual(res.body.key.rpm, 15);
    assert.ok(res.body.key.id);
    assert.ok(res.body.key.created_at);
  });

  it('POST /admin/keys rejects duplicate name', async () => {
    const res = await request(app)
      .post('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ name: 'test-client' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /already exists/);
  });

  it('POST /admin/keys rejects missing name', async () => {
    const res = await request(app)
      .post('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({});

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /name/);
  });

  it('GET /admin/keys lists created clients', async () => {
    const res = await request(app)
      .get('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.keys.length >= 1);
    const client = res.body.keys.find((k) => k.name === 'test-client');
    assert.ok(client);
    assert.strictEqual(client.rpm, 15);
    assert.ok(!('raw_key' in client), 'raw_key should not be in list');
  });

  it('PATCH /admin/keys/:id updates rpm', async () => {
    // Get the id first
    const list = await request(app)
      .get('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`);
    const id = list.body.keys.find((k) => k.name === 'test-client').id;

    const res = await request(app)
      .patch(`/admin/keys/${id}`)
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ rpm: 50 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.key.rpm, 50);
  });

  it('PATCH /admin/keys/:id deactivates client', async () => {
    const list = await request(app)
      .get('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`);
    const id = list.body.keys.find((k) => k.name === 'test-client').id;

    const res = await request(app)
      .patch(`/admin/keys/${id}`)
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ active: 0 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.key.active, 0);
  });

  it('PATCH /admin/keys/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/admin/keys/99999')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ rpm: 5 });

    assert.strictEqual(res.status, 404);
  });

  it('POST /admin/keys/:id/rotate returns new key', async () => {
    // Re-activate and get id
    const list = await request(app)
      .get('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`);
    const id = list.body.keys.find((k) => k.name === 'test-client').id;

    // Re-activate
    await request(app)
      .patch(`/admin/keys/${id}`)
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ active: 1 });

    const res = await request(app)
      .post(`/admin/keys/${id}/rotate`)
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.key.raw_key.startsWith('shellm-'));
    assert.strictEqual(res.body.key.id, id);
  });

  it('POST /admin/keys/:id/rotate returns 404 for unknown id', async () => {
    const res = await request(app)
      .post('/admin/keys/99999/rotate')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 404);
  });

  it('DELETE /admin/keys/:id deletes client', async () => {
    // Create a throwaway client
    const created = await request(app)
      .post('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ name: 'delete-me' });

    const id = created.body.key.id;

    const res = await request(app)
      .delete(`/admin/keys/${id}`)
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.deleted, true);

    // Verify it's gone
    const list = await request(app)
      .get('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`);
    assert.ok(!list.body.keys.find((k) => k.name === 'delete-me'));
  });

  it('DELETE /admin/keys/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/admin/keys/99999')
      .set('Authorization', `Basic ${adminCreds}`);

    assert.strictEqual(res.status, 404);
  });

  it('created key can authenticate to /v1/models', async () => {
    const created = await request(app)
      .post('/admin/keys')
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ name: 'auth-test-client' });

    const rawKey = created.body.key.raw_key;

    const res = await request(app)
      .get('/v1/models')
      .set('Authorization', `Bearer ${rawKey}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.object, 'list');
  });
  describe('renaming a key', () => {
    const createKey = async (name) => {
      const res = await request(app)
        .post('/admin/keys')
        .set('Authorization', `Basic ${adminCreds}`)
        .send({ name })
        .expect(201);
      return res.body.key.id;
    };

    const rename = (id, name) => request(app)
      .patch(`/admin/keys/${id}`)
      .set('Authorization', `Basic ${adminCreds}`)
      .send({ name });

    it('renames the key and keeps its other fields', async () => {
      const id = await createKey('before-rename');

      const res = await rename(id, '  after-rename  ');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.key.name, 'after-rename');
      assert.strictEqual(res.body.key.rpm, 10);
    });

    it('relabels the key\'s logs so filtering by the new name finds its history', async () => {
      const id = await createKey('history-old');
      const otherId = await createKey('history-bystander');
      const { insertRequestLog } = require('../../src/db');
      insertRequestLog({ client_id: id, client_name: 'history-old', status: 200 });
      insertRequestLog({ client_id: otherId, client_name: 'history-bystander', status: 200 });

      await rename(id, 'history-new').expect(200);

      const renamed = await request(app).get('/admin/logs?client=history-new').set('Authorization', `Basic ${adminCreds}`);
      const stale = await request(app).get('/admin/logs?client=history-old').set('Authorization', `Basic ${adminCreds}`);
      const bystander = await request(app).get('/admin/logs?client=history-bystander').set('Authorization', `Basic ${adminCreds}`);
      assert.strictEqual(renamed.body.total, 1);
      assert.strictEqual(stale.body.total, 0);
      assert.strictEqual(bystander.body.total, 1, 'another key\'s logs are untouched');
    });

    it('rejects a name another key already has, and leaves the key as it was', async () => {
      await createKey('taken-name');
      const id = await createKey('wants-taken-name');

      const res = await rename(id, 'taken-name');

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /already exists/);
      const list = await request(app).get('/admin/keys').set('Authorization', `Basic ${adminCreds}`);
      assert.strictEqual(list.body.keys.find((k) => k.id === id).name, 'wants-taken-name');
    });

    it('rejects a blank name', async () => {
      const id = await createKey('not-blankable');

      const res = await rename(id, '   ');

      assert.strictEqual(res.status, 400);
    });
  });

  describe('usage per key', () => {
    it('reports requests, spend and last use for a key', async () => {
      const created = await request(app)
        .post('/admin/keys')
        .set('Authorization', `Basic ${adminCreds}`)
        .send({ name: 'usage-reported' });

      const { insertRequestLog } = require('../../src/db');
      insertRequestLog({ client_id: created.body.key.id, client_name: 'usage-reported', status: 200, tokens: 120, cost_usd: 0.02 });
      insertRequestLog({ client_id: created.body.key.id, client_name: 'usage-reported', status: 400, error_code: 'invalid_request' });

      const res = await request(app).get('/admin/keys').set('Authorization', `Basic ${adminCreds}`);
      const key = res.body.keys.find((k) => k.name === 'usage-reported');

      assert.strictEqual(key.usage.requests, 2);
      assert.strictEqual(key.usage.errors, 1);
      assert.strictEqual(key.usage.tokens, 120);
      assert.ok(key.usage.last_used_at, 'expected a last use timestamp');
    });

    it('gives a recreated name inherits no usage from the key it replaced', async () => {
      const db = require('../../src/db');
      const first = await request(app)
        .post('/admin/keys')
        .set('Authorization', `Basic ${adminCreds}`)
        .send({ name: 'recycled' });

      db.insertRequestLog({ client_id: first.body.key.id, client_name: 'recycled', status: 200, tokens: 999, cost_usd: 5 });

      await request(app)
        .delete(`/admin/keys/${first.body.key.id}`)
        .set('Authorization', `Basic ${adminCreds}`)
        .expect(200);

      const second = await request(app)
        .post('/admin/keys')
        .set('Authorization', `Basic ${adminCreds}`)
        .send({ name: 'recycled' })
        .expect(201);

      const res = await request(app).get('/admin/keys').set('Authorization', `Basic ${adminCreds}`);
      const key = res.body.keys.find((k) => k.id === second.body.key.id);

      assert.strictEqual(key.usage.requests, 0, 'the replacement starts empty');
      assert.strictEqual(key.usage.tokens, 0);
      assert.strictEqual(key.usage.last_used_at, null);
    });
  });
});
