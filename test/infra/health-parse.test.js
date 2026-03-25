const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('health parseCheckError', () => {
  let parseCheckError;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: {
        execute: async () => ({ stdout: '', stderr: '', duration_ms: 0 }),
        stripNonPrintable: (t) => t,
      },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('src/infra/') || key.includes('src/providers/') || key.includes('src/routing')) {
        delete require.cache[key];
      }
    }

    ({ parseCheckError } = require('../../src/infra/health'));
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

  it('treats yolo/approval-mode warnings as authenticated', () => {
    const result = parseCheckError({
      code: 1,
      stderr: 'Warning: Running in yolo mode, all actions will be auto-approved',
    });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, true);
  });

  it('treats approval-mode stderr as authenticated', () => {
    const result = parseCheckError({
      code: 1,
      stderr: 'approval mode set to auto-approve',
    });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, true);
  });

  it('redacts short API keys with known prefixes', () => {
    const result = parseCheckError({ code: 1, stderr: 'Invalid key: sk-abc123def456xyz' });
    assert.ok(result.error.includes('[REDACTED]'));
    assert.ok(!result.error.includes('sk-abc123'));
  });

  it('redacts Cerebras keys', () => {
    const result = parseCheckError({ code: 1, stderr: 'Auth failed: csk-abcdef1234567890' });
    assert.ok(result.error.includes('[REDACTED]'));
    assert.ok(!result.error.includes('csk-abcdef'));
  });

  it('redacts SheLLM keys', () => {
    const result = parseCheckError({ code: 1, stderr: 'Key: shellm-8da5176b9c89d4264bfbd37c' });
    assert.ok(result.error.includes('[REDACTED]'));
    assert.ok(!result.error.includes('shellm-8da5'));
  });

  it('redacts Bearer tokens', () => {
    const result = parseCheckError({ code: 1, stderr: 'Authorization: Bearer eyJhbGciOi.payload.sig' });
    assert.ok(result.error.includes('Bearer [REDACTED]'));
    assert.ok(!result.error.includes('eyJhbGciOi'));
  });

  it('does not redact short strings without known prefixes', () => {
    const result = parseCheckError({ code: 1, stderr: 'Error code: 42' });
    assert.strictEqual(result.error, 'Error code: 42');
  });

  it('unknown error returns installed but not authenticated', () => {
    const result = parseCheckError({ code: 1, stderr: 'some random error' });
    assert.strictEqual(result.installed, true);
    assert.strictEqual(result.authenticated, false);
    assert.strictEqual(result.error, 'some random error');
  });
});
