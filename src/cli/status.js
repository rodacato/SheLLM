'use strict';

const { readPid } = require('./pid');
const { CONFIG_FILE } = require('./paths');
const config = require('../config');

function baseUrl() {
  return `http://${config.get('HOST')}:${config.get('PORT')}`;
}

// What the running process says about itself: the build it serves and whether any provider can
// answer. `/health` is a constant and proves only that the port is open, so the updater asks this
// instead — authenticated with the admin credentials from the config file this command just read.
async function readServing() {
  const url = baseUrl();
  try {
    const live = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    if (!live.ok) return { reachable: false };
  } catch {
    return { reachable: false };
  }

  const password = config.get('SHELLM_ADMIN_PASSWORD');
  if (!password) return { reachable: true, verified: false };

  const user = config.get('SHELLM_ADMIN_USER') || 'admin';
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  try {
    const res = await fetch(`${url}/admin/health`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { reachable: true, verified: false, error: `/admin/health answered ${res.status}` };
    const health = await res.json();
    return {
      reachable: true,
      verified: true,
      status: health.status ?? null,
      commit: health.build?.commit ?? null,
      version: health.build?.version ?? null,
    };
  } catch (err) {
    return { reachable: true, verified: false, error: err.message };
  }
}

async function run(args = []) {
  require('dotenv').config({ path: CONFIG_FILE, quiet: true });

  if (args.includes('--json')) {
    console.log(JSON.stringify(await readServing()));
    return;
  }

  const daemonPid = readPid();
  const url = baseUrl();

  let healthy = false;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    healthy = res.ok;
  } catch {
    healthy = false;
  }

  if (!healthy) {
    console.log(`SheLLM is not responding on ${url}.`);
    if (daemonPid) console.log(`  A daemon PID file exists (PID ${daemonPid}) but the server does not answer.`);
    console.log('');
    console.log('Start with:  shellm start -d');
    console.log('Or systemd:  sudo systemctl start shellm');
    console.log('Diagnose:    shellm doctor');
    process.exit(1);
  }

  console.log(`SheLLM is running on ${url}.`);
  console.log(daemonPid ? `  Mode: daemon (PID ${daemonPid})` : '  Mode: systemd (or external)');
}

module.exports = { run, readServing };
