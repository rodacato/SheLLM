'use strict';

const ANTHROPIC_MODEL = process.env.CONFORMANCE_ANTHROPIC_MODEL || 'claude-haiku-5-5';
const OPENAI_MODEL = process.env.CONFORMANCE_OPENAI_MODEL || 'gpt-4.1-mini';

// Prefixed on purpose: a bare ANTHROPIC_API_KEY in the shell makes the claude CLI bill the API
// instead of the subscription.
const TARGETS = {
  anthropic: { apis: ['anthropic'], baseUrl: 'https://api.anthropic.com', keyEnv: 'CONFORMANCE_ANTHROPIC_API_KEY', model: ANTHROPIC_MODEL },
  openai: { apis: ['openai'], baseUrl: 'https://api.openai.com', keyEnv: 'CONFORMANCE_OPENAI_API_KEY', model: OPENAI_MODEL },
  'anthropic-openai': { apis: ['openai'], baseUrl: 'https://api.anthropic.com', keyEnv: 'CONFORMANCE_ANTHROPIC_API_KEY', model: ANTHROPIC_MODEL },
  shellm: {
    apis: ['anthropic', 'openai'],
    baseUrl: process.env.CONFORMANCE_SHELLM_URL || 'http://127.0.0.1:6100',
    keyEnv: 'CONFORMANCE_SHELLM_API_KEY',
    model: process.env.CONFORMANCE_SHELLM_MODEL || 'claude-haiku',
  },
};

// Which recording each format is judged against.
const REFERENCE = { anthropic: 'anthropic', openai: 'openai' };

function resolveTarget(name) {
  const target = TARGETS[name];
  if (!target) throw new Error(`Unknown target "${name}". Known: ${Object.keys(TARGETS).join(', ')}`);
  return { name, ...target, apiKey: process.env[target.keyEnv] };
}

module.exports = { TARGETS, REFERENCE, resolveTarget };
