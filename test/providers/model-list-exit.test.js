const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// codex app-server can exit without answering (logged out, a bad config). The catalog read must
// end with the process, not 25 s later, and writing to the dead process must not crash SheLLM.
describe('codex app-server that exits without answering', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let modeFile;
  let appServerCall;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-fakebin-'));
    modeFile = path.join(fakeBin, 'mode');
    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!${process.execPath}
const fs = require('fs');
if (fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8') === 'exit') process.exit(1);
process.stdin.on('data', (chunk) => {
  for (const line of String(chunk).split('\\n').filter(Boolean)) {
    const { id } = JSON.parse(line);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { data: ['ok'] } }) + '\\n');
  }
});
`, { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    ({ appServerCall } = require('../../src/providers/model-list'));
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('answers null as soon as the process is gone', async () => {
    fs.writeFileSync(modeFile, 'exit');
    const started = Date.now();

    const result = await appServerCall('model/list');

    assert.equal(result, null);
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  });

  it('still reads the answer from a server that stays up', async () => {
    fs.writeFileSync(modeFile, 'serve');

    assert.deepEqual(await appServerCall('model/list'), { data: ['ok'] });
  });
});
