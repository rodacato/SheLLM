'use strict';

const LOGGED = "created_at >= datetime('now', ?)";

function db() {
  return require('./index').getDb();
}

// SQLite has no percentile function and no extensions are loaded, so the value is read by
// offset. Ordering excludes nulls, which is why the offset counts the same filtered set.
// `until` bounds the window on the right, which is what makes a previous-period delta possible.
function percentile(column, fraction, { interval, until = null, extraWhere = '' }) {
  const bounds = until ? `${LOGGED} AND created_at < datetime('now', ?)` : LOGGED;
  const where = `${bounds} AND ${column} IS NOT NULL${extraWhere ? ` AND ${extraWhere}` : ''}`;
  const args = until ? [interval, until] : [interval];
  const row = db().prepare(`
    SELECT ${column} AS value FROM request_logs
    WHERE ${where}
    ORDER BY ${column}
    LIMIT 1 OFFSET (
      SELECT CAST((COUNT(*) - 1) * ? AS INTEGER) FROM request_logs WHERE ${where}
    )
  `).get(...args, fraction, ...args);
  return row ? row.value : null;
}

function percentiles(column, options) {
  return {
    p50: percentile(column, 0.5, options),
    p95: percentile(column, 0.95, options),
    p99: percentile(column, 0.99, options),
  };
}

// The only split that is exact: queueing is part of duration, so execution is the remainder.
// api_ms and ttft_ms come from the CLI and may overlap each other across internal retries —
// they are reported, never subtracted.
function latencyLayers(interval) {
  return {
    total_ms: percentiles('duration_ms', { interval }),
    queued_ms: percentiles('queued_ms', { interval }),
    execution_ms: percentiles('(duration_ms - COALESCE(queued_ms, 0))', { interval, extraWhere: 'duration_ms IS NOT NULL' }),
    api_ms: percentiles('api_ms', { interval }),
    ttft_ms: percentiles('ttft_ms', { interval }),
  };
}

// Same length of time, ending where the current period starts.
function previousPeriod(column, interval, hours) {
  return percentiles(column, { interval: `-${hours * 2} hours`, until: `-${hours} hours` });
}

function usageWindow(hours) {
  const interval = `-${hours} hours`;
  const row = db().prepare(`
    SELECT
      COUNT(*) AS requests,
      COALESCE(SUM(tokens), 0) AS tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) AS cost_usd,
      MIN(created_at) AS first_request_at
    FROM request_logs
    WHERE ${LOGGED}
  `).get(interval);

  return {
    hours,
    ...row,
    cost_per_hour: Math.round((row.cost_usd / hours) * 10000) / 10000,
    requests_per_minute: Math.round((row.requests / (hours * 60)) * 100) / 100,
  };
}

function usageByProvider(interval) {
  return db().prepare(`
    SELECT
      provider,
      COUNT(*) AS requests,
      COALESCE(SUM(tokens), 0) AS tokens,
      SUM(CASE WHEN cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS priced_requests,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) AS cost_usd
    FROM request_logs
    WHERE ${LOGGED} AND provider IS NOT NULL
    GROUP BY provider
    ORDER BY requests DESC
  `).all(interval);
}

// The CLI reports the model it actually ran; the caller's alias is kept for the rows that
// predate that column, so a default-model request is not filed as an empty name.
function byModel(interval) {
  return db().prepare(`
    SELECT
      COALESCE(upstream_model, model, '(unknown)') AS model,
      COUNT(*) AS requests,
      COALESCE(SUM(tokens), 0) AS tokens,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) AS cost_usd,
      COALESCE(ROUND(AVG(duration_ms)), 0) AS avg_duration_ms,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
    FROM request_logs
    WHERE ${LOGGED}
    GROUP BY COALESCE(upstream_model, model, '(unknown)')
    ORDER BY requests DESC
  `).all(interval);
}

function byClient(interval) {
  return db().prepare(`
    SELECT
      COALESCE(client_name, '(unknown)') AS client_name,
      COUNT(*) AS requests,
      COALESCE(SUM(tokens), 0) AS tokens,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) AS cost_usd,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
      MAX(created_at) AS last_seen_at
    FROM request_logs
    WHERE ${LOGGED}
    GROUP BY COALESCE(client_name, '(unknown)')
    ORDER BY requests DESC
  `).all(interval);
}

// Per-key usage, matched by id alone. Matching by name is what let a recreated key inherit the
// history of the one it replaced; migration 016 backfilled the rows that predate the column.
function usageByKey(interval) {
  return db().prepare(`
    SELECT
      c.id,
      COUNT(r.id) AS requests,
      COALESCE(SUM(r.tokens), 0) AS tokens,
      COALESCE(ROUND(SUM(r.cost_usd), 4), 0) AS cost_usd,
      SUM(CASE WHEN r.status >= 400 THEN 1 ELSE 0 END) AS errors,
      MAX(r.created_at) AS last_used_at
    FROM clients c
    LEFT JOIN request_logs r
      ON r.client_id = c.id
      AND r.${LOGGED}
    GROUP BY c.id
  `).all(interval);
}

function byStatusCode(interval) {
  return db().prepare(`
    SELECT status, COUNT(*) AS count
    FROM request_logs
    WHERE ${LOGGED} AND status IS NOT NULL
    GROUP BY status
    ORDER BY count DESC
  `).all(interval);
}

// A usage limit is observed, never estimated: the CLI reports it and the row keeps the code.
function limitState(interval) {
  const row = db().prepare(`
    SELECT created_at, provider, api_error_status, status
    FROM request_logs
    WHERE ${LOGGED} AND (api_error_status = 429 OR status = 429)
    ORDER BY id DESC
    LIMIT 1
  `).get(interval);
  if (!row) return null;
  return { since: row.created_at, provider: row.provider, status: row.api_error_status || row.status };
}

function timeline(interval, bucketExpr) {
  return db().prepare(`
    SELECT
      ${bucketExpr} AS bucket,
      COUNT(*) AS requests,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
      COALESCE(ROUND(SUM(cost_usd), 4), 0) AS cost,
      COALESCE(ROUND(AVG(duration_ms)), 0) AS avg_duration_ms,
      COALESCE(ROUND(AVG(queued_ms)), 0) AS avg_queued_ms
    FROM request_logs
    WHERE ${LOGGED}
    GROUP BY bucket
    ORDER BY bucket
  `).all(interval);
}

// Every request in the period, for the scatter the sparkline replaces. Capped: at this
// volume the honest chart is one mark per request, but the page must not carry a month of them.
function recentRequests(interval, limit = 500) {
  return db().prepare(`
    SELECT created_at, duration_ms, queued_ms, status, COALESCE(upstream_model, model) AS model
    FROM request_logs
    WHERE ${LOGGED} AND duration_ms IS NOT NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(interval, limit);
}

module.exports = {
  percentile,
  percentiles,
  latencyLayers,
  previousPeriod,
  usageWindow,
  usageByProvider,
  byModel,
  byClient,
  usageByKey,
  byStatusCode,
  limitState,
  timeline,
  recentRequests,
};
