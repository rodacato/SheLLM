'use strict';

const { execSync, execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT, CLI_SCRIPT, BACKUP_DIR } = require('./paths');
const config = require('../config');

const HEALTH_URL = 'http://127.0.0.1:6100/health';
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

function run() {
  const startTime = Date.now();

  // Before anything else runs. SHELLM_REF is the only input this command takes from outside, and
  // the root update runner fills it from a file under /run — so a ref that is not shaped like one
  // has to cost a message, not a git invocation.
  const requested = requestedRef();

  console.log('shellm update — pulling latest and restarting service\n');

  // Save current commit for rollback
  const prevCommit = git('rev-parse', 'HEAD').trim();
  console.log(`  current: ${prevCommit.slice(0, 8)}`);

  // 1. Move to the release being deployed
  step('Fetching releases');
  git('fetch', '--tags', '--force', '--prune', 'origin');
  const ref = resolveRef(requested);
  const target = resolveCommit(ref);

  if (target === prevCommit) {
    console.log(`  Already on ${ref} — nothing to do.`);
    return;
  }

  // 2. Snapshot. Migrations only go forward, so the rollback at the end restores code and not
  // data; this is what makes it a rollback. Here nothing has moved yet, so a failure costs nothing.
  step('Snapshotting the database');
  snapshot();

  console.log(`  checking out ${ref}`);
  git('checkout', '--detach', target);
  const newCommit = target;
  console.log(`  updated: ${prevCommit.slice(0, 8)} → ${newCommit.slice(0, 8)}`);

  // 3. npm ci only if lockfile changed
  step('Checking dependencies');
  const lockChanged = git('diff', prevCommit, newCommit, '--name-only').includes('package-lock.json');
  if (lockChanged) {
    console.log('  package-lock.json changed — installing deps...');
    exec('npm ci --omit=dev');
    console.log('  done');
  } else {
    console.log('  no dependency changes — skipping npm ci');
  }

  // 4. Run migrations
  step('Running migrations');
  exec('npm run migrate');
  console.log('  done');

  // 5. Rebuild API docs if possible
  step('Rebuilding API docs');
  try {
    exec('npm run docs:build 2>/dev/null');
    console.log('  done');
  } catch {
    console.log('  skipped (redocly not available)');
  }

  // 6. Re-install any system file this release changed
  step('Checking installed system files');
  const touched = new Set(git('diff', prevCommit, newCommit, '--name-only').split('\n').map((l) => l.trim()));
  const changed = SYSTEM_FILES.filter((f) => touched.has(f.src) && existsSync(path.join(PROJECT_ROOT, f.src)));
  if (changed.length) {
    for (const file of changed) {
      console.log(`  ${file.src} changed — installing`);
      execAsRoot(`install -D -m ${file.mode || '0644'} -o root -g root ${path.join(PROJECT_ROOT, file.src)} ${file.dest}`);
    }
    if (changed.some((f) => f.dest.startsWith('/etc/systemd/'))) execAsRoot('systemctl daemon-reload');
    // A new tmpfiles entry has to be applied now, not at the next boot. The restart in step 7
    // then rebuilds the service's mount namespace, which is the only way it gains write access
    // to a runtime directory that did not exist when it started.
    for (const file of changed.filter((f) => f.dest.startsWith('/etc/tmpfiles.d/'))) {
      execAsRoot(`systemd-tmpfiles --create ${file.dest}`);
    }
    console.log('  done');
  } else {
    console.log('  no changes');
  }

  // 7. Restart service
  step('Restarting service');
  execAsRoot('systemctl restart shellm');
  console.log('  done');

  // 8. Health check
  step('Health check');
  let healthy = false;
  for (let i = 0; i < 5; i++) {
    execSync('sleep 1');
    try {
      const res = exec(`curl -sf ${HEALTH_URL}`);
      if (res.includes('ok') || res.includes('healthy') || res.includes('degraded')) {
        healthy = true;
        break;
      }
    } catch { /* retry */ }
  }

  if (healthy) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('  healthy ✓');
    console.log(`\nUpdate complete in ${elapsed}s`);
  } else {
    console.error('  FAILED — service is not healthy');
    console.error(`\nRolling back to ${prevCommit.slice(0, 8)}...`);
    git('checkout', prevCommit);
    execAsRoot('systemctl restart shellm');
    console.error('Rollback complete. Check logs: journalctl -u shellm -n 50');
    process.exit(1);
  }
}

// The host follows published releases; SHELLM_REF deploys a specific one, a commit id, or a branch.
function requestedRef() {
  const ref = config.get('SHELLM_REF');
  if (!ref) return null;
  if (!isSupportedRef(ref)) {
    console.error(`SHELLM_REF is not a release tag (v1.2.3), a commit id or a branch name: ${JSON.stringify(ref)}`);
    process.exit(1);
  }
  return ref;
}

function resolveRef(requested) {
  if (requested) return requested;
  const latest = git('tag', '-l', 'v*', '--sort=-v:refname').split('\n')[0].trim();
  if (latest) return latest;
  return git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim().replace(/^origin\//, '');
}

// Run after the fetch, so a release published since the last update resolves. `--verify` is what
// makes an unknown name an error rather than itself: without it `git rev-parse` echoes the string
// back, and the checkout is where that would be discovered.
function resolveCommit(ref) {
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim();
  } catch {
    console.error(`  FAILED — ${ref} is not a ref this checkout knows about after fetching`);
    return process.exit(1);
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
    for (const line of exec(`node ${CLI_SCRIPT} backup`).trim().split('\n')) console.log(`  ${line.trim()}`);
  } catch (err) {
    console.error(`  FAILED — ${String(err.stderr || err.message).trim()}`);
    console.error('\nRefusing to update without a snapshot: migrations do not roll back.');
    process.exit(1);
  }
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

function step(label) {
  console.log(`\n==> ${label}...`);
}

// SYSTEM_FILES is exported so a test can hold it against what vps.sh installs. The two drifting
// apart is silent on the host that finds out.
module.exports = { run, SYSTEM_FILES, isSupportedRef };
