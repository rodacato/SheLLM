'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SHELLM_DIR, PID_FILE, LOG_DIR, LOG_FILE, PROJECT_ROOT, SERVER_SCRIPT } = require('../../src/cli/paths');

describe('cli paths', () => {
  it('all paths are absolute', () => {
    for (const p of [SHELLM_DIR, PID_FILE, LOG_DIR, LOG_FILE, PROJECT_ROOT, SERVER_SCRIPT]) {
      assert.ok(path.isAbsolute(p), `expected absolute path: ${p}`);
    }
  });

  it('SHELLM_DIR is ~/.shellm', () => {
    assert.strictEqual(SHELLM_DIR, path.join(os.homedir(), '.shellm'));
  });

  it('PID_FILE, LOG_DIR, and LOG_FILE are under SHELLM_DIR', () => {
    assert.ok(PID_FILE.startsWith(SHELLM_DIR));
    assert.ok(LOG_DIR.startsWith(SHELLM_DIR));
    assert.ok(LOG_FILE.startsWith(LOG_DIR));
    assert.match(PID_FILE, /\.pid$/);
    assert.match(LOG_FILE, /\.log$/);
  });

  it('PROJECT_ROOT and SERVER_SCRIPT resolve to existing paths', () => {
    assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'package.json')));
    assert.ok(SERVER_SCRIPT.endsWith('server.js'));
    assert.ok(fs.existsSync(SERVER_SCRIPT));
  });
});
