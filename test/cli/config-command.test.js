const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '../../src/cli.js');

// `shellm config` exists to say which value is in effect and where it came from, so it has to read
// the config file the service reads, and it must never print a secret while doing it.
describe('shellm config', () => {
  let home;

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-config-home-'));
    fs.mkdirSync(path.join(home, '.config', 'shellm'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'shellm', 'env'),
      'MAX_CONCURRENT=6\nSHELLM_ADMIN_PASSWORD=never-print-this-secret\n', { mode: 0o600 });
  });

  after(() => fs.rmSync(home, { recursive: true, force: true }));

  const shellm = (args) => new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { HOME: home, PATH: process.env.PATH }, timeout: 30000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

  it('reports a value set in the config file, as coming from it', async () => {
    const { code, stdout } = await shellm(['config']);
    assert.equal(code, 0);
    assert.match(stdout, /^MAX_CONCURRENT\s+6\s+config file\b/m);
    assert.match(stdout, /^PORT\s+6100\s+default\b/m);
  });

  it('shows that a secret is set without printing it', async () => {
    const { stdout } = await shellm(['config']);
    assert.match(stdout, /^SHELLM_ADMIN_PASSWORD\s+\*{8}\s+config file\b/m);
    assert.doesNotMatch(stdout, /never-print-this-secret/);
  });
});
