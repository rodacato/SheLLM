'use strict';

// The pruner is what makes "everything there is" a bounded window, so the dashboard reads
// its span from here instead of naming 30 days again.
const RETENTION_DAYS = 30;

const LOG_FIELDS = [
  'request_id', 'client_name', 'provider', 'model', 'status', 'duration_ms', 'queued_ms',
  'tokens', 'cost_usd', 'tokens_in', 'tokens_out', 'cache_write_tokens', 'cache_read_tokens',
  'ttft_ms', 'api_ms', 'upstream_model', 'streamed', 'api_error_status',
  'method', 'path', 'error_code', 'client_id',
];

function insertRequestLog(entry) {
  const { getDb } = require('./index');
  const db = getDb();
  const values = Object.fromEntries(LOG_FIELDS.map((f) => [f, entry[f] ?? null]));
  db.prepare(`
    INSERT INTO request_logs (${LOG_FIELDS.join(', ')})
    VALUES (${LOG_FIELDS.map((f) => '@' + f).join(', ')})
  `).run(values);
}

function pruneOldLogs(days = RETENTION_DAYS) {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return;
  db.prepare('DELETE FROM request_logs WHERE created_at < datetime(\'now\', ?)').run(`-${days} days`);
}

function pruneExpiredKeys() {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return;
  db.prepare("UPDATE clients SET active = 0 WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND active = 1").run();
}

module.exports = { insertRequestLog, pruneOldLogs, pruneExpiredKeys, LOG_FIELDS, RETENTION_DAYS };
