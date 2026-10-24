'use strict';

const config = require('../config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const startupLevel = LEVELS[config.get('LOG_LEVEL')] ?? LEVELS.info;

// Warn if debug logging is enabled in production (may expose sensitive data)
if (config.get('NODE_ENV') === 'production' && startupLevel === LEVELS.debug) {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'warn',
    event: 'debug_log_level_production',
    message: 'LOG_LEVEL=debug in production may expose sensitive data in logs',
  }) + '\n');
}

function getCurrentLevel() {
  return startupLevel;
}

// JSON.stringify drops an Error's own fields, so a thrown error would reach the log as `{}`.
function serializeError(err) {
  if (!(err instanceof Error)) {
    return { type: err?.constructor?.name ?? typeof err, message: err?.message ?? String(err), stack: null };
  }
  return { type: err.name, message: err.message, stack: err.stack ?? null };
}

function log(level, data) {
  if (LEVELS[level] < getCurrentLevel()) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    ...data,
  };
  if (data.err !== undefined) entry.err = serializeError(data.err);

  const line = JSON.stringify(entry);
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

}

module.exports = {
  debug: (data) => log('debug', data),
  info: (data) => log('info', data),
  warn: (data) => log('warn', data),
  error: (data) => log('error', data),
};
