const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthMiddleware } = require('../../src/middleware/auth');

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

describe('auth middleware', () => {
  let savedClients;

  beforeEach(() => {
    savedClients = process.env.SHELLM_CLIENTS;
  });

  afterEach(() => {
    if (savedClients !== undefined) {
      process.env.SHELLM_CLIENTS = savedClients;
    } else {
      delete process.env.SHELLM_CLIENTS;
    }
  });

  it('auth disabled when SHELLM_CLIENTS not set', () => {
    delete process.env.SHELLM_CLIENTS;
    const middleware = createAuthMiddleware();
    const next = mock.fn();
    middleware({}, {}, next);
    assert.strictEqual(next.mock.callCount(), 1);
  });

  it('rejects missing and invalid Bearer tokens', () => {
    process.env.SHELLM_CLIENTS = JSON.stringify({ testclient: { key: 'test-valid-key-abc123', rpm: 10 } });
    const middleware = createAuthMiddleware();

    // Missing header
    const res1 = mockRes();
    middleware({ headers: {}, requestId: 'req-1' }, res1, mock.fn());
    assert.strictEqual(res1._status, 401);
    assert.strictEqual(res1._body.error, 'auth_required');

    // Wrong token
    const res2 = mockRes();
    middleware({ headers: { authorization: 'Bearer wrong-token-xyz789' }, requestId: 'req-2' }, res2, mock.fn());
    assert.strictEqual(res2._status, 401);
  });

  it('accepts valid Bearer token and sets clientName', () => {
    process.env.SHELLM_CLIENTS = JSON.stringify({ testclient: { key: 'test-valid-key-abc123', rpm: 100 } });
    const middleware = createAuthMiddleware();
    const req = { headers: { authorization: 'Bearer test-valid-key-abc123' }, requestId: 'req-3' };
    const next = mock.fn();
    middleware(req, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
    assert.strictEqual(req.clientName, 'testclient');
  });
});
