'use strict';

const client = require('prom-client');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

// Same name and labels as the other apps' HTTP metric, so one Grafana panel reads all of them.
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

const llmRequests = new client.Counter({
  name: 'shellm_llm_requests_total',
  help: 'Requests a provider CLI was started for, by outcome',
  labelNames: ['provider', 'model', 'outcome'],
  registers: [registry],
});

// A CLI call runs from about a second to TIMEOUT_MS (five minutes by default).
const llmDuration = new client.Histogram({
  name: 'shellm_llm_duration_seconds',
  help: 'Time to complete the CLI call, queue wait excluded, in seconds',
  labelNames: ['provider', 'model'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300],
  registers: [registry],
});

const llmTokens = new client.Counter({
  name: 'shellm_llm_tokens_total',
  help: 'Tokens the CLI reported; input includes cache reads and writes',
  labelNames: ['provider', 'model', 'direction'],
  registers: [registry],
});

const llmCost = new client.Counter({
  name: 'shellm_llm_cost_usd_total',
  help: 'API-equivalent cost in USD: the CLI-reported figure, or the price-manifest estimate',
  labelNames: ['provider', 'model'],
  registers: [registry],
});

// Express only knows the pattern once a route matched. A router mount or static directory without
// one reports its mount point; anything else is a single label, never the raw path.
function routeLabel(req) {
  if (req.route?.path) return `${req.baseUrl || ''}${req.route.path}`;
  return req.baseUrl || 'unmatched';
}

function recordHttp(req, res, durationMs) {
  httpDuration.observe(
    { method: req.method, route: routeLabel(req), status_code: String(res.statusCode) },
    durationMs / 1000,
  );
}

// Any `claude-*` or `codex-*` name routes, so the requested model is caller text. Only names a
// provider declares become a label value; the rest share one.
function modelLabel(provider, model) {
  const { engines } = require('../routing/engines');
  return engines[provider]?.models?.includes(model) ? model : 'other';
}

function outcomeOf(res) {
  const code = res.locals.error_code;
  if (code === 'timeout') return 'timeout';
  if (code === 'rate_limited' || res.locals.metrics?.api_error_status === 429) return 'rate_limited';
  if (code || res.statusCode >= 400) return 'error';
  return 'ok';
}

// cli_ms is set only where a CLI was started. Without it the request was refused before any
// provider ran — a full queue, the stream cap, an open circuit — and is not an LLM request.
function recordLlm(res) {
  const { provider, cli_ms: cliMs, usage } = res.locals;
  if (!provider || cliMs == null) return;

  const labels = { provider, model: modelLabel(provider, res.locals.model) };
  llmRequests.inc({ ...labels, outcome: outcomeOf(res) });
  llmDuration.observe(labels, cliMs / 1000);

  if (usage) {
    const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0)
      + (usage.cache_creation_input_tokens || 0);
    llmTokens.inc({ ...labels, direction: 'input' }, input);
    llmTokens.inc({ ...labels, direction: 'output' }, usage.output_tokens || 0);
  }

  const cost = res.locals.cost_usd ?? res.locals.cost_estimate_usd;
  if (cost != null) llmCost.inc(labels, cost);
}

module.exports = { registry, recordHttp, recordLlm, routeLabel };
