const API_URL = 'https://api.cerebras.ai/v1/chat/completions';

function resolveModel(model) {
  try {
    const { getModelByName } = require('../db');
    const row = getModelByName(model);
    if (row && row.upstream_model) return row.upstream_model;
  } catch { /* DB not available */ }
  return model;
}

async function chat({ prompt, system, max_tokens, temperature, top_p, response_format, model }) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    const err = new Error('CEREBRAS_API_KEY environment variable is required');
    err.provider_unavailable = true;
    throw err;
  }

  const messages = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: resolveModel(model || 'cerebras'),
    messages,
  };

  if (max_tokens) body.max_completion_tokens = max_tokens;
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (response_format) body.response_format = response_format;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const logger = require('../lib/logger');
    logger.error({ event: 'cerebras_api_error', status: response.status, body: errorBody.slice(0, 500) });
    const err = new Error(`Provider returned an error (HTTP ${response.status})`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const choice = data.choices[0];

  return {
    content: choice.message.content || '',
    cost_usd: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

async function* chatStream({ prompt, system, max_tokens, temperature, top_p, response_format, model, signal }) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    const err = new Error('CEREBRAS_API_KEY environment variable is required');
    err.provider_unavailable = true;
    throw err;
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = { model: resolveModel(model || 'cerebras'), messages, stream: true };
  if (max_tokens) body.max_completion_tokens = max_tokens;
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (response_format) body.response_format = response_format;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const logger = require('../lib/logger');
    logger.error({ event: 'cerebras_api_error', status: response.status, body: errorBody.slice(0, 500) });
    throw new Error(`Provider returned an error (HTTP ${response.status})`);
  }

  // Parse SSE from the API response stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') break;
      try {
        const chunk = JSON.parse(payload);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield { type: 'delta', content };
      } catch { /* skip */ }
    }
  }
  yield { type: 'done' };
}

module.exports = {
  name: 'cerebras',
  chat,
  chatStream,
};
