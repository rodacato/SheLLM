'use strict';

const { parseArgs } = require('node:util');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { SHELLM_DIR, LOG_DIR, LOG_FILE, PROJECT_ROOT, SERVER_SCRIPT } = require('./paths');
const { readPid, writePid } = require('./pid');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      daemon: { type: 'boolean', short: 'd', default: false },
      port: { type: 'string', short: 'p' },
    },
    strict: false,
  });

  const existingPid = readPid();
  if (existingPid) {
    console.log(`SheLLM is already running (PID ${existingPid}).`);
    console.log('Use "shellm restart" to restart or "shellm stop" to stop.');
    process.exit(1);
  }

  if (values.daemon) {
    startDaemon(values);
  } else {
    startForeground(values);
  }
}

function startForeground(values) {
  if (values.port) {
    process.env.PORT = values.port;
  }

  require('dotenv').config({ path: path.resolve(PROJECT_ROOT, '.env'), quiet: true });

  const port = process.env.PORT || '6000';
  console.log(`SheLLM starting on http://127.0.0.1:${port} (Ctrl+C to stop)`);

  require(SERVER_SCRIPT);
}

function startDaemon(values) {
  ensureDir(SHELLM_DIR);
  ensureDir(LOG_DIR);

  const logFd = fs.openSync(LOG_FILE, 'a');

  const env = { ...process.env };
  if (values.port) {
    env.PORT = values.port;
  }

  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
    cwd: PROJECT_ROOT,
  });

  writePid(child.pid);
  child.unref();
  fs.closeSync(logFd);

  console.log(`SheLLM started in daemon mode (PID ${child.pid}).`);
  console.log(`Logs: ${LOG_FILE}`);
}

module.exports = { run };
