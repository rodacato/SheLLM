const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../../src/db');

describe('router', () => {
  before(() => {
    initDb(':memory:');
  });

  after(() => {
    closeDb();
  });

  const { resolveProvider, listProviders, queue } = require('../../src/routing');
  it('resolveProvider resolves provider names and prefixed model ids', () => {
    assert.strictEqual(resolveProvider('claude')?.name, 'claude');
    assert.strictEqual(resolveProvider('codex')?.name, 'codex');

    // Model aliases
    assert.strictEqual(resolveProvider('claude-opus')?.name, 'claude');

    // Unknown
    assert.strictEqual(resolveProvider('nonexistent'), null);
  });

  it('listProviders returns all providers with correct shape', () => {
    const providers = listProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length >= 2);
    for (const p of providers) {
      assert.ok(p.name, 'provider has name');
      assert.ok(Array.isArray(p.models), 'provider has models array');
    }
  });

  it('queue.stats returns correct shape', () => {
    const stats = queue.stats;
    assert.strictEqual(typeof stats.pending, 'number');
    assert.strictEqual(typeof stats.active, 'number');
    assert.strictEqual(typeof stats.max_concurrent, 'number');
    assert.strictEqual(stats.pending, 0);
    assert.strictEqual(stats.active, 0);
  });

});
