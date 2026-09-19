const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { initDb, closeDb, insertRequestLog } = require('../../src/db');
const stats = require('../../src/db/stats');

const DAY = '-1 day';

describe('db/stats', () => {
  before(() => {
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');

    // Durations 100..1000 so the percentile offsets have one correct answer each.
    for (let i = 1; i <= 10; i++) {
      insertRequestLog({
        request_id: `r${i}`, client_name: 'app1', provider: 'claude', model: 'claude',
        upstream_model: 'claude-haiku-4-5', status: 200,
        duration_ms: i * 100, queued_ms: 10, ttft_ms: i * 10, api_ms: i * 50,
        tokens: 1000, tokens_in: 10, tokens_out: 90,
        cache_write_tokens: 400, cache_read_tokens: 500, cost_usd: 0.01,
      });
    }
    insertRequestLog({
      request_id: 'rl', client_name: 'app2', provider: 'claude', model: 'claude',
      status: 429, duration_ms: 20, api_error_status: 429,
    });
    insertRequestLog({
      request_id: 'rc', client_name: 'app2', provider: 'codex', model: 'codex',
      status: 200, duration_ms: 500, tokens: 300, cost_usd: null,
    });
  });

  after(() => closeDb());

  it('reads percentiles by offset, ignoring null durations', () => {
    assert.equal(stats.percentile('duration_ms', 0.5, { interval: DAY }), 500);
    assert.equal(stats.percentile('duration_ms', 0.95, { interval: DAY }), 900);
  });

  it('splits latency into the queue and the work after it', () => {
    const layers = stats.latencyLayers(DAY);
    assert.equal(layers.queued_ms.p50, 10);
    assert.equal(layers.execution_ms.p50, 490, 'execution is duration minus queueing');
    assert.equal(layers.ttft_ms.p50, 50);
  });

  it('groups by the model that ran, not the alias requested', () => {
    const byModel = stats.byModel(DAY);
    const haiku = byModel.find((m) => m.model === 'claude-haiku-4-5');
    assert.equal(haiku.requests, 10);
    assert.equal(haiku.tokens, 10000);

    const alias = byModel.find((m) => m.model === 'claude');
    assert.equal(alias.requests, 1, 'the row with no upstream model falls back to the alias');
  });

  it('counts errors per client', () => {
    const app2 = stats.byClient(DAY).find((c) => c.client_name === 'app2');
    assert.equal(app2.requests, 2);
    assert.equal(app2.errors, 1);
  });

  it('reports a provider with no price separately from one with zero cost', () => {
    const byProvider = stats.usageByProvider(DAY);
    const codex = byProvider.find((p) => p.provider === 'codex');
    assert.equal(codex.priced_requests, 0, 'codex reports no cost, which is not the same as free');
    assert.equal(codex.tokens, 300);

    const claude = byProvider.find((p) => p.provider === 'claude');
    assert.equal(claude.priced_requests, 10);
  });

  it('reports a usage limit only when one was actually observed', () => {
    const limited = stats.limitState(DAY);
    assert.equal(limited.status, 429);
    assert.equal(limited.provider, 'claude');
  });

  it('sums a rolling window with its pace', () => {
    const window = stats.usageWindow(5);
    assert.equal(window.requests, 12);
    assert.equal(window.cost_usd, 0.1);
    assert.equal(window.cost_per_hour, 0.02);
  });

  it('returns one row per request for the scatter, newest first', () => {
    const recent = stats.recentRequests(DAY);
    assert.equal(recent.length, 12);
    assert.ok(recent.every((r) => r.duration_ms != null));
  });
});
