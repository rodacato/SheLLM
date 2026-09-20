'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Nothing in the suite runs these — they only ever execute on a host, from a timer. What is left
// to protect is the handful of properties that decide whether a nightly snapshot works or only
// appears to, and each assertion names the failure it exists to prevent.
const root = path.join(__dirname, '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const SERVICE_UNIT = read('config/systemd/shellm-backup.service');
const TIMER_UNIT = read('config/systemd/shellm-backup.timer');
const SHELLM_UNIT = read('shellm.service');
const VPS = read('scripts/setup/vps.sh');
const { BACKUP_DIR } = require('../../src/cli/paths');

function parseUnit(text) {
  const directives = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    (directives[trimmed.slice(0, eq)] ||= []).push(trimmed.slice(eq + 1));
  }
  return directives;
}

describe('shellm-backup.service', () => {
  const unit = parseUnit(SERVICE_UNIT);
  const serviceUser = parseUnit(SHELLM_UNIT).User[0];

  it('runs as the user that owns the database, never as root', () => {
    assert.deepEqual(
      unit.User,
      [serviceUser],
      'as root, opening the database creates root-owned -wal and -shm files in the service '
      + 'user\'s state directory, and the service can no longer write its own database',
    );
  });

  it('takes the snapshot through the command rather than repeating it', () => {
    const [execStart] = unit.ExecStart;
    assert.match(execStart, /\bshellm backup\b/, `ExecStart=${execStart} does not call the command`);
    assert.doesNotMatch(execStart, /sqlite3/, 'a second implementation of the snapshot would diverge');
  });

  it('sets its own PATH instead of inheriting one', () => {
    const [envPath] = (unit.Environment || []).filter((v) => v.startsWith('PATH=')).map((v) => v.slice(5));
    assert.ok(envPath, '`shellm` lands in whichever prefix npm was configured with; PATH has to name both');
    assert.ok(envPath.includes('/usr/local/bin') && envPath.includes('/usr/bin'), `PATH=${envPath}`);
  });

  it('gives a snapshot longer than the 90 s a oneshot inherits', () => {
    const [timeout] = unit.TimeoutStartSec || [];
    assert.ok(timeout, 'a Type=oneshot inherits DefaultTimeoutStartUSec, which is 90 s on a stock box');
    assert.ok(Number(timeout) >= 300, `TimeoutStartSec=${timeout} is short for a large database on a busy host`);
  });

  it('can write the two directories it actually writes, and nothing more', () => {
    const writable = (unit.ReadWritePaths || []).flatMap((v) => v.split(/\s+/)).map((p) => p.replace(/^-/, ''));
    assert.ok(
      writable.some((dir) => BACKUP_DIR === dir || BACKUP_DIR.startsWith(`${dir}/`)),
      `ProtectSystem=strict mounts everything read-only; ${BACKUP_DIR} is where the command writes `
      + `and ReadWritePaths=${writable.join(' ')} does not grant it back`,
    );
    assert.ok(
      writable.some((dir) => dir.endsWith('/.shellm')),
      'opening the live database writes its -wal and -shm files beside it',
    );
    assert.ok(
      !writable.some((dir) => dir === `/home/${serviceUser}`),
      'granting the whole home back makes the checkout writable to this unit for no reason',
    );
  });
});

describe('shellm-backup.timer', () => {
  const unit = parseUnit(TIMER_UNIT);

  it('fires on a schedule and catches up after downtime', () => {
    assert.ok(unit.OnCalendar, 'a timer with no schedule never fires');
    assert.deepEqual(unit.Persistent, ['true'],
      'without it a host that was off at the scheduled time silently skips the day');
  });

  it('is wired into the timer target', () => {
    assert.deepEqual(unit.WantedBy, ['timers.target']);
  });
});

describe('vps.sh', () => {
  it('creates the snapshot directory owned by the service user', () => {
    const serviceUser = parseUnit(SHELLM_UNIT).User[0];
    const [line] = VPS.split('\n').filter((l) => l.includes(BACKUP_DIR) && l.includes('install -d'));
    assert.ok(line, `nothing in vps.sh creates ${BACKUP_DIR}, and /var/lib is root's — the command `
      + 'would fail on its first run with a permission error');
    assert.match(line, new RegExp(`-o "?\\$\\{SERVICE_USER\\}"?|-o ${serviceUser}`),
      `${line.trim()} leaves the directory root-owned, which the command cannot write`);
  });

  it('installs the timer without enabling it', () => {
    assert.ok(VPS.includes('config/systemd/shellm-backup.timer'), 'vps.sh never installs the timer');
    const enabled = VPS.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^systemctl\s+enable\b/.test(l) && l.includes('shellm-backup'));
    assert.deepEqual(enabled, [],
      'when a snapshot is taken, and whether one is taken at all, is the operator\'s decision');
  });
});
