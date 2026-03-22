const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('health parseCheckError', () => {
  let parseCheckError;

  before(() => {
    mock.module(path.resolve(__dirname, '../src/providers/base.js'), {
      namedExports: {
        execute: async () => ({ stdout: '', stderr: '', duration_ms: 0 }),
      },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('src/health') || key.includes('src/providers/') || key.includes('src/router')) {
        delete require.cache[key];
      }
    }

    ({ parseCheckError } = require('../src/health'));
  });

  it('treats ENOENT / not found as not installed', () => {
    const result = parseCheckError({ code: -1, stderr: 'command not found' });
    assert.strictEqual(result.installed, false);
    assert.strictEqual(result.authenticated, false);
  });

  it('treats keychain fallback with cached credentials as authenticated', () => {
    const result = parseCheckError({
      code: 1,
      stderr: 'Keychain error: libsecret-1.so.0 not found. Using FileKeychain fallback for secure storage. Loaded cached credentials.',
    });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, true);
  });

  it('treats FileKeychain fallback alone as authenticated', () => {
    const result = parseCheckError({
      code: 1,
      stderr: 'Using FileKeychain fallback.',
    });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, true);
  });

  it('treats "not authenticated" stderr as unauthenticated', () => {
    const result = parseCheckError({
      code: 1,
      stderr: 'Error: not authenticated. Please run login first.',
    });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, false);
  });

  it('treats "please login" as unauthenticated', () => {
    const result = parseCheckError({ code: 1, stderr: 'Please login to continue' });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, false);
  });

  it('treats "unauthenticated" as unauthenticated', () => {
    const result = parseCheckError({ code: 1, stderr: 'Request failed: unauthenticated' });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, false);
  });

  it('redacts long tokens in error messages', () => {
    const longToken = 'a'.repeat(40);
    const result = parseCheckError({ code: 1, stderr: `Failed with token ${longToken}` });
    assert.ok(result.error.includes('[REDACTED]'));
    assert.ok(!result.error.includes(longToken));
  });

  it('truncates error to 200 chars', () => {
    const result = parseCheckError({ code: 1, stderr: 'x'.repeat(500) });
    assert.ok(result.error.length <= 200);
  });

  it('unknown error returns installed but not authenticated', () => {
    const result = parseCheckError({ code: 1, stderr: 'some random error' });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, false);
    assert.strictEqual(result.error, 'some random error');
  });
});
