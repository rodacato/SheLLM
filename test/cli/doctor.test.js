const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '../../src/cli.js');
const DB = path.resolve(__dirname, '../../src/db');

function shellm(args, { home, bin }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { HOME: home, PATH: bin }, timeout: 30000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

describe('shellm doctor', () => {
  let home;
  let bin;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-home-'));
    bin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-bin-'));
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    fs.mkdirSync(path.join(home, '.config', 'shellm'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'shellm', 'env'), 'HOST=127.0.0.1\n', { mode: 0o600 });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  });

  function installFakeClaude(authStatus) {
    fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.273 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { console.log(${JSON.stringify(JSON.stringify(authStatus))}); process.exit(${authStatus.loggedIn ? 0 : 1}); }
process.exit(2);
`, { mode: 0o755 });
  }

  function createKey() {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, ['-e', `const db = require(${JSON.stringify(DB)}); db.initDb(); db.createClient({ name: 'test' });`],
        { env: { HOME: home } }, (err) => (err ? reject(err) : resolve()));
    });
  }

  it('doctor exits non-zero when claude is missing', async () => {
    await createKey();
    const result = await shellm(['doctor'], { home, bin });
    assert.strictEqual(result.code, 1, result.stdout);
    assert.match(result.stdout, /✗ Claude CLI: not found on PATH/);
    assert.match(result.stdout, /fix: curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
  });

  it('passes when claude is logged in, the config is private and a key exists', async () => {
    installFakeClaude({ loggedIn: true, authMethod: 'claude.ai' });
    await createKey();
    const result = await shellm(['doctor'], { home, bin });
    assert.strictEqual(result.code, 0, result.stdout);
    assert.match(result.stdout, /All checks passed/);
  });

  it('fails a config file other users can read', async () => {
    installFakeClaude({ loggedIn: true, authMethod: 'claude.ai' });
    await createKey();
    fs.chmodSync(path.join(home, '.config', 'shellm', 'env'), 0o644);
    const result = await shellm(['doctor'], { home, bin });
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /✗ Config file: .* readable by other users/);
  });

  it('fails without an API key and when claude is logged out', async () => {
    installFakeClaude({ loggedIn: false, authMethod: 'none' });
    const result = await shellm(['doctor'], { home, bin });
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /✗ Claude login: not logged in/);
    assert.match(result.stdout, /✗ API keys: no active key/);
  });

  it('does not claim an env token is valid without --live', async () => {
    installFakeClaude({ loggedIn: true, authMethod: 'oauth_token' });
    await createKey();
    const result = await shellm(['doctor'], { home, bin });
    assert.match(result.stdout, /validity checked only with --live/);
  });
});
