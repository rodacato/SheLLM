const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const CLAUDE_FIXTURES = path.resolve(__dirname, '../fixtures/claude/2.1.273');
const CODEX_FIXTURES = path.resolve(__dirname, '../fixtures/codex/0.154.0');

const schema = {
  type: 'object',
  properties: { color: { type: 'string' }, shape: { type: 'string' } },
  required: ['color', 'shape'],
  additionalProperties: false,
};
const response_format = { type: 'json_schema', json_schema: { name: 'figure', strict: true, schema } };

async function waitUntilGone(dir) {
  for (let i = 0; i < 50 && fs.existsSync(dir); i++) await sleep(10);
  return !fs.existsSync(dir);
}

async function drain(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('response_format json_schema', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;
  let codex;

  function lastRun(cli) {
    return JSON.parse(fs.readFileSync(path.join(fakeBin, `${cli}.run.json`), 'utf8'));
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    const record = (cli) => `
const fs = require('fs');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const run = { args, cwd: process.cwd() };
const schemaFile = flag('--output-schema');
if (schemaFile) {
  run.schemaFile = { content: fs.readFileSync(schemaFile, 'utf8'), mode: fs.statSync(schemaFile).mode & 0o777 };
}
fs.writeFileSync(${JSON.stringify(fakeBin)} + '/${cli}.run.json', JSON.stringify(run));
`;

    // A model named "claude-prose" answers the way the CLI does when it skips the schema.
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
${record('claude')}
const prose = flag('--model') === 'claude-prose';
const file = flag('--output-format') === 'stream-json'
  ? (prose ? 'stream-json.jsonl' : 'stream-json-schema.jsonl')
  : (prose ? 'result-haiku.json' : 'result-json-schema.json');
process.stdout.write(fs.readFileSync(${JSON.stringify(CLAUDE_FIXTURES)} + '/' + file, 'utf8'));
`, { mode: 0o755 });

    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
${record('codex')}
const refused = flag('-m') === 'strict-refused';
const file = refused ? 'exec-json-invalid-schema.jsonl' : 'exec-json-output-schema.jsonl';
process.stdout.write(fs.readFileSync(${JSON.stringify(CODEX_FIXTURES)} + '/' + file, 'utf8'));
process.exit(refused ? 1 : 0);
`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
    codex = require('../../src/providers/codex');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  describe('claude', () => {
    it('passes the schema inline and answers with the structured output', async () => {
      const result = await claude.chat({ prompt: 'A red square', response_format, model: 'claude-haiku' });
      assert.deepEqual(JSON.parse(result.content), { color: 'red', shape: 'square' });

      const { args } = lastRun('claude');
      assert.deepEqual(JSON.parse(args[args.indexOf('--json-schema') + 1]), schema);
      assert.ok(args.indexOf('--json-schema') < args.indexOf('--'), 'the schema is a flag, not part of the prompt');
    });

    it('keeps json_object as it was: a system instruction, no schema flag', () => {
      const args = claude.buildArgs({ prompt: 'hi', response_format: { type: 'json_object' } });
      assert.ok(!args.includes('--json-schema'));
      assert.match(args[args.indexOf('--system-prompt') + 1], /valid JSON only/);
    });

    it('fails instead of returning prose when the CLI produced no structured output', async () => {
      await assert.rejects(
        () => claude.chat({ prompt: 'A red square', response_format, model: 'claude-prose' }),
        (err) => err.status === 502 && /response_format json_schema/.test(err.message),
      );
    });

    it('streams the JSON as it is generated', async () => {
      const events = await drain(claude.chatStream({ prompt: 'A red square', response_format, model: 'claude-haiku' }));
      const deltas = events.filter((e) => e.type === 'delta').map((e) => e.content);
      assert.ok(deltas.length > 1, 'the JSON arrives in pieces, not as one chunk at the end');
      assert.deepEqual(JSON.parse(deltas.join('')), { color: 'red', shape: 'square' });
      assert.ok(events.find((e) => e.type === 'usage').usage.output_tokens > 0);
      assert.ok(!('structured_output' in events.find((e) => e.type === 'usage')));
    });

    it('fails a stream that ends without structured output', async () => {
      await assert.rejects(
        () => drain(claude.chatStream({ prompt: 'Count', response_format, model: 'claude-prose' })),
        (err) => err.status === 502 && /response_format json_schema/.test(err.message),
      );
    });

    it('streams plain text unchanged when no schema was asked for', async () => {
      const events = await drain(claude.chatStream({ prompt: 'Count', model: 'claude-prose' }));
      assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.content).join(''), '1\n2\n3\n4\n5');
    });
  });

  describe('codex', () => {
    it('writes the schema to a private file in the request directory and removes it after', async () => {
      const result = await codex.chat({ prompt: 'A red square', response_format, model: 'codex' });
      assert.deepEqual(JSON.parse(result.content), { color: 'red', shape: 'square' });

      const run = lastRun('codex');
      assert.equal(run.args[run.args.indexOf('--output-schema') + 1], 'output-schema.json');
      assert.deepEqual(JSON.parse(run.schemaFile.content), schema);
      assert.equal(run.schemaFile.mode, 0o600);
      assert.ok(await waitUntilGone(run.cwd), 'the request directory outlived the request');
    });

    it('does not add the JSON-only instruction when the schema does that job', () => {
      const args = codex.buildArgs({ prompt: 'hi', response_format, model: 'codex' });
      assert.doesNotMatch(args.at(-1), /valid JSON only/);
      assert.equal(codex.buildFiles({ response_format: { type: 'json_object' } }), undefined);
    });

    it('answers 400 naming response_format when strict mode refuses the schema, and still cleans up', async () => {
      await assert.rejects(
        () => codex.chat({ prompt: 'A red square', response_format, model: 'codex-strict-refused' }),
        (err) => err.status === 400 && err.code === 'invalid_request' && /response_format/.test(err.message),
      );
      assert.ok(await waitUntilGone(lastRun('codex').cwd));
    });

    it('streams the structured answer as its content', async () => {
      const events = await drain(codex.chatStream({ prompt: 'A red square', response_format, model: 'codex' }));
      const content = events.filter((e) => e.type === 'delta').map((e) => e.content).join('');
      assert.deepEqual(JSON.parse(content), { color: 'red', shape: 'square' });
      assert.ok(await waitUntilGone(lastRun('codex').cwd));
    });
  });
});
