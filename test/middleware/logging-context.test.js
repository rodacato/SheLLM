'use strict';

const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('request context in the log', () => {
  let request, app, getDb, rawKey;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({ stdout: 'v1.0.0', stderr: '', duration_ms: 10 })),
        stripNonPrintable: (t) => t,
      },
    });
    mock.module('dotenv', { namedExports: { config: () => {} }, defaultExport: { config: () => {} } });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    const db = require('../../src/db');
    try { db.closeDb(); } catch { /* not open */ }
    db.initDb(':memory:');
    getDb = db.getDb;
    rawKey = db.createClient({ name: 'context-test', rpm: 100 }).rawKey;

    request = require('supertest');
    app = require('../../src/server');
  });

  after(() => {
    const { closeDb } = require('../../src/db');
    closeDb();
  });

  const lastLog = () => getDb().prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT 1').get();

  it('records the route a failed request asked for', async () => {
    await request(app)
      .post('/v1/chat/completions?trace=abc')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ model: 'claude' })
      .expect(400);

    const row = lastLog();
    assert.strictEqual(row.method, 'POST');
    assert.strictEqual(row.path, '/v1/chat/completions', 'the query string stays out of the log');
  });

  it('records the error code the caller received', async () => {
    await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer shellm-not-a-real-key')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
      .expect(401);

    assert.strictEqual(lastLog().error_code, 'auth_required');
  });

  it('leaves the error code null on a request that succeeded', async () => {
    await request(app)
      .get('/v1/models')
      .set('Authorization', `Bearer ${rawKey}`)
      .expect(200);

    const row = lastLog();
    assert.strictEqual(row.error_code, null);
    assert.strictEqual(row.path, '/v1/models');
  });
});
