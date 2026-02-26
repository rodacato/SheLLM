const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildArgs, parseOutput } = require('../../src/providers/codex');

describe('codex provider', () => {
  it('buildArgs includes exec flags and prepends system', () => {
    const args = buildArgs({ prompt: 'hello', system: 'context' });
    assert.ok(args.includes('exec'));
    assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('--json'));
    assert.ok(!args.includes('--quiet'), 'codex CLI does not support --quiet');

    const fullPrompt = args[args.length - 1];
    assert.ok(fullPrompt.startsWith('context\n\n---\n\nhello'));

    // Without system
    const args2 = buildArgs({ prompt: 'just prompt' });
    assert.strictEqual(args2[args2.length - 1], 'just prompt');
  });

  it('parseOutput parses JSONL with item.completed and turn.completed', () => {
    const jsonlOutput = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello world' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }),
    ].join('\n');

    const result = parseOutput(jsonlOutput);
    assert.strictEqual(result.content, 'hello world');
    assert.deepStrictEqual(result.usage, { input_tokens: 10, output_tokens: 20 });
    assert.strictEqual(result.cost_usd, null);

    // Fallback to raw stdout when no events found
    const plain = parseOutput('not json at all');
    assert.strictEqual(plain.content, 'not json at all');
    assert.strictEqual(plain.usage, null);
  });

  it('chat() calls execute with correct command', async () => {
    const jsonlResponse = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'mocked codex reply' } }),
    ].join('\n');

    const mockExecute = mock.fn(async () => ({
      stdout: jsonlResponse,
      stderr: '',
      duration_ms: 40,
    }));

    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: { execute: mockExecute },
    });

    delete require.cache[require.resolve('../../src/providers/codex')];
    const codex = require('../../src/providers/codex');

    const result = await codex.chat({ prompt: 'test' });
    assert.strictEqual(result.content, 'mocked codex reply');

    const call = mockExecute.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'codex');

    mock.restoreAll();
  });
});
