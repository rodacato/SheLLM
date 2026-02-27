'use strict';

const { Router } = require('express');
const { getDb } = require('../db');

const router = Router();

router.get('/logs', (req, res) => {
  const db = getDb();
  if (!db) return res.json({ logs: [], total: 0, limit: 50, offset: 0 });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const conditions = [];
  const params = [];

  if (req.query.provider) {
    conditions.push('provider = ?');
    params.push(req.query.provider);
  }

  if (req.query.client) {
    conditions.push('client_name = ?');
    params.push(req.query.client);
  }

  if (req.query.status) {
    const s = req.query.status;
    if (/^\d$/.test(s)) {
      // Single digit: status class (2 → 200-299)
      const base = parseInt(s, 10) * 100;
      conditions.push('status >= ? AND status < ?');
      params.push(base, base + 100);
    } else if (/^\d{3}$/.test(s)) {
      // Exact status code
      conditions.push('status = ?');
      params.push(parseInt(s, 10));
    }
  }

  if (req.query.from) {
    conditions.push('created_at >= ?');
    params.push(req.query.from);
  }

  if (req.query.to) {
    conditions.push('created_at <= ?');
    params.push(req.query.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM request_logs ${where}`).get(...params).count;

  const logs = db.prepare(
    `SELECT id, request_id, client_name, provider, model, status, duration_ms, queued_ms, tokens, cost_usd, created_at
     FROM request_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ logs, total, limit, offset });
});

module.exports = router;
