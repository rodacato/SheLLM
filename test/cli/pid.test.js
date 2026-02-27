'use strict';

const { describe, it, mock, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const TMP_PID = path.join(os.tmpdir(), `shellm-test-${process.pid}.pid`);

describe('cli pid', () => {
  let pid;

  before(() => {
    mock.module(path.resolve(__dirname, '../../src/cli/paths.js'), {
      namedExports: {
        PID_FILE: TMP_PID,
        SHELLM_DIR: os.tmpdir(),
        LOG_DIR: os.tmpdir(),
        LOG_FILE: path.join(os.tmpdir(), 'shellm-test.log'),
        PROJECT_ROOT: path.resolve(__dirname, '../..'),
        SERVER_SCRIPT: path.resolve(__dirname, '../../src/server.js'),
      },
    });

    delete require.cache[require.resolve('../../src/cli/pid')];
    pid = require('../../src/cli/pid');
  });

  afterEach(() => {
    try { fs.unlinkSync(TMP_PID); } catch { /* ok */ }
  });

  it('writePid and readPid round-trip correctly', () => {
    pid.writePid(process.pid);
    assert.strictEqual(pid.readPid(), process.pid);
  });

  it('readPid returns null when no PID file exists', () => {
    assert.strictEqual(pid.readPid(), null);
  });

  it('readPid returns null when PID file contains a dead process', () => {
    fs.writeFileSync(TMP_PID, '999999');
    assert.strictEqual(pid.readPid(), null);
  });

  it('readPid returns null for non-numeric content', () => {
    fs.writeFileSync(TMP_PID, 'not-a-pid');
    assert.strictEqual(pid.readPid(), null);
  });

  it('removePid deletes the file', () => {
    pid.writePid(process.pid);
    assert.ok(fs.existsSync(TMP_PID));
    pid.removePid();
    assert.ok(!fs.existsSync(TMP_PID));
  });

  it('removePid does not throw if file is already gone', () => {
    assert.doesNotThrow(() => pid.removePid());
  });
});
