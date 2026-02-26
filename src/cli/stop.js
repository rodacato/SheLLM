'use strict';

const { readPid, removePid } = require('./pid');

function run() {
  const pid = readPid();

  if (!pid) {
    console.log('SheLLM is not running as a daemon.');
    console.log('If using systemd: sudo systemctl stop shellm');
    process.exit(1);
  }

  console.log(`Stopping SheLLM (PID ${pid})...`);
  process.kill(pid, 'SIGTERM');

  const deadline = Date.now() + 10000;
  const check = setInterval(() => {
    let alive;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }

    if (!alive) {
      clearInterval(check);
      removePid();
      console.log('SheLLM stopped.');
      process.exit(0);
    }

    if (Date.now() > deadline) {
      clearInterval(check);
      console.warn('Process did not exit after 10s. Sending SIGKILL...');
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      removePid();
      console.log('SheLLM force-killed.');
      process.exit(1);
    }
  }, 200);
}

module.exports = { run };
