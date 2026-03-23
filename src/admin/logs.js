'use strict';

const { Router } = require('express');
const { getDb } = require('../db');
const { initSSE, sendSSEChunk } = require('../lib/sse');
const { emitter } = require('../lib/log-emitter');

const router = Router();

const LOG_COLUMNS = 'id, request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd, created_at';

function buildWhereClause(query) {
  const conditions = [];
  const params = [];

  if (query.provider) {
    conditions.push('provider = ?');
    params.push(query.provider);
  }
  if (query.client) {
    conditions.push('client_name = ?');
    params.push(query.client);
  }
  if (query.status) {
    const s = query.status;
    if (/^\d$/.test(s)) {
      const base = parseInt(s, 10) * 100;
      conditions.push('status >= ? AND status < ?');
      params.push(base, base + 100);
    } else if (/^\d{3}$/.test(s)) {
      conditions.push('status = ?');
      params.push(parseInt(s, 10));
    }
  }
  if (query.from) {
    conditions.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('created_at <= ?');
    params.push(query.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}

function csvEscape(value) {
  if (value == null) return '';
  let str = String(value);
  // Prevent formula injection
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  // Quote if contains comma, quote, or newline
  if (/[",\n\r]/.test(str)) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

router.get('/logs/export', (req, res) => {
  const db = getDb();
  const { where, params } = buildWhereClause(req.query);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="shellm-logs-${timestamp}.csv"`);

  const header = LOG_COLUMNS.replace(/ /g, '');
  res.write(header + '\n');

  if (!db) return res.end();

  const rows = db.prepare(
    `SELECT ${LOG_COLUMNS} FROM request_logs ${where} ORDER BY id DESC`
  ).all(...params);

  const fields = header.split(',');
  for (const row of rows) {
    res.write(fields.map((f) => csvEscape(row[f])).join(',') + '\n');
  }
  res.end();
});

router.get('/logs', (req, res) => {
  const db = getDb();
  if (!db) return res.json({ logs: [], total: 0, limit: 50, offset: 0 });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { where, params } = buildWhereClause(req.query);

  const total = db.prepare(`SELECT COUNT(*) as count FROM request_logs ${where}`).get(...params).count;

  const logs = db.prepare(
    `SELECT ${LOG_COLUMNS} FROM request_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ logs, total, limit, offset });
});

router.delete('/logs', (req, res) => {
  const db = getDb();
  if (!db) return res.json({ deleted: 0 });

  const result = db.prepare('DELETE FROM request_logs').run();
  res.json({ deleted: result.changes });
});

// --- Live log stream ---

let activeStreams = 0;
const MAX_STREAMS = 5;

router.get('/logs/stream', (req, res) => {
  if (activeStreams >= MAX_STREAMS) {
    return res.status(429).json({ error: 'Too many active log streams' });
  }

  activeStreams++;
  initSSE(res);

  // Send last 50 logs as initial batch
  const db = getDb();
  if (db) {
    const recent = db.prepare(`SELECT ${LOG_COLUMNS} FROM request_logs ORDER BY id DESC LIMIT 50`).all();
    sendSSEChunk(res, { type: 'init', logs: recent.reverse() });
  }

  // Subscribe to new logs
  const onLogs = (entries) => {
    if (!res.writableEnded) {
      sendSSEChunk(res, { type: 'batch', logs: entries });
    }
  };
  emitter.on('logs', onLogs);

  // Cleanup on disconnect
  const cleanup = () => {
    emitter.removeListener('logs', onLogs);
    activeStreams--;
  };
  res.on('close', cleanup);
  res.on('finish', cleanup);
});

module.exports = router;
