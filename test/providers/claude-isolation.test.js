const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const claude = require('../../src/providers/claude');

const request = { prompt: 'ping', system: 'Reply in one word.', model: 'claude-haiku' };

function flagValue(args, flag) {
  return args[args.indexOf(flag) + 1];
}

describe('claude isolation flags', () => {
  it('passes the isolation flags the CLI accepts', () => {
    for (const args of [claude.buildArgs(request), claude.buildStreamArgs(request)]) {
      assert.ok(args.includes('--disable-slash-commands'), 'skills stay out of a served request');
      assert.ok(args.includes('--strict-mcp-config'), 'the server user\'s MCP servers stay out');
      assert.deepEqual(JSON.parse(flagValue(args, '--settings')), { disableAllHooks: true });
      assert.equal(flagValue(args, '--tools'), '', 'ADR-0002: the CLI\'s own tools are off');
      assert.equal(flagValue(args, '--permission-mode'), 'dontAsk');
    }
  });

  it('keeps every flag before the -- separator, so none is read as the prompt', () => {
    for (const args of [claude.buildArgs(request), claude.buildStreamArgs(request)]) {
      const separator = args.indexOf('--');
      for (const flag of claude.ISOLATION_ARGS) {
        if (!flag.startsWith('--')) continue;
        assert.ok(args.indexOf(flag) < separator, `${flag} must precede the separator`);
      }
      assert.equal(args.at(-1), request.prompt);
      assert.equal(args.length - 1, separator + 1, 'the prompt is the only argument after --');
    }
  });

  it('still carries the model and system prompt alongside them', () => {
    const args = claude.buildArgs(request);
    assert.equal(flagValue(args, '--model'), 'haiku');
    assert.equal(flagValue(args, '--system-prompt'), request.system);
  });
});
