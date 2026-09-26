'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseClaudeModels, listClaudeModels } = require('../../src/providers/model-list');
const { readCatalog, bakedDefault, declared, resetCatalogCache } = require('../../src/infra/model-catalog');
const codex = require('../../src/providers/codex');
const baked = require('../../src/catalog/models.json');

// Verbatim from claude 2.1.273. The aliases live in one human-readable line, so a wording change
// upstream silently empties the catalog rather than failing — which is what this pins.
const CLAUDE_OUTPUT = 'Current model: `Opus 5 (1M context) (default)`\n'
  + 'Usage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], '
  + 'fable[1m], opusplan, default, or a full model ID.\n';

describe('reading a model catalog out of a CLI', () => {
  it('takes the aliases out of claude\'s own line', () => {
    const models = parseClaudeModels(CLAUDE_OUTPUT);
    assert.deepEqual(models.map((m) => m.id), [
      'claude-sonnet', 'claude-opus', 'claude-haiku', 'claude-fable',
      'claude-best', 'claude-opusplan', 'claude-default',
    ]);
  });

  // [1m] entries are a context-window variant of a model already in the list, not a model.
  it('marks the models with a [1m] variant rather than listing any model twice', () => {
    const models = parseClaudeModels(CLAUDE_OUTPUT);
    assert.ok(!models.some((m) => m.id.includes('[1m]')));
    const long = models.filter((m) => m.longContext).map((m) => m.id).sort();
    assert.deepStrictEqual(long, ['claude-fable', 'claude-opus', 'claude-sonnet']);
    assert.strictEqual(models.find((m) => m.id === 'claude-haiku').longContext, false);
  });

  it('answers null rather than an empty catalog when the line is not there', () => {
    assert.strictEqual(parseClaudeModels('Current model: `Opus 5`\n'), null);
    assert.strictEqual(parseClaudeModels(''), null);
  });

  // The CLI is a boundary this repo does not own, so it is stood in for by a real process that
  // prints what it prints — not by a stub of our own call.
  it('reads a real process the way it reads the real CLI', async () => {
    const run = (_cmd, _args, _opts) => Promise.resolve({ stdout: CLAUDE_OUTPUT, stderr: '' });
    const models = await listClaudeModels({ run });
    assert.strictEqual(models.length, 7);
    assert.strictEqual(models[0].id, 'claude-sonnet');
  });

  it('survives a CLI that fails instead of answering', async () => {
    const run = () => Promise.reject(new Error('spawn ENOENT'));
    assert.strictEqual(await listClaudeModels({ run }), null);
  });
});

describe('the baked catalog', () => {
  it('carries the date and the CLI versions it was built against', () => {
    assert.match(baked.generated_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Object.keys(baked.providers).length > 0, 'a catalog of nothing is not a floor');
    for (const [name, version] of Object.entries(baked.cli)) {
      assert.match(version ?? '', /^\d+\.\d+\.\d+$/, `${name} has no version stamp`);
    }
  });

  it('holds the normalized shape every consumer reads', () => {
    for (const [provider, { models }] of Object.entries(baked.providers)) {
      assert.ok(models.length > 0, `${provider} is present but empty`);
      for (const m of models) {
        assert.ok(m.id.startsWith(`${provider}-`), `${m.id} is not addressable as ${provider}`);
        assert.strictEqual(typeof m.label, 'string');
        assert.ok('description' in m && 'isDefault' in m && 'retiresAt' in m && 'upgradeTo' in m);
      }
    }
  });
});

// codex with no -m falls back to whatever config.toml names, and a ChatGPT account answers
// "model is not supported" to it. The catalog is what stops a bare `codex` being the one model
// SheLLM advertises that cannot run.
describe('a bare provider name', () => {
  const modelArg = (model) => {
    const args = codex.buildArgs({ prompt: 'hi', model });
    const i = args.indexOf('-m');
    return i === -1 ? null : args[i + 1];
  };

  it('resolves codex to the model the CLI calls its default', () => {
    const id = bakedDefault('codex');
    assert.match(id, /^codex-/);
    const expected = id.slice('codex-'.length);
    assert.strictEqual(modelArg('codex'), expected, 'a bare codex still reached the CLI with no -m');
    assert.strictEqual(modelArg(undefined), expected);
  });

  it('still passes an explicit model straight through', () => {
    assert.strictEqual(modelArg('codex-gpt-5.6-sol'), 'gpt-5.6-sol');
  });
});

describe('where a catalog came from', () => {
  it('always says which of the three sources answered', async () => {
    resetCatalogCache();
    const c = await readCatalog('codex');
    assert.ok(['cli', 'baked', 'declared'].includes(c.source));
    assert.ok(c.models.length > 0);
    if (c.source === 'baked') {
      assert.match(c.generatedAt, /^\d{4}-\d{2}-\d{2}$/, 'a baked catalog that cannot date itself');
    }
  });

  it('falls back to the tier aliases the provider declares', () => {
    const models = declared('claude');
    assert.ok(models.length > 0);
    assert.ok(models.every((m) => typeof m.id === 'string'));
  });
});
