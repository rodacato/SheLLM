'use strict';

const { monthStartUtc, toSqliteDatetime } = require('../lib/time');

// The pruner is what makes "everything there is" a bounded window, so the dashboard reads
// its span from here. 31 so a key's monthly spend never loses the first day of a long month.
const RETENTION_DAYS = 31;

const LOG_FIELDS = [
  'request_id', 'client_name', 'provider', 'model', 'status', 'duration_ms', 'queued_ms',
  'tokens', 'cost_usd', 'cost_estimate_usd', 'tokens_in', 'tokens_out', 'cache_write_tokens', 'cache_read_tokens',
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

// Reported and estimated cost together: ADR-0012 writes an estimate only where none was reported.
function spentThisMonth(clientId, now = new Date()) {
  const { getDb } = require('./index');
  const since = toSqliteDatetime(monthStartUtc(now));
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(COALESCE(cost_usd, cost_estimate_usd)), 0) AS spent
    FROM request_logs
    WHERE client_id = ? AND created_at >= ?
  `).get(clientId, since);
  return row.spent;
}

function pruneExpiredKeys() {
  const { getDb } = require('./index');
  const db = getDb();
  if (!db) return;
  db.prepare("UPDATE clients SET active = 0 WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now') AND active = 1").run();
}

module.exports = { insertRequestLog, pruneOldLogs, pruneExpiredKeys, spentThisMonth, LOG_FIELDS, RETENTION_DAYS };
