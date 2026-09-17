const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('model routing', () => {
  const { resolveProvider } = require('../../src/routing/provider-select');

  it('routes any provider-prefixed model id to that provider', () => {
    assert.strictEqual(resolveProvider('claude-sonnet-4-5-20250929')?.name, 'claude');
    assert.strictEqual(resolveProvider('gemini-2.5-pro')?.name, 'gemini');
  });

  it('does not route a model with no known prefix', () => {
    assert.strictEqual(resolveProvider('gpt-4o'), null);
    assert.strictEqual(resolveProvider('claudex'), null);
  });
});
