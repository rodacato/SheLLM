'use strict';

/**
 * Generic OpenAI-compatible HTTP provider.
 *
 * Creates a provider engine from DB config. Any HTTP provider registered in the
 * `providers` table with type='http' and a health_check like:
 *   { "url": "https://api.example.com/v1/models", "auth_env": "EXAMPLE_API_KEY",
 *     "chat_url": "https://api.example.com/v1/chat/completions" }
 *
 * can be dispatched through this generic engine without writing a .js file.
 */

const { getModelByName } = require('../db');
const logger = require('../lib/logger');

function resolveModel(model) {
  try {
    const row = getModelByName(model);
    if (row && row.upstream_model) return row.upstream_model;
  } catch { /* DB not available */ }
  return model;
}

function createHttpProvider(providerConfig) {
  const { name, health_check } = providerConfig;
  const chatUrl = health_check.chat_url || health_check.url?.replace(/\/models$/, '/chat/completions');
  const authEnv = health_check.auth_env;

  function getApiKey() {
    const key = authEnv ? process.env[authEnv] : null;
    if (!key) {
      const err = new Error(`${authEnv || 'API_KEY'} environment variable is required for ${name}`);
      err.provider_unavailable = true;
      throw err;
    }
    return key;
  }

  async function chat({ prompt, system, max_tokens, temperature, top_p, response_format, model }) {
    const apiKey = getApiKey();
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const body = { model: resolveModel(model || name), messages };
    if (max_tokens) body.max_completion_tokens = max_tokens;
    if (temperature !== undefined) body.temperature = temperature;
    if (top_p !== undefined) body.top_p = top_p;
    if (response_format) body.response_format = response_format;

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ event: `${name}_api_error`, status: response.status, body: errorBody.slice(0, 500) });
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
    const apiKey = getApiKey();
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const body = { model: resolveModel(model || name), messages, stream: true };
    if (max_tokens) body.max_completion_tokens = max_tokens;
    if (temperature !== undefined) body.temperature = temperature;
    if (top_p !== undefined) body.top_p = top_p;
    if (response_format) body.response_format = response_format;

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ event: `${name}_api_error`, status: response.status, body: errorBody.slice(0, 500) });
      throw new Error(`Provider returned an error (HTTP ${response.status})`);
    }

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

  return { name, chat, chatStream };
}

module.exports = { createHttpProvider };
