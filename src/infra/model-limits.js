'use strict';

// Per field, the CLI wins, then the hand-kept manifest, then the default (ADR-0009). Every value
// carries its source, so a caller can tell a reported figure from an assumption.

const ONE_MILLION = 1_000_000;

function manifest() {
  try {
    return require('../catalog/limits.json');
  } catch {
    return { default: { context_window: 200_000 }, models: {} };
  }
}

// What the catalog entry reports, in the manifest's field names. Only fields a CLI answers.
function fromCli(entry) {
  const cli = {};
  if (entry?.longContext) cli.context_window_1m = ONE_MILLION;
  if (entry?.reasoningEfforts?.length) cli.reasoning_efforts = entry.reasoningEfforts;
  if (entry?.defaultReasoningEffort) cli.default_reasoning_effort = entry.defaultReasoningEffort;
  if (entry?.inputModalities?.length) cli.input_modalities = entry.inputModalities;
  return cli;
}

function limitsFor(id, entry) {
  const { default: fallback = {}, models = {} } = manifest();
  const layers = [['cli', fromCli(entry)], ['manifest', models[id] || {}], ['default', fallback]];
  const limits = {};
  const sources = {};
  for (const [source, values] of layers) {
    for (const [field, value] of Object.entries(values)) {
      if (field in limits || value === undefined || value === null) continue;
      limits[field] = value;
      sources[field] = source;
    }
  }
  return { limits, sources };
}

module.exports = { limitsFor };
