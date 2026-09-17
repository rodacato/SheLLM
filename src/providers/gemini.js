const { execute } = require('./base');

const MODEL_ALIASES = { 'gemini-pro': 'pro', 'gemini-flash': 'flash', 'gemini-flash-lite': 'flash-lite' };
const models = ['gemini', ...Object.keys(MODEL_ALIASES)];

function cliModel(model) {
  if (!model || model === 'gemini') return null;
  return MODEL_ALIASES[model] || model;
}

// Gemini CLI needs config paths for auth tokens
const GEMINI_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

// The gemini CLI has no temperature flag, so temperature is ignored.
function buildArgs({ prompt, system, response_format, model }) {
  // Gemini has no --system-prompt flag — prepend to prompt
  let fullPrompt = '';
  const jsonMode = response_format?.type === 'json_object';
  const systemText = jsonMode && system
    ? system + '\n\nRespond with valid JSON only.'
    : jsonMode ? 'Respond with valid JSON only.'
    : system;
  if (systemText) {
    fullPrompt += systemText + '\n\n---\n\n';
  }
  fullPrompt += prompt;

  const args = [
    '--output-format', 'json',
    '--approval-mode', 'yolo',
  ];
  if (cliModel(model)) args.push('-m', cliModel(model));
  args.push('-p', fullPrompt);
  return args;
}

function parseOutput(stdout) {
  try {
    const data = JSON.parse(stdout);
    let input_tokens = 0;
    let output_tokens = 0;

    // Sum tokens across all models used in the request
    if (data.stats?.models) {
      for (const model of Object.values(data.stats.models)) {
        input_tokens += model.tokens?.input || 0;
        output_tokens += model.tokens?.candidates || 0;
      }
    }

    return {
      content: data.response || stdout,
      cost_usd: null,
      usage: input_tokens || output_tokens
        ? { input_tokens, output_tokens }
        : null,
    };
  } catch {
    return { content: stdout, cost_usd: null, usage: null };
  }
}

async function chat({ prompt, system, response_format, model }) {
  const args = buildArgs({ prompt, system, response_format, model });
  const result = await execute('gemini', args, { env: GEMINI_ENV });
  return parseOutput(result.stdout);
}

module.exports = {
  name: 'gemini',
  models,
  chat,
  buildArgs,
  parseOutput,
};
