'use strict';

const { parseArgs } = require('node:util');
const { SERVER_SCRIPT } = require('./paths');

// Foreground only. On a server systemd owns the process (start, stop, restart, journald); locally
// Ctrl+C stops it. A second, PID-file process manager here only drifted from the first.
function run(args) {
  const { values } = parseArgs({
    args,
    options: { port: { type: 'string', short: 'p' } },
    strict: false,
  });

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

module.exports = { run };
