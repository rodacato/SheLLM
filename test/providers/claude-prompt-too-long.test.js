const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURE = path.resolve(__dirname, '../fixtures/claude/2.1.273/result-prompt-too-long.json');

// The CLI refuses a prompt past the context window before any API call: it prints this result
// and exits 1. The fake replays that, so the mapping is tested against what the CLI really said.
describe('a prompt past the context window', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let claude;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
require('fs').readFileSync(0);
process.stdout.write(require('fs').readFileSync(${JSON.stringify(FIXTURE)}, 'utf8'));
process.exit(1);
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    claude = require('../../src/providers/claude');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('is a 400 the caller can act on, carrying the CLI\'s own count, not a 502 "Unknown error"', async () => {
    await assert.rejects(claude.chat({ prompt: 'too long', model: 'claude-haiku' }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'context_length_exceeded');
      assert.match(err.message, /limit 200000/);
      return true;
    });
  });

  it('is the same 400 on a stream', async () => {
    const drain = async () => { for await (const _event of claude.chatStream({ prompt: 'too long', model: 'claude-haiku' })) { /* drain */ } };
    await assert.rejects(drain(), (err) => err.status === 400 && err.code === 'context_length_exceeded');
  });
});
