'use strict';

const { parseArgs } = require('node:util');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
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

  const { startServer, gracefulShutdown } = require(SERVER_SCRIPT);

  const server = startServer({}, (listening) => {
    const { address, port } = listening.address();
    console.log(`SheLLM running on http://${address}:${port} (Ctrl+C to stop)`);
  });

  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
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
