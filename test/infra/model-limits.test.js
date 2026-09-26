const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { limitsFor } = require('../../src/infra/model-limits');

// The real config/model-limits.yaml, read as the server reads it.
describe('model limits precedence', () => {
  it('lets what the CLI reports override the manifest, field by field', () => {
    const { limits, sources } = limitsFor('claude-sonnet', { reasoningEfforts: ['low'], longContext: true });
    assert.deepEqual(limits.reasoning_efforts, ['low']);
    assert.equal(sources.reasoning_efforts, 'cli');
    assert.equal(sources.context_window, 'manifest', 'a field the CLI does not report still comes from the manifest');
    assert.equal(sources.context_window_1m, 'cli');
  });

  it('falls back to the default for a model the manifest does not name', () => {
    assert.deepEqual(limitsFor('claude-nobody-wrote-down'), { limits: { context_window: 200000 }, sources: { context_window: 'default' } });
  });
});
