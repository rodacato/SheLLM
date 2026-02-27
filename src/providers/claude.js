const { execute } = require('./base');

const VALID_MODELS = ['claude', 'claude-sonnet', 'claude-haiku', 'claude-opus'];

function buildArgs({ prompt, system }) {
  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'json',
  ];

  if (system) {
    args.push('--system-prompt', system);
  }

  args.push('--', prompt);
  return args;
}

function parseOutput(stdout, stderr) {
  let content = stdout;
  let cost_usd = null;
  let usage = null;

  // Claude CLI writes the result JSON to stderr with --output-format json
  const source = stderr || stdout;
  try {
    const data = JSON.parse(source);
    content = data.result || data.content || stdout;
    cost_usd = data.total_cost_usd || data.cost_usd || null;
    if (data.usage) {
      usage = {
        input_tokens: data.usage.input_tokens || 0,
        output_tokens: data.usage.output_tokens || 0,
      };
    }
  } catch {
    // Not JSON — use raw stdout as content
  }

  return { content, cost_usd, usage };
}

async function chat({ prompt, system }) {
  const args = buildArgs({ prompt, system });

  // Exclude ANTHROPIC_API_KEY — the CLI uses its own stored credentials
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const result = await execute('claude', args, { env });
  return parseOutput(result.stdout, result.stderr);
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
    supports_max_tokens: false,
    cli_command: 'claude --print',
  },
};
