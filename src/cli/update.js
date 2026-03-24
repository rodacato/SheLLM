'use strict';

const { execSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT } = require('./paths');

const SERVICE_FILE = path.join(PROJECT_ROOT, 'shellm.service');
const SYSTEM_SERVICE = '/etc/systemd/system/shellm.service';
const HEALTH_URL = 'http://127.0.0.1:6100/health';

function run() {
  const startTime = Date.now();
  console.log('shellm update — pulling latest and restarting service\n');

  // Save current commit for rollback
  const prevCommit = exec('git rev-parse HEAD').trim();
  console.log(`  current: ${prevCommit.slice(0, 8)}`);

  // 1. Git pull
  step('Pulling latest code');
  const pullOutput = exec('git pull --ff-only');
  if (pullOutput.includes('Already up to date')) {
    console.log('  Already up to date — nothing to do.');
    return;
  }
  const newCommit = exec('git rev-parse HEAD').trim();
  console.log(`  updated: ${prevCommit.slice(0, 8)} → ${newCommit.slice(0, 8)}`);

  // 2. npm ci only if lockfile changed
  step('Checking dependencies');
  const lockChanged = exec(`git diff ${prevCommit} ${newCommit} --name-only`).includes('package-lock.json');
  if (lockChanged) {
    console.log('  package-lock.json changed — installing deps...');
    exec('npm ci --omit=dev');
    console.log('  done');
  } else {
    console.log('  no dependency changes — skipping npm ci');
  }

  // 3. Run migrations
  step('Running migrations');
  exec('node -e "require(\'./src/db\').initDb(); require(\'./src/db\').closeDb();"');
  console.log('  done');

  // 4. Rebuild API docs if possible
  step('Rebuilding API docs');
  try {
    exec('npm run docs:build 2>/dev/null');
    console.log('  done');
  } catch {
    console.log('  skipped (redocly not available)');
  }

  // 5. Update systemd service if changed
  step('Checking systemd service');
  const serviceChanged = exec(`git diff ${prevCommit} ${newCommit} --name-only`).includes('shellm.service');
  if (serviceChanged && existsSync(SERVICE_FILE)) {
    console.log('  shellm.service changed — updating...');
    execAsRoot(`cp ${SERVICE_FILE} ${SYSTEM_SERVICE}`);
    execAsRoot('systemctl daemon-reload');
    console.log('  done');
  } else {
    console.log('  no changes');
  }

  // 6. Restart service
  step('Restarting service');
  execAsRoot('systemctl restart shellm');
  console.log('  done');

  // 7. Health check
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
    console.log(`  healthy ✓`);
    console.log(`\nUpdate complete in ${elapsed}s`);
  } else {
    console.error('  FAILED — service is not healthy');
    console.error(`\nRolling back to ${prevCommit.slice(0, 8)}...`);
    exec(`git checkout ${prevCommit}`);
    execAsRoot('systemctl restart shellm');
    console.error('Rollback complete. Check logs: journalctl -u shellm -n 50');
    process.exit(1);
  }
}

function exec(cmd) {
  return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function execAsRoot(cmd) {
  // If already root, run directly; otherwise use sudo
  if (process.getuid() === 0) {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });
}

function step(label) {
  console.log(`\n==> ${label}...`);
}

module.exports = { run };
