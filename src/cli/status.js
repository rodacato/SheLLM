'use strict';

const { readPid } = require('./pid');
const { CONFIG_FILE } = require('./paths');
const config = require('../config');

async function run() {
  require('dotenv').config({ path: CONFIG_FILE, quiet: true });
  const daemonPid = readPid();
  const host = config.get('HOST');
  const port = config.get('PORT');
  const url = `http://${host}:${port}`;

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

module.exports = { run };
