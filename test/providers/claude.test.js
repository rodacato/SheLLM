const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');

// Pure function tests — import directly (no mock needed)
const { buildArgs, parseOutput } = require('../../src/providers/claude');

describe('claude provider', () => {
  it('buildArgs constructs correct CLI arguments', () => {
    const args = buildArgs({ prompt: 'hello', system: 'be nice' });
    assert.ok(args.includes('--print'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--system-prompt-file'));
    assert.ok(!args.includes('be nice'), 'the system prompt is written to a file, not passed');
    assert.ok(!args.includes('--max-tokens'), 'claude CLI does not support --max-tokens');
    assert.ok(!args.includes('hello'), 'the prompt is written to stdin, not passed');

    const args2 = buildArgs({ prompt: 'just prompt' });
    assert.ok(!args2.includes('--system-prompt-file'), 'no system prompt, no file');
  });

  it('buildArgs includes --dangerously-skip-permissions by default', () => {
    const args = buildArgs({ prompt: 'test' });
    assert.ok(args.includes('--dangerously-skip-permissions'));
  });

  it('parseOutput extracts result, cost and usage from stdout JSON', () => {
    const stdout = JSON.stringify({
      type: 'result',
      result: 'hello',
      total_cost_usd: 0.019,
      usage: { input_tokens: 10, output_tokens: 24 },
    });
    const parsed = parseOutput(stdout, 'warning: something on stderr');
    assert.strictEqual(parsed.content, 'hello');
    assert.strictEqual(parsed.cost_usd, 0.019);
    assert.deepStrictEqual(parsed.usage, {
      input_tokens: 10, output_tokens: 24,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
    });
  });

  it('parseOutput keeps the cache counters that make tokens match cost', () => {
    const real = readFileSync(
      path.join(__dirname, '../fixtures/claude/2.1.273/result-haiku.json'), 'utf8',
    );
    const { usage, metrics } = parseOutput(real, '');

    assert.strictEqual(usage.cache_creation_input_tokens, 8190);
    assert.strictEqual(usage.cache_read_input_tokens, 20828);
    const billable = usage.input_tokens + usage.output_tokens
      + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    assert.strictEqual(billable, 29089, 'summing only in/out would report 71');

    assert.strictEqual(metrics.ttft_ms, 1387, 'the CLI already measures time to first token');
    assert.strictEqual(metrics.api_ms, 2147);
    assert.strictEqual(metrics.upstream_model, 'claude-haiku-4-5-20251001',
      'the model that ran, not the alias the caller asked for');
  });

  it('metrics carry the API error status that signals a usage limit', () => {
    const errored = readFileSync(
      path.join(__dirname, '../fixtures/claude/2.1.273/result-unknown-model.json'), 'utf8',
    );
    assert.strictEqual(parseOutput(errored, '').metrics.api_error_status, 404);
  });

  it('parseOutput falls back to stderr JSON when stdout is empty', () => {
    const stderr = JSON.stringify({ result: 'hello', cost_usd: 0.01 });
    const parsed = parseOutput('', stderr);
    assert.strictEqual(parsed.content, 'hello');
    assert.strictEqual(parsed.cost_usd, 0.01);
  });

  it('parseOutput handles plain text fallback', () => {
    const plain = parseOutput('plain text response', '');
    assert.strictEqual(plain.content, 'plain text response');
    assert.strictEqual(plain.cost_usd, null);
    assert.strictEqual(plain.usage, null);
  });

  it('chat() calls execute with correct command and env', async () => {
    const mockExecute = mock.fn(async () => ({
      stdout: JSON.stringify({ type: 'result', result: 'mocked reply', total_cost_usd: 0.003, usage: { input_tokens: 5, output_tokens: 10 } }),
      duration_ms: 50,
    }));

    const { stripNonPrintable } = require('../../src/providers/base');
    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: { execute: mockExecute, stripNonPrintable },
    });

    // Clear cached modules so they pick up the mock
    delete require.cache[require.resolve('../../src/providers/claude')];
    const claude = require('../../src/providers/claude');

    const result = await claude.chat({ prompt: 'test prompt', system: 'sys' });
    assert.strictEqual(result.content, 'mocked reply');
    assert.strictEqual(result.cost_usd, 0.003);

    const call = mockExecute.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'claude');
    assert.ok(Array.isArray(call.arguments[1]));
    // Verify ANTHROPIC_API_KEY is deleted from env
    const envArg = call.arguments[2]?.env;
    assert.strictEqual(envArg?.ANTHROPIC_API_KEY, undefined);

    mock.restoreAll();
  });
});
