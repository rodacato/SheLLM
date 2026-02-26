'use strict';

const pkg = require('../../package.json');

function run() {
  console.log(`
shellm v${pkg.version} — LLM CLI services as a REST API

Usage: shellm <command> [options]

Commands:
  start [-d|--daemon] [-p|--port PORT]   Start the server
  stop                                    Stop the daemon
  restart                                 Restart the daemon
  status                                  Show server status and health
  logs [-f|--follow] [-n|--lines N]       View daemon logs
  version                                 Show version
  help                                    Show this help

Examples:
  shellm start              Start in foreground (Ctrl+C to stop)
  shellm start -d           Start as background daemon
  shellm start -d -p 8080   Start daemon on port 8080
  shellm stop               Stop background daemon
  shellm status             Check if server is running
  shellm logs -f            Follow daemon log output

systemd (production):
  sudo systemctl start shellm
  sudo systemctl status shellm
  journalctl -u shellm -f
`.trim());
}

module.exports = { run };
