const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.resolve(__dirname, '../fixtures/claude/2.1.273');

describe('model passthrough', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;
  let gemini;

  function argsOf(cli) {
    return JSON.parse(fs.readFileSync(path.join(fakeBin, `${cli}.args.json`), 'utf8'));
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(fakeBin, 'claude.args.json'))}, JSON.stringify(args));
const unknown = args[args.indexOf('--model') + 1] === 'claude-nonexistent-model-x';
process.stdout.write(fs.readFileSync(${JSON.stringify(FIXTURES)} + (unknown ? '/result-unknown-model.json' : '/result-haiku.json')));
process.exit(unknown ? 1 : 0);
`, { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, 'gemini'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(path.join(fakeBin, 'gemini.args.json'))}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ response: 'OK', stats: { models: {} } }));
`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
    gemini = require('../../src/providers/gemini');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('passes the requested model to the CLI as --model', async () => {
    const cases = {
      'claude-haiku': 'haiku',
      'claude-opus': 'opus',
      'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5-20250929',
    };
    for (const [requested, passed] of Object.entries(cases)) {
      const result = await claude.chat({ prompt: 'Reply with OK', model: requested });
      assert.strictEqual(result.content, 'OK');
      const args = argsOf('claude');
      assert.strictEqual(args[args.indexOf('--model') + 1], passed, requested);
    }
  });

  it('leaves the CLI default when the model is the provider name', async () => {
    await claude.chat({ prompt: 'Reply with OK', model: 'claude' });
    assert.ok(!argsOf('claude').includes('--model'));
  });

  it('passes the model to streaming requests too', async () => {
    for await (const _event of claude.chatStream({ prompt: 'Reply with OK', model: 'claude-haiku' })) { /* drain */ }
    const args = argsOf('claude');
    assert.strictEqual(args[args.indexOf('--model') + 1], 'haiku');
  });

  it('reports a model the CLI rejects as 404 model_not_found', async () => {
    const err = await claude.chat({ prompt: 'Reply with OK', model: 'claude-nonexistent-model-x' }).catch((e) => e);
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.code, 'model_not_found');
    assert.match(err.message, /claude-nonexistent-model-x/);
  });

  it('does not count a rejected model as a provider failure', async () => {
    const { initDb, closeDb } = require('../../src/db');
    const { route } = require('../../src/routing');
    const { canSendTraffic, resetCircuit } = require('../../src/infra/circuit-breaker');
    initDb(':memory:');
    try {
      for (let i = 0; i < 5; i++) {
        const err = await route({ model: 'claude-nonexistent-model-x', prompt: 'Reply with OK' }).catch((e) => e);
        assert.strictEqual(err.code, 'model_not_found');
      }
      assert.ok(canSendTraffic('claude'));
    } finally {
      resetCircuit('claude');
      closeDb();
    }
  });

  it('passes the requested model to gemini as -m', async () => {
    await gemini.chat({ prompt: 'Reply with OK', model: 'gemini-flash' });
    const args = argsOf('gemini');
    assert.strictEqual(args[args.indexOf('-m') + 1], 'flash');

    await gemini.chat({ prompt: 'Reply with OK', model: 'gemini' });
    assert.ok(!argsOf('gemini').includes('-m'));
  });
});
