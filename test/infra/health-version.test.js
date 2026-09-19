const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The dashboard has to name the binary that is answering: "claude is ready" does not say whether
// the pinned version in VERSIONS.md is the one installed.
describe('provider version probe', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let health;

  function writeCli(cli, body) {
    fs.writeFileSync(path.join(fakeBin, cli), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  }

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-version-'));

    writeCli('claude', `const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('2.1.273 (Claude Code)'); return; }
process.stdout.write(JSON.stringify({ loggedIn: true }));`);

    writeCli('codex', `const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('codex-cli 0.154.0'); return; }
process.stdout.write('Logged in using ChatGPT');`);

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    health = require('../../src/infra/health');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('extracts the version from whatever prose the CLI wraps it in', async () => {
    assert.equal(await health.getProviderVersion('claude'), '2.1.273');
    assert.equal(await health.getProviderVersion('codex'), '0.154.0');
  });

  it('asks the binary once and keeps the answer', async () => {
    health.resetProviderVersions();
    assert.equal(await health.getProviderVersion('claude'), '2.1.273');

    // Replace the binary with one that answers differently. A cached version keeps the first
    // answer; a re-probe on every call would pick this up.
    writeCli('claude', "process.stdout.write('9.9.9');");
    assert.equal(await health.getProviderVersion('claude'), '2.1.273', 'the version was probed again');
  });

  it('reports no version rather than failing when the binary is missing', async () => {
    assert.equal(await health.getProviderVersion('shellm-no-such-cli'), null);
  });
});
