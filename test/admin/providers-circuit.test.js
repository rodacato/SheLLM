'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('POST /admin/providers/:name/circuit/reset', () => {
  const adminCreds = Buffer.from('admin:test-admin-pass').toString('base64');
  let request;
  let app;
  let circuit;

  before(() => {
    process.env.SHELLM_ADMIN_PASSWORD = 'test-admin-pass';
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) delete require.cache[key];
    }
    const { initDb } = require('../../src/db');
    initDb(':memory:');
    request = require('supertest');
    app = require('../../src/server');
    circuit = require('../../src/infra/circuit-breaker');
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
  });

  const reset = (name) => request(app).post(`/admin/providers/${name}/circuit/reset`).set('Authorization', `Basic ${adminCreds}`);

  it('routes to an open provider again at once', async () => {
    for (let i = 0; i < 3; i++) circuit.recordFailure('claude', { status: 502, code: 'cli_failed', message: 'claude: refused' });
    assert.equal(circuit.getCircuitState('claude').state, 'open');

    const res = await reset('claude');
    assert.equal(res.status, 200);
    assert.equal(res.body.circuit.state, 'closed');
    assert.equal(res.body.circuit.failures, 0);
    assert.equal(circuit.canSendTraffic('claude'), true);
  });

  it('refuses a provider that does not exist, and creates no circuit for it', async () => {
    const res = await reset('gemini');
    assert.equal(res.status, 400);
    assert.equal(Object.hasOwn(circuit.getAllCircuitStates(), 'gemini'), false);
  });

  it('is not open to a caller without the admin password', async () => {
    const res = await request(app).post('/admin/providers/claude/circuit/reset');
    assert.equal(res.status, 401);
  });
});
