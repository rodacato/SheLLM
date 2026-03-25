const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { initDb, closeDb } = require('../../src/db');

describe('router', () => {
  before(() => {
    initDb(':memory:');
    // Rebuild model map now that DB is available
    const { buildModelMap } = require('../../src/routing');
    buildModelMap();
  });

  after(() => {
    closeDb();
  });

  const { resolveProvider, listProviders, queue, getAliases } = require('../../src/routing');
  it('resolveProvider resolves direct names and model aliases', () => {
    assert.strictEqual(resolveProvider('claude')?.name, 'claude');
    assert.strictEqual(resolveProvider('gemini')?.name, 'gemini');
    assert.strictEqual(resolveProvider('codex')?.name, 'codex');
    assert.strictEqual(resolveProvider('cerebras')?.name, 'cerebras');

    // Model aliases
    assert.strictEqual(resolveProvider('claude-opus')?.name, 'claude');
    assert.strictEqual(resolveProvider('gemini-pro')?.name, 'gemini');
    assert.strictEqual(resolveProvider('codex-mini')?.name, 'codex');
    assert.strictEqual(resolveProvider('cerebras-8b')?.name, 'cerebras');

    // Unknown
    assert.strictEqual(resolveProvider('nonexistent'), null);
  });

  it('listProviders returns all providers with correct shape', () => {
    const providers = listProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length >= 4);
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

  it('getAliases returns an object', () => {
    const aliases = getAliases();
    assert.strictEqual(typeof aliases, 'object');
    assert.ok(aliases !== null);
  });
});
