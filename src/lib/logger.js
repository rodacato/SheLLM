'use strict';

const { emitLog } = require('./log-emitter');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

// Warn if debug logging is enabled in production (may expose sensitive data)
if (process.env.NODE_ENV === 'production' && currentLevel === LEVELS.debug) {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'warn',
    event: 'debug_log_level_production',
    message: 'LOG_LEVEL=debug in production may expose sensitive data in logs',
  }) + '\n');
}

function log(level, data) {
  if (LEVELS[level] < currentLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    ...data,
  };

  const line = JSON.stringify(entry);
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

  emitLog(entry);
}

module.exports = {
  debug: (data) => log('debug', data),
  info: (data) => log('info', data),
  warn: (data) => log('warn', data),
  error: (data) => log('error', data),
};
