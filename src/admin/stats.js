'use strict';

const { Router } = require('express');
const { getDb } = require('../db');

const router = Router();

const PERIODS = {
  '24h': '-1 day',
  '7d': '-7 days',
  '30d': '-30 days',
};

router.get('/stats', (req, res) => {
  const db = getDb();
  if (!db) {
    return res.json({
      period: req.query.period || '24h',
      total_requests: 0, total_tokens: 0, total_cost_usd: 0, avg_duration_ms: 0,
      by_provider: {}, by_status: {}, active_clients: 0,
    });
  }

  const periodKey = PERIODS[req.query.period] ? req.query.period : '24h';
  const interval = PERIODS[periodKey];

  const agg = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(tokens), 0) as total_tokens,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) as total_cost_usd,
      COALESCE(ROUND(AVG(duration_ms)), 0) as avg_duration_ms
    FROM request_logs
    WHERE created_at >= datetime('now', ?)
  `).get(interval);

  const byProviderRows = db.prepare(`
    SELECT provider, COUNT(*) as count
    FROM request_logs
    WHERE created_at >= datetime('now', ?) AND provider IS NOT NULL
    GROUP BY provider
  `).all(interval);
  const by_provider = {};
  for (const row of byProviderRows) {
    by_provider[row.provider] = row.count;
  }

  const byStatusRows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM request_logs
    WHERE created_at >= datetime('now', ?)
    GROUP BY status
  `).all(interval);
  const by_status = {};
  for (const row of byStatusRows) {
    by_status[String(row.status)] = row.count;
  }

  const activeClients = db.prepare('SELECT COUNT(*) as count FROM clients WHERE active = 1').get();

  res.json({
    period: periodKey,
    total_requests: agg.total_requests,
    total_tokens: agg.total_tokens,
    total_cost_usd: agg.total_cost_usd,
    avg_duration_ms: agg.avg_duration_ms,
    by_provider,
    by_status,
    active_clients: activeClients.count,
  });
});

module.exports = router;
