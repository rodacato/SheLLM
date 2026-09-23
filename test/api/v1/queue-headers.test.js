'use strict';

const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('queue headers on a /v1 response', () => {
  let request;
  let app;
  let authHeader;

  before(() => {
    mock.module(path.resolve(__dirname, '../../../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async (cmd) => ({
          stdout: cmd === 'claude'
            ? JSON.stringify({ result: 'queued reply', cost_usd: 0.002, usage: { input_tokens: 5, output_tokens: 3 } })
            : 'queued reply',
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

    process.env.SHELLM_GLOBAL_RPM = '200';
    process.env.SHELLM_CORS_ORIGINS = 'https://bench.example';

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/') || key.includes('dotenv')) delete require.cache[key];
    }

    const { initDb, closeDb, createClient } = require('../../../src/db');
    try { closeDb(); } catch { /* not open yet */ }
    initDb(':memory:');
    authHeader = `Bearer ${createClient({ name: 'queue-header-client', rpm: 100 }).rawKey}`;

    request = require('supertest');
    app = require('../../../src/server');
  });

  after(() => {
    delete process.env.SHELLM_CORS_ORIGINS;
    require('../../../src/db').closeDb();
  });

  it('states the wait and the position on an OpenAI response', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', authHeader)
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    // Nothing else is running in this test, so the request took a slot straight away.
    assert.equal(res.headers['x-shellm-queue-position'], '0');
    assert.match(res.headers['x-shellm-queue-ms'], /^\d+$/);
  });

  it('states the wait and the position on an Anthropic response', async () => {
    const res = await request(app)
      .post('/v1/messages')
      .set('Authorization', authHeader)
      .send({ model: 'claude', max_tokens: 32, messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    assert.equal(res.headers['x-shellm-queue-position'], '0');
    assert.match(res.headers['x-shellm-queue-ms'], /^\d+$/);
  });

  it('lets a browser read them, or they might as well not be there', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', authHeader)
      .set('Origin', 'https://bench.example')
      .send({ model: 'claude', messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    const exposed = res.headers['access-control-expose-headers'];
    assert.match(exposed, /x-shellm-queue-ms/);
    assert.match(exposed, /x-shellm-queue-position/);
  });

  it('announces the position on a stream before any content', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', authHeader)
      .send({ model: 'claude', stream: true, messages: [{ role: 'user', content: 'hello' }] })
      .expect(200);

    assert.match(res.headers['content-type'], /text\/event-stream/);
    assert.equal(res.headers['x-shellm-queue-position'], '0');
  });
});
