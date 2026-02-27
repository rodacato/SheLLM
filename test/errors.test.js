const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  invalidRequest,
  authRequired,
  rateLimited,
  cliFailed,
  providerUnavailable,
  timeout,
  fromCatchable,
  sendError,
} = require('../src/errors');

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  res.set = (key, val) => { res._headers[key] = val; return res; };
  return res;
}

describe('errors', () => {
  it('invalidRequest returns 400 with correct shape', () => {
    const err = invalidRequest('bad input');
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.code, 'invalid_request');
    assert.strictEqual(err.message, 'bad input');
  });

  it('all factories return status, code, and message', () => {
    const cases = [
      { fn: () => authRequired(), status: 401, code: 'auth_required' },
      { fn: () => rateLimited('slow down', 15), status: 429, code: 'rate_limited' },
      { fn: () => cliFailed('claude', 'crash'), status: 502, code: 'cli_failed' },
      { fn: () => providerUnavailable('down'), status: 503, code: 'provider_unavailable' },
      { fn: () => timeout('claude'), status: 504, code: 'timeout' },
    ];

    for (const { fn, status, code } of cases) {
      const err = fn();
      assert.strictEqual(err.status, status);
      assert.strictEqual(err.code, code);
      assert.strictEqual(typeof err.message, 'string');
    }

    // rateLimited includes retry_after
    const rl = rateLimited('wait', 30);
    assert.strictEqual(rl.retry_after, 30);

    // cliFailed truncates to 500 chars
    const long = cliFailed('claude', 'x'.repeat(600));
    assert.ok(long.message.length <= 500);
  });

  it('fromCatchable normalizes error shapes', () => {
    // Already structured — returned as-is
    const structured = { code: 'custom', status: 418, message: 'teapot' };
    assert.deepStrictEqual(fromCatchable(structured, 'claude'), structured);

    // Timeout
    const to = fromCatchable({ timeout: true }, 'claude');
    assert.strictEqual(to.status, 504);
    assert.strictEqual(to.code, 'timeout');

    // Provider unavailable
    const pu = fromCatchable({ provider_unavailable: true, message: 'down' }, 'cerebras');
    assert.strictEqual(pu.status, 503);

    // Rate limited
    const rl = fromCatchable({ status: 429, message: 'slow down' }, 'claude');
    assert.strictEqual(rl.status, 429);

    // Invalid request
    const ir = fromCatchable({ status: 400, message: 'bad' }, 'claude');
    assert.strictEqual(ir.status, 400);

    // Default: cli_failed
    const cf = fromCatchable({ stderr: 'crash' }, 'gemini');
    assert.strictEqual(cf.status, 502);
    assert.strictEqual(cf.code, 'cli_failed');
  });

  it('sendError writes correct JSON response', () => {
    const res = mockRes();
    sendError(res, invalidRequest('bad'), 'req-123');
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._body.error, 'invalid_request');
    assert.strictEqual(res._body.message, 'bad');
    assert.strictEqual(res._body.request_id, 'req-123');
  });

  it('sendError includes retry_after when present', () => {
    const res = mockRes();
    sendError(res, rateLimited('wait', 15), 'req-456');
    assert.strictEqual(res._status, 429);
    assert.strictEqual(res._body.retry_after, 15);
    assert.strictEqual(res._body.request_id, 'req-456');
    assert.strictEqual(res._headers['Retry-After'], '15');
  });
});
