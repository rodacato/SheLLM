const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildArgs, parseOutput } = require('../../src/providers/gemini');

describe('gemini provider', () => {
  it('buildArgs prepends system to prompt', () => {
    const args = buildArgs({ prompt: 'hello', system: 'context' });
    const pIdx = args.indexOf('-p');
    const fullPrompt = args[pIdx + 1];
    assert.ok(fullPrompt.startsWith('context\n\n---\n\nhello'));

    // Without system
    const args2 = buildArgs({ prompt: 'just prompt' });
    const pIdx2 = args2.indexOf('-p');
    assert.strictEqual(args2[pIdx2 + 1], 'just prompt');

    // Includes expected flags
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--approval-mode'));
    assert.ok(args.includes('yolo'));
  });

  it('parseOutput extracts response and usage from JSON', () => {
    const json = JSON.stringify({
      response: 'hello',
      stats: {
        models: {
          'gemini-flash': { tokens: { input: 100, candidates: 20 } },
          'gemini-router': { tokens: { input: 50, candidates: 5 } },
        },
      },
    });
    const result = parseOutput(json);
    assert.strictEqual(result.content, 'hello');
    assert.deepStrictEqual(result.usage, { input_tokens: 150, output_tokens: 25 });
    assert.strictEqual(result.cost_usd, null);
  });

  it('parseOutput handles plain text fallback', () => {
    const result = parseOutput('not json');
    assert.strictEqual(result.content, 'not json');
    assert.strictEqual(result.usage, null);
  });

  it('chat() calls execute with correct command', async () => {
    const mockExecute = mock.fn(async () => ({
      stdout: JSON.stringify({ response: 'mocked gemini reply', stats: { models: {} } }),
      stderr: '',
      duration_ms: 30,
    }));

    mock.module(path.resolve(__dirname, '../../src/providers/base.js'), {
      namedExports: { execute: mockExecute },
    });

    delete require.cache[require.resolve('../../src/providers/gemini')];
    const gemini = require('../../src/providers/gemini');

    const result = await gemini.chat({ prompt: 'test', system: 'sys' });
    assert.strictEqual(result.content, 'mocked gemini reply');

    const call = mockExecute.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'gemini');

    mock.restoreAll();
  });
});
