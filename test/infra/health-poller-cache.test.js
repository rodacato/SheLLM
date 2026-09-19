const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The background poller writes the cache and refreshes it before it expires, so its write is
// what /admin/health serves in production — the fresh-cache path almost never runs. Both of
// these were only ever asserted against that path, and both were wrong in the poller's.
describe('health cache written by the poller', () => {
  const originalPath = process.env.PATH;
  let fakeBin;
  let health;

  before(() => {
    assert.ok(!require.cache[require.resolve('../../src/providers/base')], 'base.js already captured the real PATH');
    fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-poller-'));

    // claude answers and is logged in; codex answers --version but reports itself logged out,
    // so one provider of two is unhealthy. Both are faked so the result does not depend on
    // what happens to be installed on the machine running the suite.
    fs.writeFileSync(path.join(fakeBin, 'claude'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('2.1.273 (Claude Code)'); return; }
process.stdout.write(JSON.stringify({ loggedIn: true }));`, { mode: 0o755 });

    fs.writeFileSync(path.join(fakeBin, 'codex'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('codex-cli 0.154.0'); return; }
process.stderr.write('Not authenticated. Run codex login.');
process.exit(1);`, { mode: 0o755 });

    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
    health = require('../../src/infra/health');
  });

  after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('reports the real status instead of a hardcoded ok', async () => {
    health.resetProviderVersions();
    await health.pollAllProviders();

    const status = await health.getHealthStatus();
    assert.notEqual(status.status, 'ok', 'a provider that cannot answer must not be served as ok');
    assert.equal(status.status, 'degraded', 'one of two providers is unreachable');
  });

  it('carries each installed provider version', async () => {
    health.resetProviderVersions();
    await health.pollAllProviders();

    const { providers } = await health.getHealthStatus();
    assert.equal(providers.claude.version, '2.1.273');
    assert.equal(providers.codex.version, '0.154.0',
      'a provider that is installed but logged out still names the binary behind it');
  });
});
