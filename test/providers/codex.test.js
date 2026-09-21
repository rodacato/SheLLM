const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.resolve(__dirname, '../fixtures/codex/0.154.0');

describe('codex provider', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let codex;

  function argsOf() {
    return JSON.parse(fs.readFileSync(path.join(fakeBin, 'codex.args.json'), 'utf8'));
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    // Replays a recorded transcript chosen by the requested model, and exits the way the real
    // CLI does: 0 for a served turn, 1 for a rejected model.
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(path.join(fakeBin, 'codex.args.json'))}, JSON.stringify(args));
const model = args[args.indexOf('-m') + 1];
const file = model === 'over-quota' ? 'exec-json-usage-limit.constructed.jsonl'
  : model === 'no-such-model' ? 'exec-json-unknown-model.jsonl'
  : 'exec-json.jsonl';
process.stdout.write(fs.readFileSync(${JSON.stringify(FIXTURES)} + '/' + file, 'utf8'));
process.exit(file === 'exec-json-unknown-model.jsonl' ? 1 : 0);
`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    codex = require('../../src/providers/codex');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('runs the CLI read-only, ephemeral and with the requested model', async () => {
    const result = await codex.chat({ prompt: 'ping', model: 'codex-gpt-5.6-sol' });
    assert.equal(result.content, 'OK');

    const args = argsOf();
    assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.6-sol', 'the codex- prefix is stripped for the CLI');
    assert.equal(args[args.indexOf('-s') + 1], 'read-only');
    assert.ok(args.includes('--ephemeral'), 'no session files survive the request');
    assert.ok(args.includes('--skip-git-repo-check'));
    assert.equal(args.at(-1), 'ping', 'the prompt is the last argument');
  });

  // Leaving the CLI to pick used to look like the respectful default. It is not: with no -m the
  // CLI falls back to whatever config.toml names, and a ChatGPT account answers "model is not
  // supported" to it — so `codex` was the one model SheLLM advertised that could not run.
  it('names the CLI\'s own default model when the id is the provider name', async () => {
    const { bakedDefault } = require('../../src/infra/model-catalog');
    const expected = bakedDefault('codex').slice('codex-'.length);

    await codex.chat({ prompt: 'ping', model: 'codex' });
    const args = argsOf();
    assert.equal(args[args.indexOf('-m') + 1], expected);
  });

  it('prepends the system prompt and the JSON-mode instruction the CLI has no flag for', async () => {
    await codex.chat({ prompt: 'ping', system: 'Be terse.', response_format: { type: 'json_object' }, model: 'codex' });
    const sent = argsOf().at(-1);
    assert.match(sent, /^Be terse\.\n\nRespond with valid JSON only\.\n\n---\n\nping$/);
  });

  // The CLI's 12683 input tokens include the 10624 it served from cache; input_tokens carries the
  // fresh remainder so it means the same thing here as it does for claude.
  it('reports the token usage the CLI reported', async () => {
    const result = await codex.chat({ prompt: 'ping', model: 'codex' });
    assert.deepEqual(result.usage, {
      input_tokens: 2059,
      output_tokens: 5,
      cache_read_input_tokens: 10624,
      cache_creation_input_tokens: 0,
    });
    assert.equal(result.cost_usd, null);
  });

  it('maps a model the account cannot use to model_not_found', async () => {
    await assert.rejects(
      () => codex.chat({ prompt: 'ping', model: 'codex-no-such-model' }),
      (err) => err.status === 404 && err.code === 'model_not_found',
    );
  });

  it('reports a usage limit from the events even when the CLI exits 0', async () => {
    await assert.rejects(
      () => codex.chat({ prompt: 'ping', model: 'codex-over-quota' }),
      (err) => err.status === 429 && err.code === 'rate_limited' && /usage limit/i.test(err.message),
    );
  });

  it('streams the agent message and the usage, then finishes', async () => {
    const events = [];
    for await (const event of codex.chatStream({ prompt: 'ping', model: 'codex' })) events.push(event);
    assert.deepEqual(events.filter((e) => e.type === 'delta').map((e) => e.content), ['OK']);
    assert.deepEqual(events.find((e) => e.type === 'usage').usage, {
      input_tokens: 2059,
      output_tokens: 5,
      cache_read_input_tokens: 10624,
      cache_creation_input_tokens: 0,
    });
    assert.equal(events.at(-1).type, 'done');
  });

  it('surfaces a usage limit on the streaming path too', async () => {
    await assert.rejects(async () => {
      for await (const _event of codex.chatStream({ prompt: 'ping', model: 'codex-over-quota' })) { /* drain */ }
    }, (err) => err.status === 429);
  });
});
