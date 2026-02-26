const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Pure function tests — import directly (no mock needed)
const { buildArgs, parseOutput } = require('../../src/providers/claude');

describe('claude provider', () => {
  it('buildArgs constructs correct CLI arguments', () => {
    const args = buildArgs({ prompt: 'hello', system: 'be nice', max_tokens: 100 });
    assert.ok(args.includes('--print'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--system-prompt'));
    assert.ok(args.includes('be nice'));
    assert.ok(args.includes('--max-tokens'));
    assert.ok(args.includes('100'));
    assert.ok(args.includes('--'));
    assert.strictEqual(args[args.length - 1], 'hello');

    // Without system or max_tokens
    const args2 = buildArgs({ prompt: 'just prompt' });
    assert.ok(!args2.includes('--system-prompt'));
    assert.ok(!args2.includes('--max-tokens'));
    assert.strictEqual(args2[args2.length - 1], 'just prompt');
  });

  it('parseOutput handles JSON and fallback', () => {
    // JSON with result field
    const json1 = parseOutput(JSON.stringify({ result: 'hello', cost_usd: 0.01 }));
    assert.strictEqual(json1.content, 'hello');
    assert.strictEqual(json1.cost_usd, 0.01);

    // JSON with content field
    const json2 = parseOutput(JSON.stringify({ content: 'alt field' }));
    assert.strictEqual(json2.content, 'alt field');

    // Plain text fallback
    const plain = parseOutput('plain text response');
    assert.strictEqual(plain.content, 'plain text response');
    assert.strictEqual(plain.cost_usd, null);
  });

  it('chat() calls execute with correct command and env', async () => {
    const mockExecute = mock.fn(async () => ({
      stdout: JSON.stringify({ result: 'mocked reply', cost_usd: 0.003 }),
      stderr: '',
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
