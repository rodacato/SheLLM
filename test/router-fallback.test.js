const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('router fallback', () => {
  let route;

  before(() => {
    // Enable fallback globally for these tests
    process.env.SHELLM_FALLBACK_ENABLED = 'true';
    process.env.CIRCUIT_BREAKER_THRESHOLD = '3';

    mock.module(path.resolve(__dirname, '../src/providers/base.js'), {
      namedExports: {
        execute: mock.fn(async (cmd) => {
          if (cmd === 'claude') throw Object.assign(new Error('auth expired'), { stderr: 'not authenticated' });
          return { stdout: JSON.stringify({ result: 'fallback ok', model: 'test' }), stderr: '', duration_ms: 10 };
        }),
        executeStream: mock.fn(async function* () {
          yield { type: 'chunk', data: 'test' };
          yield { type: 'done', stderr: '' };
        }),
        stripNonPrintable: (t) => t,
      },
    });

    mock.module(path.resolve(__dirname, '../src/health.js'), {
      namedExports: {
        getCachedProviderStatus: mock.fn((name) => {
          if (name === 'claude') return { installed: true, authenticated: false };
          return { installed: true, authenticated: true };
        }),
        getHealthStatus: mock.fn(async () => ({ status: 'degraded' })),
      },
    });

    mock.module(path.resolve(__dirname, '../src/db/index.js'), {
      namedExports: {
        getProviderSetting: mock.fn(() => ({ enabled: 1 })),
        getProviderSettings: mock.fn(() => []),
        initDb: mock.fn(),
        closeDb: mock.fn(),
      },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) delete require.cache[key];
    }

    ({ route } = require('../src/router'));
  });

  it('falls back to another provider when primary is unhealthy', async () => {
    const result = await route({ model: 'claude', prompt: 'hello' });
    assert.notStrictEqual(result.provider, 'claude');
    assert.ok(result.content);
    assert.strictEqual(result.original_provider, 'claude');
  });

  it('routes directly when primary is healthy', async () => {
    const result = await route({ model: 'gemini', prompt: 'hello' });
    assert.strictEqual(result.provider, 'gemini');
    assert.strictEqual(result.original_provider, undefined);
  });

  it('includes original_provider when fallback occurs', async () => {
    const result = await route({ model: 'claude', prompt: 'hello' });
    assert.strictEqual(result.original_provider, 'claude');
  });

  it('throws provider_unavailable when fallback is disabled per-request', async () => {
    await assert.rejects(
      () => route({ model: 'claude', prompt: 'hello', allowFallback: false }),
      (err) => {
        assert.strictEqual(err.status, 503);
        assert.strictEqual(err.code, 'provider_unavailable');
        return true;
      }
    );
  });

  it('does not fallback on client errors (400-level)', async () => {
    // A model that doesn't exist — should be 400 not fallback
    await assert.rejects(
      () => route({ model: 'nonexistent', prompt: 'hello' }),
      (err) => {
        assert.strictEqual(err.status, 400);
        return true;
      }
    );
  });
});
