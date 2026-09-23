const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

const CLI = path.resolve(__dirname, '../../src/cli.js');

describe('shellm init', () => {
  let home;
  let bin;
  let configFile;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-home-'));
    bin = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-bin-'));
    configFile = path.join(home, '.config', 'shellm', 'env');
    fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.273 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: !!process.env.CLAUDE_CODE_OAUTH_TOKEN, authMethod: 'oauth_token' })); process.exit(0); }
process.exit(2);
`, { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  });

  function init(input) {
    return new Promise((resolve) => {
      const child = execFile(process.execPath, [CLI, 'init'], { env: { HOME: home, PATH: bin }, timeout: 30000 },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  it('creates a private config with the token, a generated admin password and a first key', async () => {
    const result = await init('fake-oauth-token-for-tests\n');
    assert.strictEqual(result.code, 0, result.stdout + result.stderr);

    assert.strictEqual(fs.statSync(configFile).mode & 0o777, 0o600);
    const config = dotenv.parse(fs.readFileSync(configFile));
    assert.strictEqual(config.CLAUDE_CODE_OAUTH_TOKEN, 'fake-oauth-token-for-tests');
    assert.strictEqual(config.HOST, '127.0.0.1');
    assert.strictEqual(config.MAX_CONCURRENT, '4');
    assert.strictEqual(config.MAX_STREAM_CONCURRENT, '4');
    assert.strictEqual(config.SHELLM_GLOBAL_RPM, '60');
    assert.ok(config.SHELLM_ADMIN_PASSWORD.length >= 24);

    assert.match(result.stdout, /API key \(shown once, store it now\): shellm-[0-9a-f]{32}/);
    assert.match(result.stdout, /export ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:6100/);
    assert.match(result.stdout, /All checks passed|✓ API keys: 1 active/);
  });

  // The marker is what separates "a release added this" from "you just installed", so it has to
  // record the version that created the file and must never appear on one that already existed.
  it('stamps a config it creates with the release that created it', async () => {
    await init('fake-oauth-token-for-tests\n');
    const text = fs.readFileSync(configFile, 'utf8');
    const version = require('../../package.json').version;

    assert.match(text, new RegExp(`^# shellm-config-version: v${version.replace(/\./g, '\\.')}$`, 'm'));
    assert.ok(text.startsWith('# shellm-config-version:'), 'the marker is not the first line');
  });

  it('never stamps a config that already existed', async () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, 'PORT=7000\n', { mode: 0o600 });

    await init('\n');
    const text = fs.readFileSync(configFile, 'utf8');
    assert.doesNotMatch(text, /shellm-config-version/, 'an existing config was stamped, which would dismiss real warnings');
  });

  // The server resolves environment over file, so init must print the address the server will
  // actually listen on — not the default it just wrote into a file the environment overrides.
  it('prints the address the environment asks for, not the one it wrote', async () => {
    const result = await new Promise((resolve) => {
      const child = execFile(process.execPath, [CLI, 'init'],
        { env: { HOME: home, PATH: bin, PORT: '6199', HOST: '0.0.0.0' }, timeout: 30000 },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
      child.stdin.end('\n');
    });

    assert.match(result.stdout, /http:\/\/0\.0\.0\.0:6199/, 'init advertised an address the server will not use');
    assert.doesNotMatch(result.stdout, /http:\/\/127\.0\.0\.1:6100/);
  });

  it('keeps existing values and keys when run again', async () => {
    await init('fake-oauth-token-for-tests\n');
    const before = fs.readFileSync(configFile, 'utf8');

    const again = await init('');
    assert.strictEqual(again.code, 0, again.stdout);
    assert.strictEqual(fs.readFileSync(configFile, 'utf8'), before);
    assert.doesNotMatch(again.stdout, /API key \(shown once/);
    assert.doesNotMatch(again.stdout, /Token \(Enter to skip/);
    assert.match(again.stdout, /\(unchanged\)/);
  });

  it('adds only what is missing to a config written by hand', async () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, '# mine\nPORT=7000\nMAX_CONCURRENT=2\nSHELLM_ADMIN_PASSWORD=my-own-long-password\n', { mode: 0o644 });

    await init('\n');
    const text = fs.readFileSync(configFile, 'utf8');
    const config = dotenv.parse(text);
    assert.ok(text.startsWith('# mine\n'));
    assert.strictEqual(config.PORT, '7000');
    assert.strictEqual(config.MAX_CONCURRENT, '2');
    assert.strictEqual(config.SHELLM_ADMIN_PASSWORD, 'my-own-long-password');
    assert.strictEqual(config.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.strictEqual(fs.statSync(configFile).mode & 0o777, 0o600);
  });
});
