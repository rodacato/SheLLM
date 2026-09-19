const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE = path.resolve(__dirname, '../fixtures/claude/2.1.273/stream-json.jsonl');

describe('claude streaming', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    // Writes the real CLI transcript in two pieces that split a JSON line in half,
    // which is what a chunked stdout actually does.
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const out = fs.readFileSync(${JSON.stringify(FIXTURE)}, 'utf8');
const cut = Math.floor(out.length * 0.4);
process.stdout.write(out.slice(0, cut));
setTimeout(() => process.stdout.write(out.slice(cut)), 20);
`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('asks the CLI for stream-json, which is the only mode that emits incrementally', () => {
    const args = claude.buildStreamArgs({ prompt: 'hi', model: 'claude' });
    assert.deepEqual(
      args.slice(args.indexOf('--output-format'), args.indexOf('--')),
      ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    );
    assert.ok(!claude.buildArgs({ prompt: 'hi', model: 'claude' }).includes('stream-json'));
  });

  it('yields one delta per content_block_delta, reassembling lines across chunks', async () => {
    const events = [];
    for await (const event of claude.chatStream({ prompt: 'Count', model: 'claude' })) events.push(event);

    const deltas = events.filter((e) => e.type === 'delta').map((e) => e.content);
    assert.deepEqual(deltas, ['1\n2\n3\n4', '\n5']);
    assert.equal(deltas.join(''), '1\n2\n3\n4\n5');
    assert.equal(events.at(-1).type, 'done');
  });

  it('carries the real token usage from the result event', async () => {
    const events = [];
    for await (const event of claude.chatStream({ prompt: 'Count', model: 'claude' })) events.push(event);

    const usage = events.find((e) => e.type === 'usage');
    assert.ok(usage, 'a usage event is emitted');
    assert.ok(usage.usage.input_tokens > 0);
    assert.ok(usage.usage.output_tokens > 0);
    assert.ok(usage.cost_usd > 0);
  });

  it('ignores progress noise instead of streaming it to the caller', () => {
    assert.equal(claude.parseStreamLine('{"type":"system","subtype":"init"}'), null);
    assert.equal(claude.parseStreamLine('{"type":"rate_limit_event"}'), null);
    assert.equal(claude.parseStreamLine('not json at all'), null);
    assert.equal(claude.parseStreamLine(''), null);
  });
});
