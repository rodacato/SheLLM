'use strict';

const { Router } = require('express');
const { getDb } = require('../db');
const stats = require('../db/stats');
const { RETENTION_DAYS } = require('../db/request-logs');

const router = Router();

// One window: everything the pruner has not deleted. A selector here would offer narrower views
// of a table that is already bounded, and every figure on the page would need its own denominator.
const WINDOW_INTERVAL = `-${RETENTION_DAYS} days`;

// Rolling windows, not the provider's own reset cycle — no CLI reports when that cycle ends.
const QUOTA_WINDOW_HOURS = [
  parseInt(process.env.SHELLM_QUOTA_WINDOW_HOURS || '5', 10),
  parseInt(process.env.SHELLM_QUOTA_WEEK_HOURS || '168', 10),
];

function emptyWindow() {
  return {
    from: null, to: new Date().toISOString(), hours: 0, requests: 0, retention_days: RETENTION_DAYS,
  };
}

function noData() {
  return {
    window: emptyWindow(),
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
    recentRequestsTotal: 0,
    activeClients: 0,
  };
}

// Burn rate divides by the time actually observed. Dividing by the retention limit would report a
// quiet month for a service that has been running two hours.
function describeWindow(bounds) {
  const to = new Date();
  const from = bounds.first_request_at ? new Date(`${bounds.first_request_at.replace(' ', 'T')}Z`) : null;
  const hours = from ? Math.max((to - from) / 3600000, 1 / 60) : 0;
  return {
    from: from ? from.toISOString() : null,
    to: to.toISOString(),
    hours: Math.round(hours * 100) / 100,
    requests: bounds.requests,
    retention_days: RETENTION_DAYS,
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

function quotaSection(interval, uptimeHours) {
  const windows = QUOTA_WINDOW_HOURS.map((hours) => stats.usageWindow(hours, uptimeHours));
  return {
    windows,
    by_provider: stats.usageByProvider(interval),
    limited: stats.limitState('-7 days'),
    note: 'Derived from observed usage. Neither CLI reports remaining quota or a reset time.',
  };
}

// No previous-period delta: the comparable window would have to be the one behind this one, and
// the pruner has already deleted it. An invented baseline is worse than no arrow.
function latencySection(interval) {
  return stats.latencyLayers(interval);
}

// The only place the response shape is written down, so a database-less answer cannot lose a key.
function payload(source) {
  const {
    window, agg, byStatusCode, providerRows, errorBreakdown,
    latency, quota, byModel, byClient, timeline, recentRequests, recentRequestsTotal, activeClients,
  } = source;

  return {
    window,
    ...agg,
    by_provider: Object.fromEntries(providerRows.map((r) => [r.provider, r.requests])),
    by_status: Object.fromEntries(byStatusCode.map((r) => [String(r.status), r.count])),
    by_status_code: byStatusCode,
    error_breakdown: errorBreakdown,
    error_rate: errorRate(byStatusCode, agg.total_requests),
    cost_by_provider: Object.fromEntries(providerRows.map((r) => [r.provider, r.cost_usd])),
    cost_burn_rate: window.hours ? Math.round((agg.total_cost_usd / window.hours) * 10000) / 10000 : 0,
    latency,
    quota,
    by_model: byModel,
    by_client: byClient,
    timeline,
    recent_requests: recentRequests,
    recent_requests_total: recentRequestsTotal,
    active_clients: activeClients,
  };
}

router.get('/stats', (req, res) => {
  const interval = WINDOW_INTERVAL;

  if (!getDb()) return res.json(payload(noData()));

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

  const window = describeWindow(stats.windowBounds(interval));

  res.json(payload({
    window,
    agg,
    byStatusCode: stats.byStatusCode(interval),
    providerRows: stats.usageByProvider(interval),
    errorBreakdown: stats.errorBreakdown(interval),
    latency: latencySection(interval),
    quota: quotaSection(interval, window.hours),
    byModel: stats.byModel(interval),
    byClient: stats.byClient(interval),
    timeline: stats.timeline(interval),
    recentRequests: stats.recentRequests(interval),
    recentRequestsTotal: stats.recentRequestsTotal(interval),
    activeClients: db.prepare('SELECT COUNT(*) as count FROM clients WHERE active = 1').get().count,
  }));
});

module.exports = router;
