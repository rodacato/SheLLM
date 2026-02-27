const { execute } = require('./base');

const VALID_MODELS = ['gemini', 'gemini-pro', 'gemini-flash'];

function buildArgs({ prompt, system }) {
  // Gemini has no --system-prompt flag — prepend to prompt
  let fullPrompt = '';
  if (system) {
    fullPrompt += system + '\n\n---\n\n';
  }
  fullPrompt += prompt;

  return [
    '--output-format', 'json',
    '--approval-mode', 'yolo',
    '-p', fullPrompt,
  ];
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

async function chat({ prompt, system }) {
  const args = buildArgs({ prompt, system });
  const result = await execute('gemini', args);
  return parseOutput(result.stdout);
}

module.exports = {
  name: 'gemini',
  chat,
  buildArgs,
  parseOutput,
  validModels: VALID_MODELS,
  capabilities: {
    supports_system_prompt: false,
    supports_json_output: false,
    supports_max_tokens: false,
    cli_command: 'gemini -p',
  },
};
