const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

const CLAUDE_FIXTURES = path.resolve(__dirname, '../fixtures/claude/2.1.273');
const CODEX_FIXTURES = path.resolve(__dirname, '../fixtures/codex/0.154.0');

// 1x1 PNG and a JPEG header: enough bytes for the CLI side, which never decodes them here.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');

const parts = [
  { type: 'text', text: 'Front: ' },
  { type: 'image', number: 1, media_type: 'image/png', data: PNG },
  { type: 'text', text: '\nInside: ' },
  { type: 'image', number: 2, media_type: 'image/jpeg', data: JPEG },
];
const prompt = 'Front: [image 1]\nInside: [image 2]';

async function waitUntilGone(dir) {
  for (let i = 0; i < 50 && fs.existsSync(dir); i++) await sleep(10);
  return !fs.existsSync(dir);
}

async function drain(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('image parts reach the CLI', () => {
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

    // Records what it was given, then answers the way the real CLI did for an image.
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; }).on('end', () => {
  fs.writeFileSync(${JSON.stringify(fakeBin)} + '/claude.run.json', JSON.stringify({ args, stdin }));
  const file = args.includes('--include-partial-messages') ? 'stream-json.jsonl' : 'ndjson-image.jsonl';
  process.stdout.write(fs.readFileSync(${JSON.stringify(CLAUDE_FIXTURES)} + '/' + file, 'utf8'));
});
`, { mode: 0o755 });

    // "codex-fails" exits the way a rejected turn does, after the files were written;
    // "codex-hangs" answers and then never exits, like a caller walking away mid-turn.
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const images = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
const files = images.map((name) => ({
  name,
  mode: fs.statSync(name).mode & 0o777,
  base64: fs.readFileSync(name).toString('base64'),
}));
const stdin = args.at(-1) === '-' ? fs.readFileSync(0, 'utf8') : '';
fs.writeFileSync(${JSON.stringify(fakeBin)} + '/codex.run.json', JSON.stringify({ args, cwd: process.cwd(), files, stdin }));
const model = args[args.indexOf('-m') + 1];
const file = model === 'fails' ? 'exec-json-unknown-model.jsonl' : 'exec-json-image.jsonl';
process.stdout.write(fs.readFileSync(${JSON.stringify(CODEX_FIXTURES)} + '/' + file, 'utf8'));
if (model === 'hangs') setInterval(() => {}, 1000);
else process.exit(model === 'fails' ? 1 : 0);
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
    it('writes one stream-json user message to stdin, images in place among the text', async () => {
      const result = await claude.chat({ prompt, parts, model: 'claude-haiku' });
      assert.equal(result.content, 'Red.', 'the answer is read from the result event of the NDJSON');
      assert.ok(result.usage.output_tokens > 0);

      const { args, stdin } = lastRun('claude');
      assert.ok(stdin.endsWith('\n'));
      const message = JSON.parse(stdin);
      assert.equal(message.type, 'user');
      assert.deepEqual(message.message.content, [
        { type: 'text', text: 'Front: ' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
        { type: 'text', text: '\nInside: ' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
      ]);
      assert.deepEqual(args.slice(args.indexOf('--output-format')), [
        '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
      ], 'stream-json input is only accepted with stream-json output');
      assert.ok(!args.includes('--'), 'the prompt is not also passed as an argument');
    });

    it('keeps the isolation flags when the message comes through stdin', () => {
      const args = claude.buildArgs({ prompt, parts });
      for (const flag of claude.ISOLATION_ARGS) assert.ok(args.includes(flag), `${flag} is missing`);
    });

    it('streams with images through the same stdin message', async () => {
      const events = await drain(claude.chatStream({ prompt, parts, model: 'claude-sonnet' }));
      assert.ok(events.some((e) => e.type === 'delta'));
      const { args, stdin } = lastRun('claude');
      assert.ok(args.includes('--include-partial-messages'));
      assert.equal(JSON.parse(stdin).message.content.length, 4);
    });

    it('sends a request without images as plain text on stdin, with plain json output', () => {
      const args = claude.buildArgs({ prompt: 'hello' });
      assert.deepEqual(args.slice(-2), ['--output-format', 'json']);
      assert.ok(!args.includes('--input-format'));
      assert.equal(claude.buildInput({ prompt: 'hello' }), 'hello');
    });
  });

  describe('codex', () => {
    it('attaches each image as a private file named after its marker, and removes them after', async () => {
      const result = await codex.chat({ prompt, parts, model: 'codex' });
      assert.equal(result.content, 'Red');

      const run = lastRun('codex');
      assert.deepEqual(run.files.map((f) => f.name), ['image-1.png', 'image-2.jpg']);
      assert.deepEqual(run.files.map((f) => f.base64), [PNG, JPEG], 'the file holds the decoded bytes');
      assert.ok(run.files.every((f) => f.mode === 0o600));
      assert.deepEqual(run.args.slice(-2), ['--', '-'], 'the stdin marker is not swallowed by the last -i');
      assert.equal(run.stdin, prompt);
      assert.ok(await waitUntilGone(run.cwd));
    });

    it('removes the images when the CLI fails', async () => {
      await assert.rejects(() => codex.chat({ prompt, parts, model: 'codex-fails' }));
      assert.ok(await waitUntilGone(lastRun('codex').cwd));
    });

    it('removes the images when the caller disconnects mid-stream', async () => {
      const ac = new AbortController();
      let cwd = null;
      for await (const event of codex.chatStream({ prompt, parts, model: 'codex-hangs', signal: ac.signal })) {
        if (event.type !== 'delta') continue;
        cwd = lastRun('codex').cwd;
        assert.ok(fs.existsSync(path.join(cwd, 'image-1.png')), 'the image is there while the CLI runs');
        ac.abort();
      }
      assert.ok(cwd, 'the stream produced an answer before the abort');
      assert.ok(await waitUntilGone(cwd));
    });

    it('adds no files and no separator to a request without images', () => {
      const args = codex.buildArgs({ prompt: 'ping', model: 'codex' });
      assert.ok(!args.includes('-i'));
      assert.ok(!args.includes('--'));
      assert.equal(codex.buildFiles({}), undefined);
    });
  });
});
