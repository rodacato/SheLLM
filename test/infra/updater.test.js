'use strict';

const { describe, it, mock, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// `systemctl is-active` answers `inactive` for a unit that was never installed exactly as it does
// for one that is installed and deliberately off. Those two need different instructions from the
// operator — re-provision versus enable — so the dashboard asks twice. These tests drive the
// three answers systemd can give and check the distinction survives.
describe('updater trigger state', () => {
  let updater;
  let calls;
  let respond;
  let home;
  const realHome = process.env.HOME;

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-updater-'));
    process.env.HOME = home;

    mock.module('node:child_process', {
      namedExports: {
        execFileSync: (file, args) => {
          calls.push([file, ...args]);
          return respond(args);
        },
      },
    });

    for (const key of Object.keys(require.cache)) {
      if (key.includes('src/infra/') || key.includes('src/cli/paths')) delete require.cache[key];
    }
    updater = require('../../src/infra/updater');
  });

  after(() => {
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    calls = [];
    updater.resetTriggerState();
  });

  // What a non-zero exit looks like from execFileSync: the output is on the error.
  function exits(status, stdout) {
    const err = new Error(`exited ${status}`);
    err.status = status;
    err.stdout = stdout;
    throw err;
  }

  it('reports a host with no systemd as unavailable rather than as not installed', () => {
    respond = () => { const e = new Error('spawn systemctl ENOENT'); e.code = 'ENOENT'; throw e; };
    assert.equal(updater.triggerState(), 'unavailable');
  });

  it('separates a unit that was never installed from one that is switched off', () => {
    respond = (args) => (args[0] === 'list-unit-files' ? '0 unit files listed.' : exits(3, 'inactive'));
    assert.equal(updater.triggerState(), 'not_installed');
    assert.ok(
      !calls.some((c) => c.includes('is-active')),
      'a unit that does not exist should not be asked whether it is active',
    );

    updater.resetTriggerState();
    respond = (args) => (args[0] === 'list-unit-files'
      ? 'UNIT FILE               STATE\nshellm-update.path      disabled'
      : exits(3, 'inactive'));
    assert.equal(
      updater.triggerState(),
      'disabled',
      'is-active says inactive for both cases; only the unit-file listing tells them apart',
    );
  });

  it('reports an armed trigger as ready', () => {
    respond = (args) => (args[0] === 'list-unit-files'
      ? 'UNIT FILE               STATE\nshellm-update.path      enabled'
      : 'active');
    assert.equal(updater.triggerState(), 'ready');
  });

  it('asks systemd at most once per state, not once per poll', () => {
    respond = (args) => (args[0] === 'list-unit-files' ? 'shellm-update.path enabled' : 'active');
    updater.triggerState();
    const first = calls.length;
    updater.triggerState();
    updater.triggerState();
    assert.equal(calls.length, first, 'the dashboard polls; spawning two processes each time is not free');
  });

  describe('the last reported outcome', () => {
    const statusFile = () => path.join(process.env.HOME, '.shellm', 'update-status.json');

    beforeEach(() => {
      fs.mkdirSync(path.dirname(statusFile()), { recursive: true });
      fs.rmSync(statusFile(), { force: true });
    });

    it('is null when the updater has never run', () => {
      assert.equal(updater.lastStatus(), null);
    });

    it('calls a run that stopped reporting stalled, not still running', () => {
      const old = new Date(Date.now() - updater.RUN_TIMEOUT_MS - 1000).toISOString();
      fs.writeFileSync(statusFile(), JSON.stringify({ state: 'running', ref: 'v2.0.0', started_at: old }));
      const status = updater.lastStatus();
      assert.equal(status.state, 'running');
      assert.equal(
        status.stalled,
        true,
        'the runner traps every signal it can, so one that reported nothing was killed with the one it cannot',
      );
    });

    it('leaves a run that started moments ago alone', () => {
      fs.writeFileSync(statusFile(), JSON.stringify({ state: 'running', ref: 'v2.0.0', started_at: new Date().toISOString() }));
      assert.equal(updater.lastStatus().stalled, false);
    });

    it('survives a status file it cannot parse', () => {
      fs.writeFileSync(statusFile(), 'not json at all');
      assert.equal(updater.lastStatus().state, 'unknown');
    });
  });
});

describe('version comparison', () => {
  const { compareVersions, isMajorJump, TAG_PATTERN } = require('../../src/infra/updater');

  it('orders releases numerically, not as strings', () => {
    assert.equal(compareVersions('v1.10.0', '1.9.0'), 1, '"1.10.0" < "1.9.0" as strings, and that would hide an upgrade');
    assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
    assert.equal(compareVersions('v1.1.1', '1.2.0'), -1);
  });

  it('refuses to guess at anything that is not vX.Y.Z', () => {
    assert.equal(compareVersions('v1.2', '1.2.0'), null);
    assert.equal(compareVersions('master', '1.2.0'), null);
    for (const bad of ['v1.2', '1.2.0', 'v1.2.0-rc1', 'master', '../../etc']) {
      assert.ok(!TAG_PATTERN.test(bad), `${bad} should not read as a release tag`);
    }
    assert.ok(TAG_PATTERN.test('v1.2.0'));
  });

  it('knows a major jump from a patch', () => {
    assert.equal(isMajorJump('v2.0.0', '1.9.9'), true);
    assert.equal(isMajorJump('v1.9.9', '1.2.0'), false);
  });
});
