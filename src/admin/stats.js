'use strict';

const { Router } = require('express');
const { getDb } = require('../db');
const stats = require('../db/stats');

const router = Router();

const PERIODS = {
  '24h': { interval: '-1 day', hours: 24 },
  '7d': { interval: '-7 days', hours: 168 },
  '30d': { interval: '-30 days', hours: 720 },
};

// Rolling windows, not the provider's own reset cycle — no CLI reports when that cycle ends.
const QUOTA_WINDOW_HOURS = [
  parseInt(process.env.SHELLM_QUOTA_WINDOW_HOURS || '5', 10),
  parseInt(process.env.SHELLM_QUOTA_WEEK_HOURS || '168', 10),
];

function noData() {
  return {
    agg: {
      total_requests: 0, total_tokens: 0, tokens_in: 0, tokens_out: 0,
      cache_write_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0, avg_duration_ms: 0,
    },
    byStatusCode: [],
    providerRows: [],
    errorBreakdown: [],
    latency: null,
    quota: null,
    byModel: [],
    byClient: [],
    timeline: [],
    recentRequests: [],
    activeClients: 0,
  };
}

function errorRate(byStatusCode, total) {
  const classOf = (status) => (status >= 200 && status < 400 ? '2xx' : status < 500 ? '4xx' : '5xx');
  const by_class = {};
  for (const { status, count } of byStatusCode) {
    const key = classOf(status);
    by_class[key] = (by_class[key] || 0) + count;
  }
  const pct = (n) => Math.round(((n || 0) / (total || 1)) * 1000) / 10;
  return {
    success_pct: pct(by_class['2xx']),
    client_error_pct: pct(by_class['4xx']),
    server_error_pct: pct(by_class['5xx']),
    by_class,
  };
}

function quotaSection(interval) {
  const windows = QUOTA_WINDOW_HOURS.map((hours) => stats.usageWindow(hours));
  return {
    windows,
    by_provider: stats.usageByProvider(interval),
    limited: stats.limitState('-7 days'),
    note: 'Derived from observed usage. Neither CLI reports remaining quota or a reset time.',
  };
}

function latencySection(interval, hours) {
  const layers = stats.latencyLayers(interval);
  const previous = stats.previousPeriod('duration_ms', interval, hours);
  return {
    ...layers,
    previous_total_ms: previous,
    delta_p95_pct: previous.p95 && layers.total_ms.p95
      ? Math.round(((layers.total_ms.p95 - previous.p95) / previous.p95) * 1000) / 10
      : null,
  };
}

// The only place the response shape is written down, so a database-less answer cannot lose a key.
function payload(period, hours, source) {
  const {
    agg, byStatusCode, providerRows, errorBreakdown,
    latency, quota, byModel, byClient, timeline, recentRequests, activeClients,
  } = source;

  return {
    period,
    ...agg,
    by_provider: Object.fromEntries(providerRows.map((r) => [r.provider, r.requests])),
    by_status: Object.fromEntries(byStatusCode.map((r) => [String(r.status), r.count])),
    by_status_code: byStatusCode,
    error_breakdown: errorBreakdown,
    error_rate: errorRate(byStatusCode, agg.total_requests),
    cost_by_provider: Object.fromEntries(providerRows.map((r) => [r.provider, r.cost_usd])),
    cost_burn_rate: Math.round((agg.total_cost_usd / hours) * 10000) / 10000,
    latency,
    quota,
    by_model: byModel,
    by_client: byClient,
    timeline,
    recent_requests: recentRequests,
    active_clients: activeClients,
  };
}

router.get('/stats', (req, res) => {
  const periodKey = PERIODS[req.query.period] ? req.query.period : '24h';
  const { interval, hours } = PERIODS[periodKey];

  if (!getDb()) return res.json(payload(periodKey, hours, noData()));

  const db = getDb();

  const agg = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(tokens), 0) as total_tokens,
      COALESCE(SUM(tokens_in), 0) as tokens_in,
      COALESCE(SUM(tokens_out), 0) as tokens_out,
      COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) as total_cost_usd,
      COALESCE(ROUND(AVG(duration_ms)), 0) as avg_duration_ms
    FROM request_logs
    WHERE created_at >= datetime('now', ?)
  `).get(interval);

  const bucketExpr = periodKey === '24h'
    ? "strftime('%Y-%m-%d %H:00', created_at)"
    : "strftime('%Y-%m-%d', created_at)";

  res.json(payload(periodKey, hours, {
    agg,
    byStatusCode: stats.byStatusCode(interval),
    providerRows: stats.usageByProvider(interval),
    errorBreakdown: stats.errorBreakdown(interval),
    latency: latencySection(interval, hours),
    quota: quotaSection(interval),
    byModel: stats.byModel(interval),
    byClient: stats.byClient(interval),
    timeline: stats.timeline(interval, bucketExpr),
    recentRequests: stats.recentRequests(interval),
    activeClients: db.prepare('SELECT COUNT(*) as count FROM clients WHERE active = 1').get().count,
  }));
});

module.exports = router;
