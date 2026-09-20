'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const kindOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

// The dashboard polls /admin/stats before it knows whether a database is open, and reads
// stats.error_rate.success_pct and stats.timeline.slice(-15) with no guard. When the answer given
// without a database carried fewer keys than the populated one, those expressions threw in exactly
// the situation the page exists to report — an operator with no database saw a blank panel instead
// of the reason. Both answers have to describe the same thing, one with nothing in it.
describe('admin /admin/stats shape without a database', () => {
  const adminCreds = Buffer.from('admin:shape-test-password').toString('base64');
  let populated;
  let degraded;

  before(async () => {
    process.env.SHELLM_ADMIN_PASSWORD = 'shape-test-password';

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) delete require.cache[key];
    }

    const { initDb, closeDb, insertRequestLog, createClient } = require('../../src/db');
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');

    insertRequestLog({ request_id: 's1', client_name: 'app1', provider: 'claude', model: 'claude', status: 200, duration_ms: 900, tokens: 120, tokens_in: 100, tokens_out: 20, cost_usd: 0.01 });
    insertRequestLog({ request_id: 's2', client_name: 'app2', provider: 'codex', model: 'codex', status: 500, duration_ms: 80, error_code: 'provider_error', method: 'POST', path: '/v1/messages' });
    createClient({ name: 'shape-client' });

    const request = require('supertest');
    const app = require(path.resolve(__dirname, '../../src/app'));
    const ask = () => request(app).get('/admin/stats?period=24h').set('Authorization', `Basic ${adminCreds}`);

    populated = (await ask()).body;
    require('../../src/db').closeDb();
    degraded = (await ask()).body;
  });

  after(() => {
    delete process.env.SHELLM_ADMIN_PASSWORD;
    try { require('../../src/db').closeDb(); } catch { /* already closed */ }
  });

  it('answers with a database open', () => {
    assert.strictEqual(populated.total_requests, 2, 'the populated answer is the reference, so it must be real');
    assert.ok(populated.timeline.length > 0);
  });

  it('names every key the populated answer names, and no others', () => {
    const expected = Object.keys(populated).sort();
    const actual = Object.keys(degraded).sort();

    assert.deepStrictEqual(actual, expected);
  });

  it('keeps every list a list, so the page can slice it', () => {
    const lists = Object.keys(populated).filter((key) => Array.isArray(populated[key]));
    assert.ok(lists.length > 0, 'the populated answer carries no list — if that became true, delete this test');

    for (const key of lists) {
      assert.ok(Array.isArray(degraded[key]), `${key} is ${kindOf(degraded[key])} without a database, and the page slices it`);
    }
  });

  it('keeps every count a number, so the page can do arithmetic on it', () => {
    for (const key of Object.keys(populated).filter((k) => typeof populated[k] === 'number')) {
      assert.strictEqual(typeof degraded[key], 'number', `${key} is ${kindOf(degraded[key])} without a database`);
    }
  });

  it('carries the full error_rate sub-shape', () => {
    assert.deepStrictEqual(Object.keys(degraded.error_rate).sort(), Object.keys(populated.error_rate).sort());

    for (const key of Object.keys(populated.error_rate)) {
      assert.strictEqual(kindOf(degraded.error_rate[key]), kindOf(populated.error_rate[key]), `error_rate.${key}`);
    }
    assert.strictEqual(degraded.error_rate.success_pct, 0);
  });
});
