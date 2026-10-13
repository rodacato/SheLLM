'use strict';

const pkg = require('../../package.json');

function run() {
  console.log(`
shellm v${pkg.version} — LLM CLI services as a REST API

Usage: shellm <command> [options]

Commands:
  init                                    Create the config file and a first API key
  start [-p|--port PORT]                  Start the server in the foreground (Ctrl+C to stop)
  status                                  Show whether the server answers
  doctor [--live]                         Check the setup; --live sends one request to Claude
  backup [--dir DIR] [--keep N]           Snapshot the database and config file
  config [--new]                          Show every setting and where its value came from
  update                                  Move to the newest published release
  version                                 Show version
  help                                    Show this help

Examples:
  shellm start              Start in the foreground (Ctrl+C to stop)
  shellm start -p 8080      Start on port 8080
  shellm status             Check if server is running

systemd (production):
  sudo systemctl start shellm
  sudo systemctl restart shellm
  sudo systemctl status shellm
  journalctl -u shellm -f

Backups:
  shellm backup             Snapshot to /var/lib/shellm/backups, keeping the last 7
  sudo systemctl enable --now shellm-backup.timer   Take one nightly
`.trim());
}

module.exports = { run };
