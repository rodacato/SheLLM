'use strict';

const { describe, it, mock, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mockReq(headers = {}, extra = {}) {
  return { headers, requestId: 'test-123', ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, ...extra };
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
  let createAdminAuth, failedAttempts, validatePasswordStrength;
  let mockWarn, mockInfo;

  before(() => {
    mockWarn = mock.fn();
    mockInfo = mock.fn();

    mock.module(path.resolve(__dirname, '../../src/lib/logger.js'), {
      namedExports: {
        debug: mock.fn(),
        info: mockInfo,
        warn: mockWarn,
        error: mock.fn(),
      },
    });

    delete require.cache[require.resolve('../../src/middleware/admin-auth')];
    ({ createAdminAuth, failedAttempts, validatePasswordStrength } = require('../../src/middleware/admin-auth'));
  });

  beforeEach(() => {
    failedAttempts.clear();
    mockWarn.mock.resetCalls();
    mockInfo.mock.resetCalls();
  });

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
    let originalPassword, originalUser;

    before(() => {
      originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      originalUser = process.env.SHELLM_ADMIN_USER;
      process.env.SHELLM_ADMIN_PASSWORD = 'test-secret-long-password';
      delete process.env.SHELLM_ADMIN_USER;
      middleware = createAdminAuth();
    });

    after(() => {
      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.SHELLM_ADMIN_PASSWORD;
      }
      if (originalUser !== undefined) {
        process.env.SHELLM_ADMIN_USER = originalUser;
      } else {
        delete process.env.SHELLM_ADMIN_USER;
      }
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
      const encoded = Buffer.from('admin:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
    });

    it('accepts any username with correct password', () => {
      const encoded = Buffer.from('operator:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
    });
  });

  describe('rate limiting', () => {
    let middleware;
    let originalPassword;

    before(() => {
      originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      process.env.SHELLM_ADMIN_PASSWORD = 'test-secret-long-password';
      middleware = createAdminAuth();
    });

    after(() => {
      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.SHELLM_ADMIN_PASSWORD;
      }
    });

    it('allows up to ADMIN_MAX_ATTEMPTS failures before blocking', () => {
      const wrongEncoded = Buffer.from('admin:wrong').toString('base64');

      for (let i = 0; i < 5; i++) {
        const req = mockReq({ authorization: `Basic ${wrongEncoded}` });
        const res = mockRes();
        middleware(req, res, () => {});
        assert.strictEqual(res.statusCode, 401, `attempt ${i + 1} should return 401`);
      }

      // 6th attempt should be rate limited
      const req = mockReq({ authorization: `Basic ${wrongEncoded}` });
      const res = mockRes();
      middleware(req, res, () => {});
      assert.strictEqual(res.statusCode, 429);
      assert.ok(res._body.retry_after);
    });

    it('rate limit is per-IP — different IPs are independent', () => {
      const wrongEncoded = Buffer.from('admin:wrong').toString('base64');

      // Exhaust attempts from IP-A
      for (let i = 0; i < 5; i++) {
        const req = mockReq({ authorization: `Basic ${wrongEncoded}` }, { ip: '10.0.0.1' });
        const res = mockRes();
        middleware(req, res, () => {});
      }

      // IP-B should still work with correct credentials
      const correctEncoded = Buffer.from('admin:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${correctEncoded}` }, { ip: '10.0.0.2' });
      const res = mockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
    });

    it('rate limit clears after window expires', () => {
      const wrongEncoded = Buffer.from('admin:wrong').toString('base64');

      // Fill up failures
      for (let i = 0; i < 5; i++) {
        const req = mockReq({ authorization: `Basic ${wrongEncoded}` }, { ip: '10.0.0.3' });
        const res = mockRes();
        middleware(req, res, () => {});
      }

      // Simulate window expiry by setting old timestamps
      const timestamps = failedAttempts.get('10.0.0.3');
      const oldTime = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      for (let i = 0; i < timestamps.length; i++) {
        timestamps[i] = oldTime;
      }

      // Should no longer be blocked
      const correctEncoded = Buffer.from('admin:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${correctEncoded}` }, { ip: '10.0.0.3' });
      const res = mockRes();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
    });

    it('returns Retry-After header when rate limited', () => {
      const wrongEncoded = Buffer.from('admin:wrong').toString('base64');

      for (let i = 0; i < 5; i++) {
        const req = mockReq({ authorization: `Basic ${wrongEncoded}` }, { ip: '10.0.0.4' });
        const res = mockRes();
        middleware(req, res, () => {});
      }

      const req = mockReq({ authorization: `Basic ${wrongEncoded}` }, { ip: '10.0.0.4' });
      const res = mockRes();
      middleware(req, res, () => {});
      assert.ok(res._headers['Retry-After']);
      assert.strictEqual(typeof parseInt(res._headers['Retry-After'], 10), 'number');
    });
  });

  describe('logging', () => {
    let middleware;
    let originalPassword;

    before(() => {
      originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      process.env.SHELLM_ADMIN_PASSWORD = 'test-secret-long-password';
      delete process.env.SHELLM_ADMIN_USER;
      middleware = createAdminAuth();
    });

    after(() => {
      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.SHELLM_ADMIN_PASSWORD;
      }
    });

    it('logs admin_auth_failure with reason=missing_header', () => {
      const req = mockReq();
      const res = mockRes();
      middleware(req, res, () => {});

      const call = mockWarn.mock.calls.find(c => c.arguments[0].event === 'admin_auth_failure');
      assert.ok(call, 'expected admin_auth_failure log');
      assert.strictEqual(call.arguments[0].reason, 'missing_header');
      assert.strictEqual(call.arguments[0].ip, '127.0.0.1');
    });

    it('logs admin_auth_failure with reason=wrong_password', () => {
      const encoded = Buffer.from('testuser:wrong').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      middleware(req, res, () => {});

      const call = mockWarn.mock.calls.find(c =>
        c.arguments[0].event === 'admin_auth_failure' && c.arguments[0].reason === 'wrong_password');
      assert.ok(call, 'expected wrong_password log');
      assert.strictEqual(call.arguments[0].username, 'testuser');
    });

    it('logs admin_auth_success on valid login', () => {
      const encoded = Buffer.from('admin:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      middleware(req, res, () => {});

      const call = mockInfo.mock.calls.find(c => c.arguments[0].event === 'admin_auth_success');
      assert.ok(call, 'expected admin_auth_success log');
      assert.strictEqual(call.arguments[0].username, 'admin');
      assert.strictEqual(call.arguments[0].ip, '127.0.0.1');
    });

    it('logs admin_auth_blocked when IP is rate-limited', () => {
      const wrongEncoded = Buffer.from('admin:wrong').toString('base64');

      for (let i = 0; i < 5; i++) {
        const req = mockReq({ authorization: `Basic ${wrongEncoded}` }, { ip: '10.0.0.10' });
        const res = mockRes();
        middleware(req, res, () => {});
      }
      mockWarn.mock.resetCalls();

      const req = mockReq({ authorization: `Basic ${wrongEncoded}` }, { ip: '10.0.0.10' });
      const res = mockRes();
      middleware(req, res, () => {});

      const call = mockWarn.mock.calls.find(c => c.arguments[0].event === 'admin_auth_blocked');
      assert.ok(call, 'expected admin_auth_blocked log');
      assert.strictEqual(call.arguments[0].reason, 'rate_limited');
    });
  });

  describe('validatePasswordStrength', () => {
    it('warns on short passwords', () => {
      const warnings = validatePasswordStrength('short');
      assert.ok(warnings.some(w => w.includes('5 chars')));
    });

    it('warns on common passwords', () => {
      for (const weak of ['password', 'admin', '123456']) {
        const warnings = validatePasswordStrength(weak);
        assert.ok(warnings.some(w => w.includes('commonly-used')), `expected warning for "${weak}"`);
      }
    });

    it('returns empty array for strong passwords', () => {
      const warnings = validatePasswordStrength('xK9$mP2vL7nQ4wR8');
      assert.strictEqual(warnings.length, 0);
    });

    it('logs warning at startup for weak password', () => {
      const originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      process.env.SHELLM_ADMIN_PASSWORD = 'admin';
      mockWarn.mock.resetCalls();

      createAdminAuth();

      const calls = mockWarn.mock.calls.filter(c => c.arguments[0].event === 'admin_password_weak');
      assert.ok(calls.length > 0, 'expected admin_password_weak warning');

      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.SHELLM_ADMIN_PASSWORD;
      }
    });

    it('does not log warning for strong password', () => {
      const originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      process.env.SHELLM_ADMIN_PASSWORD = 'xK9$mP2vL7nQ4wR8';
      mockWarn.mock.resetCalls();

      createAdminAuth();

      const calls = mockWarn.mock.calls.filter(c => c.arguments[0].event === 'admin_password_weak');
      assert.strictEqual(calls.length, 0);

      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.SHELLM_ADMIN_PASSWORD;
      }
    });
  });

  describe('username validation (SHELLM_ADMIN_USER)', () => {
    let middleware;
    let originalPassword, originalUser;

    before(() => {
      originalPassword = process.env.SHELLM_ADMIN_PASSWORD;
      originalUser = process.env.SHELLM_ADMIN_USER;
      process.env.SHELLM_ADMIN_PASSWORD = 'test-secret-long-password';
      process.env.SHELLM_ADMIN_USER = 'myadmin';
      middleware = createAdminAuth();
    });

    after(() => {
      if (originalPassword !== undefined) {
        process.env.SHELLM_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.SHELLM_ADMIN_PASSWORD;
      }
      if (originalUser !== undefined) {
        process.env.SHELLM_ADMIN_USER = originalUser;
      } else {
        delete process.env.SHELLM_ADMIN_USER;
      }
    });

    it('rejects wrong username when SHELLM_ADMIN_USER is set', () => {
      const encoded = Buffer.from('wronguser:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('accepts correct username + password', () => {
      const encoded = Buffer.from('myadmin:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      let nextCalled = false;

      middleware(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
    });

    it('logs wrong_username reason on mismatch', () => {
      const encoded = Buffer.from('wronguser:test-secret-long-password').toString('base64');
      const req = mockReq({ authorization: `Basic ${encoded}` });
      const res = mockRes();
      middleware(req, res, () => {});

      const call = mockWarn.mock.calls.find(c =>
        c.arguments[0].event === 'admin_auth_failure' && c.arguments[0].reason === 'wrong_username');
      assert.ok(call, 'expected wrong_username log');
      assert.strictEqual(call.arguments[0].username, 'wronguser');
    });
  });
});
