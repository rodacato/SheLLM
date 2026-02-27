const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('getCachedProviderStatus', () => {
  let getHealthStatus;
  let getCachedProviderStatus;

  before(() => {
    mock.module(path.resolve(__dirname, '../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: 'v1.0.0',
          stderr: '',
          duration_ms: 10,
        })),
      },
    });

    process.env.CEREBRAS_API_KEY = 'test-key-health-cache';

    for (const key of Object.keys(require.cache)) {
      if (key.includes('src/providers/') || key.includes('src/router') || key.includes('src/health')) {
        delete require.cache[key];
      }
    }

    ({ getHealthStatus, getCachedProviderStatus } = require('../src/health'));
  });

  it('returns null when cache is empty', () => {
    // getCachedProviderStatus before any getHealthStatus call
    // Note: cache may already be populated from other test files in same runner,
    // but if we just cleared modules, the new module instance starts with empty cache
    const result = getCachedProviderStatus('nonexistent_provider');
    assert.strictEqual(result, null);
  });

  it('returns provider status after cache is populated', async () => {
    await getHealthStatus();
    const claude = getCachedProviderStatus('claude');
    assert.ok(claude);
    assert.strictEqual(typeof claude.installed, 'boolean');
    assert.strictEqual(typeof claude.authenticated, 'boolean');
  });

  it('returns null for unknown provider name', async () => {
    await getHealthStatus();
    const result = getCachedProviderStatus('unknown_provider');
    assert.strictEqual(result, null);
  });
});
