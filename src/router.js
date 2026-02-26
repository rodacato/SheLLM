const claude = require('./providers/claude');
const gemini = require('./providers/gemini');
const codex = require('./providers/codex');
const cerebras = require('./providers/cerebras');

const providers = { claude, gemini, codex, cerebras };

// Also register model aliases so "claude-opus" resolves to the claude provider
const modelToProvider = {};
for (const [name, provider] of Object.entries(providers)) {
  for (const model of provider.validModels) {
    modelToProvider[model] = name;
  }
}

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2', 10);
const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH || '10', 10);

class RequestQueue {
  constructor(maxConcurrent = MAX_CONCURRENT) {
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.pending = [];
  }

  async enqueue(fn) {
    if (this.pending.length >= MAX_QUEUE_DEPTH) {
      const err = new Error('Queue is full, try again later');
      err.status = 429;
      throw err;
    }

    if (this.active >= this.maxConcurrent) {
      await new Promise((resolve) => this.pending.push(resolve));
    }

    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.pending.length > 0) {
        const next = this.pending.shift();
        next();
      }
    }
  }

  get stats() {
    return {
      pending: this.pending.length,
      active: this.active,
      max_concurrent: this.maxConcurrent,
    };
  }
}

const queue = new RequestQueue();

function resolveProvider(model) {
  // Direct name match
  if (providers[model]) return providers[model];
  // Model alias match
  const providerName = modelToProvider[model];
  if (providerName) return providers[providerName];
  return null;
}

async function route({ model, prompt, system, max_tokens, request_id }) {
  const provider = resolveProvider(model);
  if (!provider) {
    const err = new Error(`Unknown provider: ${model}`);
    err.status = 400;
    throw err;
  }

  const startTime = Date.now();

  const result = await queue.enqueue(() =>
    provider.chat({ prompt, system, max_tokens, model })
  );

  return {
    content: result.content,
    provider: provider.name,
    model,
    duration_ms: Date.now() - startTime,
    request_id: request_id || null,
    ...(result.cost_usd != null && { cost_usd: result.cost_usd }),
    ...(result.usage && { usage: result.usage }),
  };
}

function listProviders() {
  return Object.values(providers).map((p) => ({
    name: p.name,
    models: p.validModels,
    ...p.capabilities,
  }));
}

module.exports = { route, queue, listProviders, resolveProvider, providers };
