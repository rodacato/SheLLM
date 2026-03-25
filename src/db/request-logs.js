'use strict';

function insertRequestLog({ request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd }) {
  const { getDb } = require('./index');
  const db = getDb();
  db.prepare(`
    INSERT INTO request_logs (request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(request_id ?? null, client_name ?? null, provider ?? null, model ?? null, status ?? null, duration_ms ?? null, queued_ms ?? null, tokens ?? null, cost_usd ?? null);
}

function pruneOldLogs(days = 30) {
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

module.exports = { insertRequestLog, pruneOldLogs, pruneExpiredKeys };
