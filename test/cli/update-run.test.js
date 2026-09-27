'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run, snapshotFailure } = require('../../src/cli/update');

// A real repository with two releases. git stays real; npm, systemd, the snapshot and the running
// service are the host, and the host is what these tests stand in for.
let workspace;
let app;
let v1;
let v2;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitFiles(files, message) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(app, name)), { recursive: true });
    fs.writeFileSync(path.join(app, name), content);
  }
  git(app, 'add', '-A');
  git(app, 'commit', '-q', '-m', message);
  return git(app, 'rev-parse', 'HEAD').trim();
}

function buildReleases(secondRelease) {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'shellm-update-run-'));
  const origin = path.join(workspace, 'origin.git');
  app = path.join(workspace, 'app');
  git(workspace, 'init', '-q', '--bare', '--initial-branch=master', origin);
  git(workspace, 'init', '-q', '--initial-branch=master', app);
  git(app, 'config', 'user.email', 'test@example.com');
  git(app, 'config', 'user.name', 'test');
  git(app, 'remote', 'add', 'origin', origin);

  v1 = commitFiles({ 'package-lock.json': '{"v":1}', 'README': 'one' }, 'v1');
  git(app, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  v2 = commitFiles(secondRelease, 'v2');
  git(app, 'tag', '-a', 'v2.0.0', '-m', 'v2.0.0');
  git(app, 'push', '-q', 'origin', 'master', '--tags');
  git(app, 'checkout', '-q', '--detach', v1);
}

// What the running service reports is decided by the commit it was last restarted on, so a restart
// that never happens leaves it serving the old release — exactly as on a host.
function fakeHost({ statusFor = () => 'ok', failing = {}, verified = true, snapshot } = {}) {
  const calls = [];
  const out = [];
  let runningOn = git(app, 'rev-parse', 'HEAD').trim();
  const fail = (cmd) => {
    const rule = Object.entries(failing).find(([pattern]) => cmd.includes(pattern));
    if (!rule) return;
    if (rule[1].times > 0) {
      rule[1].times -= 1;
      throw Object.assign(new Error(rule[1].message), { stderr: rule[1].message });
    }
  };
  const host = {
    git: (...args) => git(app, ...args),
    exec: (cmd) => { calls.push(cmd); fail(cmd); return ''; },
    execAsRoot: (cmd) => {
      calls.push(cmd);
      fail(cmd);
      if (cmd === 'systemctl restart shellm') runningOn = git(app, 'rev-parse', 'HEAD').trim();
      return '';
    },
    serving: () => (verified
      ? { reachable: true, verified: true, commit: runningOn.slice(0, 7), status: statusFor(runningOn) }
      : { reachable: true, verified: false }),
    snapshot: snapshot || (() => ({ ok: true, path: '/var/lib/shellm/backups/20260927T000000Z' })),
    sleep: () => {},
    log: (line) => out.push(line),
    error: (line) => out.push(line),
    exit: (code) => { host.exitCode = code; },
    exitCode: null,
  };
  return { host, calls, out, running: () => runningOn };
}

function head() {
  return git(app, 'rev-parse', 'HEAD').trim();
}

describe('shellm update, judged by what the service runs', () => {
  beforeEach(() => { process.env.SHELLM_REF = 'v2.0.0'; });
  afterEach(() => {
    delete process.env.SHELLM_REF;
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('succeeds when the restarted service serves the release with a provider up', () => {
    buildReleases({ README: 'two' });
    const { host, running } = fakeHost();
    const outcome = run({ host });
    assert.equal(outcome.code, 0);
    assert.equal(outcome.summary, 'running v2.0.0');
    assert.equal(head(), v2);
    assert.equal(running(), v2);
  });

  it('rolls back a release that starts but has every provider down', () => {
    buildReleases({ README: 'two' });
    const { host, running } = fakeHost({ statusFor: (commit) => (commit === v2 ? 'down' : 'ok') });
    const outcome = run({ host });
    assert.equal(outcome.code, 1);
    assert.equal(head(), v1, 'the checkout stayed on the broken release');
    assert.equal(running(), v1, 'the service was not restarted onto the previous release');
    assert.match(outcome.summary, /every provider down/);
    assert.match(outcome.summary, /rolled back to .*, which is serving\.$/);
    assert.equal(host.exitCode, 1);
  });

  it('does not accept a service that answers from the old process', () => {
    buildReleases({ README: 'two' });
    const { host } = fakeHost({ failing: { 'systemctl restart': { times: 0 } } });
    const serving = host.serving;
    host.serving = () => ({ ...serving(), commit: v1.slice(0, 7) });
    const outcome = run({ host });
    assert.equal(outcome.code, 1);
    assert.match(outcome.summary, new RegExp(`serving ${v1.slice(0, 7)}, not ${v2.slice(0, 8)}`));
  });

  it('rolls back a failure before the health check and puts the previous dependencies back', () => {
    buildReleases({ 'package-lock.json': '{"v":2}' });
    const { host, calls, running } = fakeHost({ failing: { 'npm ci': { times: 1, message: 'gyp ERR! stack Error: not found: make' } } });
    const outcome = run({ host });
    assert.equal(outcome.code, 1);
    assert.equal(head(), v1);
    assert.equal(running(), v1);
    assert.equal(calls.filter((c) => c.startsWith('npm ci')).length, 2, 'npm ci deletes node_modules first, so the old ones have to be reinstalled');
    assert.match(outcome.summary, /failed at npm ci \(gyp ERR! stack Error: not found: make\); rolled back to/);
    assert.ok(!calls.includes('npm run migrate'), 'kept going past the failed step');
  });

  it('says the schema was not reverted, and where the snapshot is, when the release migrated', () => {
    buildReleases({ 'src/db/migrations/999_new.sql': 'CREATE TABLE t (x);' });
    const { host } = fakeHost({ statusFor: (commit) => (commit === v2 ? 'down' : 'ok') });
    const outcome = run({ host });
    assert.equal(outcome.code, 1);
    assert.match(outcome.summary, /The schema was migrated and not reverted: restore \/var\/lib\/shellm\/backups\/20260927T000000Z/);
  });

  it('names the recovery when the rollback itself cannot finish', () => {
    buildReleases({ 'package-lock.json': '{"v":2}' });
    const { host } = fakeHost({ failing: { 'npm ci': { times: 2, message: 'gyp ERR! not found: make' } } });
    const outcome = run({ host });
    assert.equal(outcome.code, 1);
    assert.match(outcome.summary, /the rollback to .* failed too .* run scripts\/setup\/vps\.sh/);
  });

  it('restarts a service that is behind a checkout already at the target', () => {
    buildReleases({ README: 'two' });
    git(app, 'checkout', '-q', '--detach', v2);
    const { host, calls, running } = fakeHost();
    const stale = host.serving;
    let restarted = false;
    host.execAsRoot = (cmd) => { calls.push(cmd); if (cmd === 'systemctl restart shellm') restarted = true; return ''; };
    host.serving = () => ({ ...stale(), commit: (restarted ? v2 : v1).slice(0, 7) });
    const outcome = run({ host });
    assert.equal(outcome.code, 0);
    assert.match(outcome.summary, /^restarted onto v2\.0\.0/);
    assert.ok(calls.includes('systemctl restart shellm'));
    assert.equal(running(), v2);
  });

  it('does nothing when the service already runs the target', () => {
    buildReleases({ README: 'two' });
    git(app, 'checkout', '-q', '--detach', v2);
    const { host, calls } = fakeHost();
    host.serving = () => ({ reachable: true, verified: true, commit: v2.slice(0, 7), status: 'ok' });
    const outcome = run({ host });
    assert.equal(outcome.code, 0);
    assert.match(outcome.summary, /^already running v2\.0\.0/);
    assert.deepEqual(calls, []);
  });

  it('refuses to start without a snapshot and moves nothing', () => {
    buildReleases({ README: 'two' });
    const { host, calls } = fakeHost({ snapshot: () => ({ ok: false, summary: snapshotFailure("Error: Cannot find module 'better-sqlite3'") }) });
    const outcome = run({ host });
    assert.equal(outcome.code, 1);
    assert.equal(head(), v1);
    assert.deepEqual(calls, []);
    assert.match(outcome.summary, /install is incomplete .* run scripts\/setup\/vps\.sh/);
  });

  it('takes the snapshot before any step it cannot undo', () => {
    buildReleases({ 'src/db/migrations/999_new.sql': 'CREATE TABLE t (x);' });
    const order = [];
    const { host } = fakeHost({ snapshot: () => { order.push('snapshot'); return { ok: true, path: '/snap' }; } });
    const exec = host.exec;
    host.exec = (cmd) => { order.push(cmd); return exec(cmd); };
    run({ host });
    assert.ok(order.indexOf('snapshot') < order.indexOf('npm run migrate'));
  });

  it('applies a new tmpfiles entry before the restart that needs it', () => {
    buildReleases({ 'config/tmpfiles.d/shellm.conf': 'd /run/shellm 0750 shellmer shellmer -' });
    const { host, calls } = fakeHost();
    run({ host });
    const tmpfiles = calls.findIndex((c) => c.startsWith('systemd-tmpfiles --create'));
    assert.ok(tmpfiles !== -1, 'the new entry was not applied');
    assert.ok(tmpfiles < calls.indexOf('systemctl restart shellm'));
  });

  it('says so when it could only check that the port answers', () => {
    buildReleases({ README: 'two' });
    const { host } = fakeHost({ verified: false });
    const outcome = run({ host });
    assert.equal(outcome.code, 0);
    assert.match(outcome.summary, /\(not verified: SHELLM_ADMIN_PASSWORD is unset\)$/);
  });
});
