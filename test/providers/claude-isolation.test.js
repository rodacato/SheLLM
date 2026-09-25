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

describe('claude reasoning effort', () => {
  const withSetting = (value, fn) => {
    const previous = process.env.SHELLM_CLAUDE_EFFORT;
    if (value === undefined) delete process.env.SHELLM_CLAUDE_EFFORT;
    else process.env.SHELLM_CLAUDE_EFFORT = value;
    try { fn(); } finally {
      if (previous === undefined) delete process.env.SHELLM_CLAUDE_EFFORT;
      else process.env.SHELLM_CLAUDE_EFFORT = previous;
    }
  };

  it('runs at medium when neither the request nor the operator says otherwise', () => withSetting(undefined, () => {
    for (const args of [claude.buildArgs(request), claude.buildStreamArgs(request)]) {
      assert.equal(flagValue(args, '--effort'), 'medium');
    }
  }));

  it('lets a request override the server default', () => withSetting('high', () => {
    assert.equal(flagValue(claude.buildArgs({ ...request, effort: 'low' }), '--effort'), 'low');
    assert.equal(flagValue(claude.buildArgs(request), '--effort'), 'high');
  }));

  it('passes no flag for a level the CLI does not know, rather than one it would ignore with a warning', () => withSetting('extreme', () => {
    assert.ok(!claude.buildArgs(request).includes('--effort'));
  }));
});
