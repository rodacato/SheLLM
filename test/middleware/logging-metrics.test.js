'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const { initDb, closeDb, getDb } = require('../../src/db');
const { requestLogger } = require('../../src/middleware/logging');

function fireRequest(locals, statusCode = 200) {
  const req = { method: 'POST', url: '/v1/chat/completions', requestId: 'req-1', clientName: 'app1' };
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.locals = locals;
  requestLogger(req, res, () => {});
  res.emit('finish');
}

describe('request logging — metrics persisted', () => {
  before(() => {
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');
  });

  after(() => closeDb());

  it('counts cache reads and writes as billable tokens', () => {
    fireRequest({
      provider: 'claude',
      model: 'claude',
      usage: {
        input_tokens: 10, output_tokens: 61,
        cache_creation_input_tokens: 8190, cache_read_input_tokens: 20828,
      },
      metrics: { ttft_ms: 1387, api_ms: 2147, upstream_model: 'claude-haiku-4-5', api_error_status: null },
      cost_usd: 0.0197,
      queued_ms: 12,
    });

    const row = getDb().prepare('SELECT * FROM request_logs WHERE request_id = ?').get('req-1');

    assert.equal(row.tokens, 29089, 'in + out alone would record 71');
    assert.equal(row.cache_write_tokens, 8190);
    assert.equal(row.cache_read_tokens, 20828);
    assert.equal(row.ttft_ms, 1387);
    assert.equal(row.upstream_model, 'claude-haiku-4-5');
    assert.equal(row.streamed, 0);
  });

  it('records a streamed request as streamed', () => {
    fireRequest({ provider: 'claude', model: 'claude', streamed: 1, usage: null, metrics: null });
    const row = getDb().prepare("SELECT streamed, tokens FROM request_logs WHERE request_id = 'req-1' ORDER BY id DESC").get();
    assert.equal(row.streamed, 1);
    assert.equal(row.tokens, null, 'no usage reported means no token count, not zero');
  });
});
