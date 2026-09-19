const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.resolve(__dirname, '../fixtures/codex/0.154.0');

// Concurrent codex processes race on the OAuth refresh (openai/codex#17340), so the adapter
// must never have two in flight. The fake CLI records when it starts and stops.
describe('codex concurrency', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let ledger;
  let codex;
  let base;

  function marks() {
    return fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean);
  }

  function overlapped(entries) {
    let running = 0;
    for (const entry of entries) {
      running += entry === 'start' ? 1 : -1;
      if (running > 1) return true;
    }
    return false;
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    ledger = path.join(fakeBin, 'ledger.txt');
    fs.writeFileSync(ledger, '');
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(ledger)}, 'start\\n');
setTimeout(() => {
  process.stdout.write(fs.readFileSync(${JSON.stringify(FIXTURES)} + '/exec-json.jsonl', 'utf8'));
  fs.appendFileSync(${JSON.stringify(ledger)}, 'end\\n');
}, 120);
`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    codex = require('../../src/providers/codex');
    base = require('../../src/providers/base');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('never runs two processes at once', async () => {
    fs.writeFileSync(ledger, '');
    const results = await Promise.all([1, 2, 3].map(() => codex.chat({ prompt: 'ping', model: 'codex' })));

    assert.equal(results.length, 3);
    for (const result of results) assert.equal(result.content, 'OK');
    const entries = marks();
    assert.equal(entries.filter((e) => e === 'start').length, 3, 'all three ran');
    assert.ok(!overlapped(entries), `two codex processes overlapped: ${entries.join(',')}`);
  });

  it('the same fake overlaps without the adapter, so the check above can fail', async () => {
    fs.writeFileSync(ledger, '');
    const args = codex.buildArgs({ prompt: 'ping', model: 'codex' });
    await Promise.all([1, 2, 3].map(() => base.execute('codex', args, { env: codex.env })));

    assert.ok(overlapped(marks()), 'the ledger cannot detect overlap, so the first test proves nothing');
  });

  it('serializes the streaming path too', async () => {
    fs.writeFileSync(ledger, '');
    await Promise.all([1, 2].map(async () => {
      for await (const _event of codex.chatStream({ prompt: 'ping', model: 'codex' })) { /* drain */ }
    }));

    assert.ok(!overlapped(marks()), 'two streaming codex processes overlapped');
  });
});
