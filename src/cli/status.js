'use strict';

const { readPid } = require('./pid');

async function run() {
  const daemonPid = readPid();
  const port = process.env.PORT || '6100';

  let health = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    health = await res.json();
  } catch {
    // Server not responding
  }

  if (!daemonPid && !health) {
    console.log('SheLLM is not running.');
    console.log('');
    console.log('Start with:  shellm start -d');
    console.log('Or systemd:  sudo systemctl start shellm');
    process.exit(1);
  }

  console.log('SheLLM is running.');
  if (daemonPid) {
    console.log(`  Mode:      daemon (PID ${daemonPid})`);
  } else {
    console.log('  Mode:      systemd (or external)');
  }

  if (health) {
    console.log(`  Uptime:    ${formatUptime(health.uptime_seconds)}`);
    console.log(`  Queue:     ${health.queue.active} active, ${health.queue.pending} pending`);
    console.log('  Providers:');
    for (const [name, info] of Object.entries(health.providers)) {
      const status = info.authenticated ? 'ok' : (info.installed ? 'not auth' : 'not installed');
      console.log(`    ${name}: ${status}`);
    }
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = { run };
