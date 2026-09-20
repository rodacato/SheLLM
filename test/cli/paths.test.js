'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SHELLM_DIR, DB_FILE, PID_FILE, LOG_DIR, LOG_FILE, BACKUP_DIR, PROJECT_ROOT, SERVER_SCRIPT, CLI_SCRIPT } = require('../../src/cli/paths');

describe('cli paths', () => {
  it('all paths are absolute', () => {
    for (const p of [SHELLM_DIR, DB_FILE, PID_FILE, LOG_DIR, LOG_FILE, BACKUP_DIR, PROJECT_ROOT, SERVER_SCRIPT, CLI_SCRIPT]) {
      assert.ok(path.isAbsolute(p), `expected absolute path: ${p}`);
    }
  });

  it('SHELLM_DIR is ~/.shellm', () => {
    assert.strictEqual(SHELLM_DIR, path.join(os.homedir(), '.shellm'));
  });

  it('DB_FILE, PID_FILE, LOG_DIR, and LOG_FILE are under SHELLM_DIR', () => {
    assert.ok(DB_FILE.startsWith(SHELLM_DIR));
    assert.ok(PID_FILE.startsWith(SHELLM_DIR));
    assert.ok(LOG_DIR.startsWith(SHELLM_DIR));
    assert.ok(LOG_FILE.startsWith(LOG_DIR));
    assert.match(PID_FILE, /\.pid$/);
    assert.match(LOG_FILE, /\.log$/);
  });

  it('PROJECT_ROOT, SERVER_SCRIPT and CLI_SCRIPT resolve to existing paths', () => {
    assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'package.json')));
    assert.ok(SERVER_SCRIPT.endsWith('server.js'));
    assert.ok(fs.existsSync(SERVER_SCRIPT));
    assert.ok(CLI_SCRIPT.endsWith('cli.js'));
    assert.ok(fs.existsSync(CLI_SCRIPT));
  });

  // The database used to be spelled out again inside src/db, and the operator's own backup job
  // spelled it out a third time. One definition is the point.
  it('DB_FILE is the path src/db opens', () => {
    assert.strictEqual(DB_FILE, path.join(SHELLM_DIR, 'shellm.db'));
    assert.match(fs.readFileSync(path.join(PROJECT_ROOT, 'src/db/index.js'), 'utf8'), /DB_FILE/);
  });
});
