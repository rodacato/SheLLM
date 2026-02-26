'use strict';

const { parseArgs } = require('node:util');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { LOG_FILE } = require('./paths');

function run(args) {
  const { values } = parseArgs({
    args,
    options: {
      follow: { type: 'boolean', short: 'f', default: false },
      lines: { type: 'string', short: 'n', default: '50' },
    },
    strict: false,
  });

  if (fs.existsSync(LOG_FILE)) {
    const tailArgs = ['-n', values.lines];
    if (values.follow) tailArgs.push('-f');
    tailArgs.push(LOG_FILE);

    const tail = spawn('tail', tailArgs, { stdio: 'inherit' });
    tail.on('close', (code) => process.exit(code || 0));
  } else {
    console.log('No daemon log file found.');
    console.log('');
    console.log('If running via systemd:');
    console.log('  journalctl -u shellm -f');
    console.log('');
    console.log('If running in foreground (shellm start), logs go to stdout.');
  }
}

module.exports = { run };
