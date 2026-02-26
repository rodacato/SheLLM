'use strict';

const fs = require('node:fs');
const { PID_FILE } = require('./paths');
const { readPid, removePid } = require('./pid');

function run(args) {
  const pid = readPid();

  if (pid) {
    console.log(`Stopping SheLLM (PID ${pid})...`);
    process.kill(pid, 'SIGTERM');

    const deadline = Date.now() + 10000;
    const check = setInterval(() => {
      let alive;
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }

      if (!alive) {
        clearInterval(check);
        removePid();
        console.log('Stopped.');
        startDaemon(args);
      } else if (Date.now() > deadline) {
        clearInterval(check);
        console.error('Failed to stop within 10s. Aborting restart.');
        process.exit(1);
      }
    }, 200);
  } else {
    startDaemon(args);
  }
}

function startDaemon(args) {
  const hasDaemonFlag = args.includes('-d') || args.includes('--daemon');
  if (!hasDaemonFlag) {
    args = ['-d', ...args];
  }
  require('./start').run(args);
}

module.exports = { run };
