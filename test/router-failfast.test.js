const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('router fail-fast on unauthenticated provider', () => {
  let route;

  before(() => {
    mock.module(path.resolve(__dirname, '../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async () => ({
          stdout: JSON.stringify({ result: 'test' }),
          stderr: '',
          duration_ms: 10,
        })),
      },
    });

    // Mock health module to return unauthenticated status for claude
    mock.module(path.resolve(__dirname, '../src/health.js'), {
      namedExports: {
        getCachedProviderStatus: mock.fn((name) => {
          if (name === 'claude') {
            return { installed: true, authenticated: false };
          }
          return { installed: true, authenticated: true };
        }),
        getHealthStatus: mock.fn(async () => ({ status: 'ok' })),
      },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) {
        delete require.cache[key];
      }
    }

    ({ route } = require('../src/router'));
  });

  it('throws provider_unavailable when provider is not authenticated', async () => {
    await assert.rejects(
      () => route({ model: 'claude', prompt: 'hello' }),
      (err) => {
        assert.strictEqual(err.status, 503);
        assert.strictEqual(err.code, 'provider_unavailable');
        assert.match(err.message, /not authenticated/);
        return true;
      }
    );
  });
});
