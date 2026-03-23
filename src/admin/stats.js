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

  // Error rate breakdown by class (2xx, 4xx, 5xx)
  const errorRateRows = db.prepare(`
    SELECT
      CASE WHEN status >= 200 AND status < 300 THEN '2xx'
           WHEN status >= 400 AND status < 500 THEN '4xx'
           ELSE '5xx' END as class,
      COUNT(*) as count
    FROM request_logs
    WHERE created_at >= datetime('now', ?)
    GROUP BY class
  `).all(interval);
  const by_status_class = {};
  for (const row of errorRateRows) {
    by_status_class[row.class] = row.count;
  }

  const total = agg.total_requests || 1;
  const error_rate = {
    success_pct: Math.round(((by_status_class['2xx'] || 0) / total) * 1000) / 10,
    client_error_pct: Math.round(((by_status_class['4xx'] || 0) / total) * 1000) / 10,
    server_error_pct: Math.round(((by_status_class['5xx'] || 0) / total) * 1000) / 10,
    by_class: by_status_class,
  };

  // Cost breakdown by provider
  const costByProviderRows = db.prepare(`
    SELECT provider, COALESCE(ROUND(SUM(cost_usd), 4), 0) as cost
    FROM request_logs
    WHERE created_at >= datetime('now', ?) AND provider IS NOT NULL
    GROUP BY provider
  `).all(interval);
  const cost_by_provider = {};
  for (const row of costByProviderRows) {
    cost_by_provider[row.provider] = row.cost;
  }

  // Timeline buckets for sparklines
  const bucketExpr = periodKey === '24h'
    ? "strftime('%Y-%m-%d %H:00', created_at)"
    : "strftime('%Y-%m-%d', created_at)";
  const timelineRows = db.prepare(`
    SELECT
      ${bucketExpr} as bucket,
      COUNT(*) as requests,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errors,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) as cost
    FROM request_logs
    WHERE created_at >= datetime('now', ?)
    GROUP BY bucket
    ORDER BY bucket
  `).all(interval);

  // Cost burn rate (cost per hour in the period)
  const periodHours = { '24h': 24, '7d': 168, '30d': 720 };
  const hours = periodHours[periodKey] || 24;
  const cost_burn_rate = Math.round((agg.total_cost_usd / hours) * 10000) / 10000;

  const activeClients = db.prepare('SELECT COUNT(*) as count FROM clients WHERE active = 1').get();

  res.json({
    period: periodKey,
    total_requests: agg.total_requests,
    total_tokens: agg.total_tokens,
    total_cost_usd: agg.total_cost_usd,
    avg_duration_ms: agg.avg_duration_ms,
    by_provider,
    by_status,
    error_rate,
    cost_by_provider,
    cost_burn_rate,
    timeline: timelineRows,
    active_clients: activeClients.count,
  });
});

module.exports = router;
