const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Pure function tests — import directly (no mock needed)
const { buildArgs, parseOutput } = require('../../src/providers/claude');

describe('claude provider', () => {
  it('buildArgs constructs correct CLI arguments', () => {
    const args = buildArgs({ prompt: 'hello', system: 'be nice' });
    assert.ok(args.includes('--print'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--system-prompt'));
    assert.ok(args.includes('be nice'));
    assert.ok(!args.includes('--max-tokens'), 'claude CLI does not support --max-tokens');
    assert.ok(args.includes('--'));
    assert.strictEqual(args[args.length - 1], 'hello');

    // Without system
    const args2 = buildArgs({ prompt: 'just prompt' });
    assert.ok(!args2.includes('--system-prompt'));
    assert.strictEqual(args2[args2.length - 1], 'just prompt');
  });

  it('parseOutput extracts result, cost and usage from stderr JSON', () => {
    const stderr = JSON.stringify({
      type: 'result',
      result: 'hello',
      total_cost_usd: 0.019,
      usage: { input_tokens: 10, output_tokens: 24 },
    });
    const parsed = parseOutput('', stderr);
    assert.strictEqual(parsed.content, 'hello');
    assert.strictEqual(parsed.cost_usd, 0.019);
    assert.deepStrictEqual(parsed.usage, { input_tokens: 10, output_tokens: 24 });
  });

  it('parseOutput falls back to stdout JSON when stderr is empty', () => {
    const stdout = JSON.stringify({ result: 'hello', cost_usd: 0.01 });
    const parsed = parseOutput(stdout, '');
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
      stdout: '',
      stderr: JSON.stringify({ type: 'result', result: 'mocked reply', total_cost_usd: 0.003, usage: { input_tokens: 5, output_tokens: 10 } }),
      duration_ms: 50,
    }));

    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: { execute: mockExecute },
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
