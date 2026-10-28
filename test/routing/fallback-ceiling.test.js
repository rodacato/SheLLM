const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The operator turned fallback off, and claude is down: a request asking for fallback still must
// not reach codex, which may run on an account the operator keeps out of automatic traffic.
describe('fallback with SHELLM_FALLBACK_ENABLED off', () => {
  let route;
  let execute;

  before(() => {
    delete process.env.SHELLM_FALLBACK_ENABLED;
    execute = mock.fn(async () => ({ stdout: JSON.stringify({ result: 'answered', model: 'test' }), stderr: '', duration_ms: 10 }));
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: { execute, executeStream: mock.fn(async function* () {}), stripNonPrintable: (t) => t },
    });
    mock.module(path.resolve(__dirname, '../../src/infra/health.js'), {
      namedExports: {
        getCachedProviderStatus: mock.fn((name) => ({ installed: true, authenticated: name !== 'claude' })),
        getHealthStatus: mock.fn(async () => ({ status: 'degraded' })),
      },
    });
    mock.module(path.resolve(__dirname, '../../src/db/index.js'), {
      namedExports: { getProviderSetting: mock.fn(() => ({ enabled: 1 })), getProviderSettings: mock.fn(() => []), initDb: mock.fn(), closeDb: mock.fn() },
    });
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/')) delete require.cache[key];
    }
    ({ route } = require('../../src/routing'));
  });

  after(() => mock.restoreAll());

  it('does not widen to another provider when the request asks for it', async () => {
    await assert.rejects(route({ model: 'claude', prompt: 'hello', allowFallback: true }), (err) => err.code === 'provider_unavailable');
    assert.equal(execute.mock.callCount(), 0, 'a CLI ran');
  });
});
