const { execute } = require('./base');

const VALID_MODELS = ['claude', 'claude-sonnet', 'claude-haiku', 'claude-opus'];

function buildArgs({ prompt, system, max_tokens }) {
  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'json',
    '--no-input',
  ];

  if (system) {
    args.push('--system-prompt', system);
  }
  if (max_tokens) {
    args.push('--max-tokens', String(max_tokens));
  }

  args.push('--', prompt);
  return args;
}

function parseOutput(stdout) {
  try {
    const data = JSON.parse(stdout);
    return {
      content: data.result || data.content || stdout,
      cost_usd: data.cost_usd || null,
    };
  } catch {
    return { content: stdout, cost_usd: null };
  }
}

async function chat({ prompt, system, max_tokens }) {
  const args = buildArgs({ prompt, system, max_tokens });

  // Exclude ANTHROPIC_API_KEY — the CLI uses its own stored credentials
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const result = await execute('claude', args, { env });
  return parseOutput(result.stdout);
}

module.exports = {
  name: 'claude',
  chat,
  buildArgs,
  parseOutput,
  validModels: VALID_MODELS,
  capabilities: {
    supports_system_prompt: true,
    supports_json_output: true,
    supports_max_tokens: true,
    cli_command: 'claude --print',
  },
};
