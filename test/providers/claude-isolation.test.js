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

  it('puts nothing the caller wrote on the command line, where each argument is capped at 128 KiB', () => {
    for (const args of [claude.buildArgs(request), claude.buildStreamArgs(request)]) {
      assert.ok(!args.includes(request.prompt), 'the prompt goes to stdin');
      assert.ok(!args.includes(request.system), 'the system prompt goes to a file');
      assert.ok(!args.includes('--'), 'with no prompt argument there is nothing to separate');
    }
    assert.equal(claude.buildInput(request), request.prompt);
  });

  it('still carries the model, and names the file the system prompt is written to', () => {
    const args = claude.buildArgs(request);
    assert.equal(flagValue(args, '--model'), 'haiku');
    assert.equal(flagValue(args, '--system-prompt-file'), claude.SYSTEM_FILE);
    assert.deepEqual(claude.buildFiles(request), { [claude.SYSTEM_FILE]: request.system });
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
