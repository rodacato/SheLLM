const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '../../src/server.js');
const PRINT_PROBE = `require(${JSON.stringify(SERVER)}); process.stdout.write('\\nPROBE=' + (process.env.SHELLM_PROBE || 'unset'))`;

describe('config file', () => {
  let home;
  let workdir;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-home-'));
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-cwd-'));
    fs.writeFileSync(path.join(workdir, '.env'), 'SHELLM_PROBE=repo\n');
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function probe() {
    const { SHELLM_PROBE: _probe, XDG_CONFIG_HOME: _xdg, ...env } = process.env;
    return execFileSync(process.execPath, ['-e', PRINT_PROBE], { cwd: workdir, env: { ...env, HOME: home } }).toString().match(/^PROBE=(.*)$/m)[1];
  }

  it('loads config from ~/.config/shellm/env', () => {
    fs.mkdirSync(path.join(home, '.config', 'shellm'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'shellm', 'env'), 'SHELLM_PROBE=config\n');
    assert.strictEqual(probe(), 'config');
  });

  it('ignores a .env in the working directory', () => {
    assert.strictEqual(probe(), 'unset');
  });
});
