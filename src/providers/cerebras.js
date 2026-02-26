const API_URL = 'https://api.cerebras.ai/v1/chat/completions';

const MODEL_MAP = {
  'cerebras': 'gpt-oss-120b',
  'cerebras-8b': 'llama3.1-8b',
  'cerebras-120b': 'gpt-oss-120b',
  'cerebras-qwen': 'qwen-3-235b-a22b-instruct-2507',
};

const VALID_MODELS = Object.keys(MODEL_MAP);

function resolveModel(model) {
  return MODEL_MAP[model] || model;
}

async function chat({ prompt, system, max_tokens, model }) {
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

  if (max_tokens) {
    body.max_completion_tokens = max_tokens;
  }

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
    const err = new Error(`Cerebras API error: ${response.status} ${errorBody}`);
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

module.exports = {
  name: 'cerebras',
  chat,
  validModels: VALID_MODELS,
  capabilities: {
    supports_system_prompt: true,
    supports_json_output: false,
    supports_max_tokens: true,
    cli_command: null,
  },
};
