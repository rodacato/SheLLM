'use strict';

const { execSync, execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT, CLI_SCRIPT, BACKUP_DIR } = require('./paths');
const config = require('../config');

const SERVICE_USER = 'shellmer';

// Everything this repository installs outside the checkout. `scripts/setup/vps.sh` puts the same
// set in place on a first provision, and an update has to keep them in step: a host that upgrades
// the documented way would otherwise get the code for a feature without the wiring that makes it
// work. The symptom of that is a button that does nothing — which is also what "installed but not
// enabled" looks like, so the two would be indistinguishable. Enabling stays the operator's call;
// only the files are synced here.
const SYSTEM_FILES = [
  { src: 'shellm.service', dest: '/etc/systemd/system/shellm.service' },
  { src: 'config/systemd/shellm-update.service', dest: '/etc/systemd/system/shellm-update.service' },
  { src: 'config/systemd/shellm-update.path', dest: '/etc/systemd/system/shellm-update.path' },
  { src: 'config/systemd/shellm-backup.service', dest: '/etc/systemd/system/shellm-backup.service' },
  { src: 'config/systemd/shellm-backup.timer', dest: '/etc/systemd/system/shellm-backup.timer' },
  { src: 'config/tmpfiles.d/shellm.conf', dest: '/etc/tmpfiles.d/shellm.conf' },
  { src: 'config/logrotate.conf', dest: '/etc/logrotate.d/shellm' },
  { src: 'scripts/setup/shellm-update-runner.sh', dest: '/usr/local/lib/shellm/shellm-update-runner.sh', mode: '0755' },
];

// The three shapes SHELLM_REF is allowed to take, and nothing else. A release tag is what the
// dashboard asks for, a commit id is what the root update runner hands over once it has resolved
// that tag against the remote, and a branch is the deliberate SSH deploy the deployment guide
// documents. A branch name is restricted further than git would allow: no `..`, nothing outside
// letters, digits, `.`, `_`, `-` and a path separator, and never a leading `-`.
const REF_FORMS = [
  /^v\d+\.\d+\.\d+$/,
  /^[0-9a-f]{40}$/,
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
];
const REF_MAX_LENGTH = 128;

function isSupportedRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > REF_MAX_LENGTH) return false;
  if (ref.includes('..')) return false;
  return REF_FORMS.some((form) => form.test(ref));
}

// How long a restarted service gets to answer with the build it was asked to run. Provider checks
// spawn the CLIs, so the first authenticated read can take several seconds.
const GATE_ATTEMPTS = 20;
const GATE_INTERVAL_MS = 1500;

// Every step that leaves this process. Tests replace the ones that need a host — npm, systemd,
// sudo, the running service — and keep git real.
function systemHost() {
  return {
    git, exec, execAsRoot,
    serving,
    snapshot,
    sleep: (ms) => execSync(`sleep ${ms / 1000}`),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    exit: (code) => process.exit(code),
  };
}

// The last line of every run. The root runner copies it into the status the dashboard shows, so
// what the button reports is what happened rather than a sentence written in advance.
function run(options = {}) {
  const host = { ...systemHost(), ...options.host };
  const outcome = update(host);
  (outcome.code ? host.error : host.log)(`\nRESULT: ${outcome.summary}`);
  if (outcome.code) host.exit(outcome.code);
  return outcome;
}

function update(host) {
  const startTime = Date.now();

  // Before anything else runs. SHELLM_REF is the only input this command takes from outside, and
  // the root update runner fills it from a file under /run — so a ref that is not shaped like one
  // has to cost a message, not a git invocation.
  const requested = requestedRef(host);
  if (requested === false) return { code: 1, summary: 'SHELLM_REF is not a release tag, a commit id or a branch name' };

  host.log('shellm update — pulling latest and restarting service\n');

  const prevCommit = host.git('rev-parse', 'HEAD').trim();
  host.log(`  current: ${prevCommit.slice(0, 8)}`);

  step(host, 'Fetching releases');
  host.git('fetch', '--tags', '--force', '--prune', 'origin');
  const ref = resolveRef(host, requested);
  const target = resolveCommit(host, ref);
  if (!target) return { code: 1, summary: `${ref} is not a ref this checkout knows about after fetching` };

  // The checkout being at the target says nothing about what the service runs: a run that moved
  // the checkout and then failed leaves exactly this, with the old process still serving.
  if (target === prevCommit) {
    step(host, 'Checking what the service runs');
    const now = gate(host, target, 1);
    if (now.ok) return { code: 0, summary: `already running ${ref}${now.note}` };
    host.log(`  the checkout is at ${ref}, the service is not (${now.seen}) — restarting it`);
    host.execAsRoot('systemctl restart shellm');
    const after = gate(host, target);
    if (after.ok) return { code: 0, summary: `restarted onto ${ref}, which the checkout already held${after.note}` };
    return { code: 1, summary: `the checkout is at ${ref} and the restarted service is not healthy on it (${after.seen}) — run scripts/setup/vps.sh to reinstall` };
  }

  // Migrations only go forward, so this snapshot is what makes a failed update recoverable. Here
  // nothing has moved yet, so a failure costs nothing.
  step(host, 'Snapshotting the database');
  const snap = host.snapshot();
  if (!snap.ok) return { code: 1, summary: snap.summary };

  const applied = { deps: false, migrations: false, systemFiles: [] };
  let current = 'checkout';
  try {
    host.log(`  checking out ${ref}`);
    host.git('checkout', '--detach', target);
    host.log(`  updated: ${prevCommit.slice(0, 8)} → ${target.slice(0, 8)}`);

    const touched = changedFiles(host, prevCommit, target);

    current = 'npm ci';
    step(host, 'Checking dependencies');
    if (touched.has('package-lock.json')) {
      host.log('  package-lock.json changed — installing deps...');
      // Set before running: npm ci deletes node_modules first, so a failure halfway still needs
      // the previous release's dependencies put back.
      applied.deps = true;
      host.exec('npm ci --omit=dev');
      host.log('  done');
    } else {
      host.log('  no dependency changes — skipping npm ci');
    }

    current = 'migrations';
    step(host, 'Running migrations');
    applied.migrations = [...touched].some((f) => f.startsWith('src/db/migrations/'));
    host.exec('npm run migrate');
    host.log('  done');

    step(host, 'Rebuilding API docs');
    try {
      host.exec('npm run docs:build 2>/dev/null');
      host.log('  done');
    } catch {
      host.log('  skipped (redocly not available)');
    }

    current = 'system files';
    step(host, 'Checking installed system files');
    applied.systemFiles = installSystemFiles(host, touched);

    current = 'restart';
    step(host, 'Restarting service');
    host.execAsRoot('systemctl restart shellm');
    host.log('  done');

    current = 'health check';
    step(host, 'Health check');
    const health = gate(host, target);
    if (!health.ok) throw new Error(health.seen);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    host.log(`  healthy ✓ — serving ${target.slice(0, 8)}`);
    host.log(`\nUpdate complete in ${elapsed}s`);
    return { code: 0, summary: `running ${ref}${health.note}` };
  } catch (err) {
    const reason = String(err.stderr || err.message || err).trim().split('\n').pop();
    host.error(`  FAILED at ${current} — ${reason}`);
    return rollback(host, { ref, prevCommit, applied, snapshot: snap.path, step: current, reason });
  }
}

// Every failure after the checkout lands here, not only a failed health check. It ends with a
// service that runs the previous release, or with the command that gets one.
function rollback(host, { ref, prevCommit, applied, snapshot: snapPath, step: failedAt, reason }) {
  const prev = prevCommit.slice(0, 8);
  const failed = `update to ${ref} failed at ${failedAt} (${reason})`;
  host.error(`\nRolling back to ${prev}...`);
  try {
    host.git('checkout', '--detach', prevCommit);
    if (applied.deps) {
      host.error('  restoring the previous release\'s dependencies');
      host.exec('npm ci --omit=dev');
    }
    if (applied.systemFiles.length) {
      installSystemFiles(host, new Set(applied.systemFiles.map((f) => f.src)));
    }
    host.execAsRoot('systemctl restart shellm');
  } catch (err) {
    const why = String(err.stderr || err.message || err).trim().split('\n').pop();
    return { code: 1, summary: `${failed}; the rollback to ${prev} failed too (${why}) — run scripts/setup/vps.sh to reinstall` };
  }

  const back = gate(host, prevCommit);
  if (!back.ok) {
    return { code: 1, summary: `${failed}; rolled back to ${prev}, which is not healthy either (${back.seen}) — run scripts/setup/vps.sh` };
  }
  // ADR-0004 keeps restoring a snapshot a documented human step, so this says so instead of doing it.
  const schema = applied.migrations
    ? ` The schema was migrated and not reverted: restore ${snapPath} as docs/guides/deployment.md "Restoring" describes.`
    : '';
  return { code: 1, summary: `${failed}; rolled back to ${prev}, which is serving.${schema}` };
}

// Healthy means the running process serves `commit` and at least one provider can answer. A port
// that answers proves only that node started.
function gate(host, commit, attempts = GATE_ATTEMPTS) {
  let seen = 'no answer';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) host.sleep(GATE_INTERVAL_MS);
    const s = host.serving();
    if (!s || !s.reachable) { seen = 'the service does not answer'; continue; }
    if (!s.verified) {
      // Without admin credentials there is nothing to ask but the port; say so rather than claim more.
      return { ok: true, seen: 'answering', note: ` (not verified: ${s.error || 'SHELLM_ADMIN_PASSWORD is unset'})` };
    }
    const sameBuild = !!s.commit && commit.startsWith(s.commit);
    if (sameBuild && s.status !== 'down') return { ok: true, seen: `serving ${s.commit}`, note: '' };
    seen = sameBuild ? `serving ${s.commit} with every provider down` : `serving ${s.commit || 'an unknown commit'}, not ${commit.slice(0, 8)}`;
  }
  return { ok: false, seen, note: '' };
}

function serving() {
  try {
    return JSON.parse(exec(`node ${CLI_SCRIPT} status --json`).trim().split('\n').pop());
  } catch {
    return null;
  }
}

function changedFiles(host, from, to) {
  return new Set(host.git('diff', from, to, '--name-only').split('\n').map((l) => l.trim()).filter(Boolean));
}

function installSystemFiles(host, touched) {
  const changed = SYSTEM_FILES.filter((f) => touched.has(f.src) && existsSync(path.join(PROJECT_ROOT, f.src)));
  if (!changed.length) {
    host.log('  no changes');
    return [];
  }
  for (const file of changed) {
    host.log(`  ${file.src} changed — installing`);
    host.execAsRoot(`install -D -m ${file.mode || '0644'} -o root -g root ${path.join(PROJECT_ROOT, file.src)} ${file.dest}`);
  }
  if (changed.some((f) => f.dest.startsWith('/etc/systemd/'))) host.execAsRoot('systemctl daemon-reload');
  // A new tmpfiles entry has to be applied now, not at the next boot. The restart then rebuilds
  // the service's mount namespace, which is the only way it gains write access to it.
  for (const file of changed.filter((f) => f.dest.startsWith('/etc/tmpfiles.d/'))) {
    host.execAsRoot(`systemd-tmpfiles --create ${file.dest}`);
  }
  host.log('  done');
  return changed;
}

// The host follows published releases; SHELLM_REF deploys a specific one, a commit id, or a branch.
// false means a value was given and refused.
function requestedRef(host) {
  const ref = config.get('SHELLM_REF');
  if (!ref) return null;
  if (!isSupportedRef(ref)) {
    host.error(`SHELLM_REF is not a release tag (v1.2.3), a commit id or a branch name: ${JSON.stringify(ref)}`);
    return false;
  }
  return ref;
}

function resolveRef(host, requested) {
  if (requested) return requested;
  const latest = host.git('tag', '-l', 'v*', '--sort=-v:refname').split('\n')[0].trim();
  if (latest) return latest;
  return host.git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim().replace(/^origin\//, '');
}

// Run after the fetch, so a release published since the last update resolves. `--verify` is what
// makes an unknown name an error rather than itself: without it `git rev-parse` echoes the string
// back, and the checkout is where that would be discovered.
function resolveCommit(host, ref) {
  try {
    return host.git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim();
  } catch {
    host.error(`  FAILED — ${ref} is not a ref this checkout knows about after fetching`);
    return null;
  }
}

// Through exec(), so it runs as the service user: `shellm backup` refuses to run as root, which
// would leave root-owned -wal and -shm files the service can no longer write.
function snapshot() {
  // /var/lib belongs to root, so the service user cannot make this itself. A failure here is not
  // fatal on its own — the command below says exactly what to run.
  if (!existsSync(BACKUP_DIR)) {
    try {
      execAsRoot(`install -d -m 0750 -o ${SERVICE_USER} -g ${SERVICE_USER} ${BACKUP_DIR}`);
    } catch { /* reported by the snapshot itself */ }
  }

  try {
    const out = exec(`node ${CLI_SCRIPT} backup`).trim();
    for (const line of out.split('\n')) console.log(`  ${line.trim()}`);
    return { ok: true, path: /Snapshot: (\S+)/.exec(out)?.[1] ?? BACKUP_DIR };
  } catch (err) {
    const why = String(err.stderr || err.message).trim();
    console.error(`  FAILED — ${why}`);
    console.error('\nRefusing to update without a snapshot: migrations do not roll back.');
    return { ok: false, summary: snapshotFailure(why) };
  }
}

// A host whose last update died in npm ci has no node_modules, so the snapshot cannot load
// better-sqlite3 and the update that would fix it refuses to start. The guard stays; the message
// names the way out.
function snapshotFailure(why) {
  if (/Cannot find module/.test(why)) {
    return 'the snapshot cannot run because the install is incomplete (a dependency is missing) — run scripts/setup/vps.sh to reinstall; the update refuses to go on without a snapshot';
  }
  return `refused to update without a snapshot: ${why.split('\n').pop()}`;
}

// Every git command the update runs, as an argument vector rather than a command string: a ref
// reaches git as one argument and no shell ever sees it. Same privilege drop as exec() below.
function git(...args) {
  const isRoot = process.getuid() === 0;
  const [file, argv] = isRoot
    ? ['sudo', ['-u', SERVICE_USER, '-H', 'git', '-C', PROJECT_ROOT, ...args]]
    : ['git', args];
  return execFileSync(file, argv, {
    cwd: isRoot ? undefined : PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function exec(cmd) {
  // Run as shellmer if we're root (git safe.directory issue). -H because sudo otherwise leaves
  // HOME pointing at root's, and npm and the CLI both resolve their state from it.
  const isRoot = process.getuid() === 0;
  const fullCmd = isRoot ? `sudo -u ${SERVICE_USER} -H bash -c 'cd ${PROJECT_ROOT} && ${cmd}'` : cmd;
  return execSync(fullCmd, { cwd: isRoot ? undefined : PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function execAsRoot(cmd) {
  if (process.getuid() === 0) {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });
}

function step(host, label) {
  host.log(`\n==> ${label}...`);
}

// SYSTEM_FILES is exported so a test can hold it against what vps.sh installs. The two drifting
// apart is silent on the host that finds out.
module.exports = { run, SYSTEM_FILES, isSupportedRef, snapshotFailure };
