const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateCost, estimateFor } = require('../../src/infra/model-prices');

// Rates from config/model-prices.yaml, the real file: a wrong entry there should fail here.
describe('estimating a request at API list price', () => {
  it('prices fresh input, cache reads, cache writes and output at their own rates', () => {
    const usage = { input_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 3000, output_tokens: 400 };
    assert.equal(estimateCost('gpt-6-astra', usage), (1000 * 10 + 2000 * 1 + 3000 * 12.5 + 400 * 50) / 1e6);
  });

  it('does not bill reasoning tokens a second time: they are already output', () => {
    const plain = { input_tokens: 100, output_tokens: 50 };
    assert.equal(estimateCost('gpt-5.6-sol', { ...plain, reasoning_tokens: 40 }), estimateCost('gpt-5.6-sol', plain));
  });

  it('switches to the long-context rates once the input passes the threshold', () => {
    assert.equal(estimateCost('gpt-5.6-sol', { input_tokens: 272000, output_tokens: 0 }), 272000 * 4 / 1e6);
    assert.equal(estimateCost('gpt-5.6-sol', { input_tokens: 272001, output_tokens: 0 }), Math.round(272001 * 8) / 1e6);
  });

  it('prices cache writes as input where the table lists no write price', () => {
    assert.equal(estimateCost('gpt-5.5', { cache_creation_input_tokens: 1000, output_tokens: 0 }), 1000 * 5 / 1e6);
  });

  it('never estimates a request the CLI already priced, or a model it does not know', () => {
    const usage = { input_tokens: 100, output_tokens: 10 };
    assert.equal(estimateFor({ cost_usd: 0.01, usage, metrics: { upstream_model: 'gpt-6-astra' } }), null);
    assert.equal(estimateFor({ cost_usd: null, usage, metrics: { upstream_model: 'claude-sonnet-5-5' } }), null);
    assert.equal(estimateFor({ cost_usd: null, usage, metrics: null }), null);
  });
});
