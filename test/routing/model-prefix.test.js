const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('model routing', () => {
  const { resolveProvider } = require('../../src/routing/provider-select');

  it('routes any provider-prefixed model id to that provider', () => {
    assert.strictEqual(resolveProvider('claude-sonnet-4-5-20250929')?.name, 'claude');
    assert.strictEqual(resolveProvider('codex-gpt-5.6-sol')?.name, 'codex');
  });

  it('does not route a model with no known prefix', () => {
    assert.strictEqual(resolveProvider('gpt-4o'), null);
    assert.strictEqual(resolveProvider('claudex'), null);
    assert.strictEqual(resolveProvider('codexy'), null);
  });
});
