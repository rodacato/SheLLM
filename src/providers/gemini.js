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
    '--output-format', 'text',
    '--approval-mode', 'yolo',
    '-p', fullPrompt,
  ];
}

function parseOutput(stdout) {
  return { content: stdout, cost_usd: null };
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
