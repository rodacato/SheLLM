const { describe, it, mock, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

describe('health', () => {
  let getHealthStatus;
  let mockExecute;

  before(() => {
    mockExecute = mock.fn(async () => ({
      stdout: 'v1.0.0',
      stderr: '',
      duration_ms: 10,
    }));

    mock.module(path.resolve(__dirname, '../src/providers/base.js'), {
      namedExports: { execute: mockExecute },
    });

    // Set CEREBRAS_API_KEY so cerebras shows as authenticated
    process.env.CEREBRAS_API_KEY = 'test-key-for-health';

    // Clear cached modules so they pick up the mock
    for (const key of Object.keys(require.cache)) {
      if (key.includes('src/providers/') || key.includes('src/router') || key.includes('src/health')) {
        delete require.cache[key];
      }
    }

    ({ getHealthStatus } = require('../src/health'));
  });

  it('returns correct shape with provider statuses', async () => {
    const status = await getHealthStatus();
    assert.strictEqual(status.status, 'ok');
    assert.ok(status.providers.claude);
    assert.ok(status.providers.gemini);
    assert.ok(status.providers.codex);
    assert.ok(status.providers.cerebras);

    // Each provider has installed and authenticated
    for (const [, p] of Object.entries(status.providers)) {
      assert.strictEqual(typeof p.installed, 'boolean');
      assert.strictEqual(typeof p.authenticated, 'boolean');
    }

    assert.ok(status.queue);
    assert.strictEqual(typeof status.queue.pending, 'number');
    assert.strictEqual(typeof status.uptime_seconds, 'number');
  });

  it('returns cached result on second call', async () => {
    const callsBefore = mockExecute.mock.callCount();
    const status = await getHealthStatus();
    const callsAfter = mockExecute.mock.callCount();

    // Second call should use cache (no new execute calls)
    assert.strictEqual(callsAfter, callsBefore);
    assert.strictEqual(status.status, 'ok');
  });
});
