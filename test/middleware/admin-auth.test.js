const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createAdminAuth } = require('../../src/middleware/admin-auth');

function mockReq(headers = {}) {
  return { headers, requestId: 'test-123' };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _body: null,
    _headers: {},
    status(code) { res.statusCode = code; return res; },
    json(body) { res._body = body; return res; },
    set(key, val) { res._headers[key] = val; return res; },
  };
  return res;
}

describe('admin-auth middleware', () => {
  describe('when SHELLM_ADMIN_PASSWORD is not set', () => {
    let originalPassword;

    before(() => {
      originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      delete process.env.SHELLM_ADMIN_PASSWORD;
    });

    after(() => {
      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      }
    });

    it('returns 501 admin_disabled', () => {
      const middleware = createAdminAuth();
      const req = mockReq();
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res.statusCode, 501);
      assert.match(res._body.message, /SHELLM_ADMIN_PASSWORD/);
      assert.strictEqual(nextCalled, false);
    });
  });

  describe('when SHELLM_ADMIN_PASSWORD is set', () => {
    let middleware;

    before(() => {
      process.env.SHELLM_ADMIN_PASSWORD = 'test-secret';
      middleware = createAdminAuth();
    });

    after(() => {
      delete process.env.SHELLM_ADMIN_PASSWORD;
    });

    it('rejects missing Authorization header', () => {
      const req = mockReq();
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res.statusCode, 401);
      assert.ok(res._headers['WWW-Authenticate']);
      assert.strictEqual(nextCalled, false);
    });

    it('rejects Bearer token (needs Basic)', () => {
      const req = mockReq({ authorization: 'Bearer some-token' });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('rejects wrong password', () => {
      const encoded = Buffer.from('admin:wrong-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('accepts correct credentials', () => {
      const encoded = Buffer.from('admin:test-secret').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
    });

    it('accepts any username with correct password', () => {
      const encoded = Buffer.from('operator:test-secret').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
    });
  });
});
