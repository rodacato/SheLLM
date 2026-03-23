const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb, createClient } = require('../../src/db');
const { createAuthMiddleware } = require('../../src/middleware/auth');

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

describe('auth middleware', () => {
  beforeEach(() => {
    initDb(':memory:');
  });

  afterEach(() => {
    closeDb();
  });

  it('rejects requests when no Bearer token is provided, even without DB clients', () => {
    const middleware = createAuthMiddleware();
    const res = mockRes();
    middleware({ headers: {}, requestId: 'req-1' }, res, mock.fn());
    assert.strictEqual(res._status, 401);
  });

  it('rejects missing and invalid Bearer tokens', () => {
    createClient({ name: 'testclient', rpm: 10 });
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
    const client = createClient({ name: 'testclient', rpm: 100 });
    const middleware = createAuthMiddleware();
    const req = { headers: { authorization: `Bearer ${client.rawKey}` }, requestId: 'req-3' };
    const next = mock.fn();
    middleware(req, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
    assert.strictEqual(req.clientName, 'testclient');
  });

  it('sets allowedModels from client with model restrictions', () => {
    const client = createClient({ name: 'restricted-client', rpm: 100, models: ['claude', 'gemini'] });
    const middleware = createAuthMiddleware();
    const req = { headers: { authorization: `Bearer ${client.rawKey}` }, requestId: 'req-4' };
    const next = mock.fn();
    middleware(req, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
    assert.deepStrictEqual(req.allowedModels, ['claude', 'gemini']);
  });

  it('sets allowedModels to null when client has no model restriction', () => {
    const client = createClient({ name: 'unrestricted-client', rpm: 100 });
    const middleware = createAuthMiddleware();
    const req = { headers: { authorization: `Bearer ${client.rawKey}` }, requestId: 'req-5' };
    const next = mock.fn();
    middleware(req, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
    assert.strictEqual(req.allowedModels, null);
  });

  // --- F-02: SHELLM_REQUIRE_AUTH ---

  it('REQUIRE_AUTH=false with empty DB allows anonymous access', () => {
    const saved = process.env.SHELLM_REQUIRE_AUTH;
    process.env.SHELLM_REQUIRE_AUTH = 'false';

    // Re-require to pick up new env value
    delete require.cache[require.resolve('../../src/middleware/auth')];
    const { createAuthMiddleware: freshAuth } = require('../../src/middleware/auth');
    const middleware = freshAuth();

    const req = { headers: {}, requestId: 'req-anon' };
    const next = mock.fn();
    middleware(req, mockRes(), next);
    assert.strictEqual(next.mock.callCount(), 1);
    assert.strictEqual(req.clientName, '_anonymous');
    assert.strictEqual(req.allowedModels, null);

    // Restore
    if (saved !== undefined) process.env.SHELLM_REQUIRE_AUTH = saved;
    else delete process.env.SHELLM_REQUIRE_AUTH;
    delete require.cache[require.resolve('../../src/middleware/auth')];
  });

  it('REQUIRE_AUTH=true (default) with empty DB rejects requests', () => {
    const saved = process.env.SHELLM_REQUIRE_AUTH;
    delete process.env.SHELLM_REQUIRE_AUTH;

    delete require.cache[require.resolve('../../src/middleware/auth')];
    const { createAuthMiddleware: freshAuth } = require('../../src/middleware/auth');
    const middleware = freshAuth();

    const res = mockRes();
    middleware({ headers: {}, requestId: 'req-reject' }, res, mock.fn());
    assert.strictEqual(res._status, 401);

    if (saved !== undefined) process.env.SHELLM_REQUIRE_AUTH = saved;
    delete require.cache[require.resolve('../../src/middleware/auth')];
  });
});
