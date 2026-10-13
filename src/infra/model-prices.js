'use strict';

const path = require('node:path');
const { yamlManifest } = require('./yaml-manifest');

// What a request would have cost at the API's list price, for a CLI that reports tokens but no
// cost (ADR-0012). Never a reported figure: it is logged and returned beside cost_usd, not in it.

const prices = yamlManifest(path.join(__dirname, '../../config/model-prices.yaml'), { models: {} });

function estimateCost(model, usage) {
  const { models, long_context_above: longAbove } = prices();
  const listed = models?.[model];
  if (!listed || !usage) return null;

  const fresh = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const rates = longAbove && listed.long_context && fresh + cacheRead + cacheWrite > longAbove
    ? listed.long_context
    : listed;
  if ([rates.input, rates.cached_input, rates.output].some((rate) => typeof rate !== 'number')) return null;

  // Reasoning tokens are already inside output_tokens; adding them again would bill them twice.
  const usd = (fresh * rates.input
    + cacheRead * rates.cached_input
    + cacheWrite * (rates.cache_write ?? rates.input)
    + (usage.output_tokens || 0) * rates.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

// A request the CLI priced keeps that figure alone; an estimate is only for the ones it did not.
function estimateFor({ cost_usd, usage, metrics } = {}) {
  if (cost_usd != null) return null;
  return estimateCost(metrics?.upstream_model, usage);
}

module.exports = { estimateCost, estimateFor };
