'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

// Per field, the CLI wins, then the hand-kept manifest, then the default (ADR-0009). Every value
// carries its source, so a caller can tell a reported figure from an assumption.

const ONE_MILLION = 1_000_000;

const MANIFEST = path.join(__dirname, '../../config/model-limits.yaml');
const FALLBACK = { default: { context_window: 200_000 }, models: {} };

let cached = { mtimeMs: null, data: FALLBACK };

// Re-read only when the file changes, so an edit on the host needs no restart. A missing or
// broken file falls back to the default rather than breaking /v1/models.
function manifest() {
  try {
    const { mtimeMs } = fs.statSync(MANIFEST);
    if (mtimeMs !== cached.mtimeMs) cached = { mtimeMs, data: YAML.parse(fs.readFileSync(MANIFEST, 'utf8')) || FALLBACK };
    return cached.data;
  } catch {
    return FALLBACK;
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
  const { default: fallback = {}, models } = manifest();
  const layers = [['cli', fromCli(entry)], ['manifest', models?.[id] || {}], ['default', fallback]];
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
