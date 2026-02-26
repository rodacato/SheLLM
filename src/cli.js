#!/usr/bin/env node
'use strict';

const commands = {
  start: './cli/start',
  stop: './cli/stop',
  restart: './cli/restart',
  status: './cli/status',
  logs: './cli/logs',
  version: './cli/version',
  help: './cli/help',
};

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'help' || command === '--help' || command === '-h') {
  require('./cli/help').run();
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  require('./cli/version').run();
  process.exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.error('Run "shellm help" for usage.');
  process.exit(1);
}

require(commands[command]).run(args.slice(1));
