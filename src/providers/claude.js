const { execute, executeStream } = require('./base');

const VALID_MODELS = [
  'claude',
  'claude-sonnet', 'claude-sonnet-4-6',
  'claude-haiku', 'claude-haiku-4-5',
  'claude-opus', 'claude-opus-4-6',
];

function buildArgs({ prompt, system, temperature, response_format }) {
  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'json',
  ];

  const jsonMode = response_format?.type === 'json_object';
  const systemPrompt = jsonMode && system
    ? system + '\n\nRespond with valid JSON only.'
    : jsonMode ? 'Respond with valid JSON only.'
    : system;
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }
  if (temperature !== undefined) {
    args.push('--temperature', String(temperature));
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

// Claude CLI uses its own stored credentials — no API key needed in env.
// Only pass XDG config paths so the CLI can find its auth config.
const CLAUDE_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};

async function chat({ prompt, system, temperature, response_format }) {
  const args = buildArgs({ prompt, system, temperature, response_format });
  const result = await execute('claude', args, { env: CLAUDE_ENV });
  return parseOutput(result.stdout, result.stderr);
}

async function* chatStream({ prompt, system, temperature, response_format, signal }) {
  // For streaming, use --print without --output-format json so tokens emit incrementally
  const args = ['--print', '--dangerously-skip-permissions'];
  const jsonMode = response_format?.type === 'json_object';
  const systemPrompt = jsonMode && system
    ? system + '\n\nRespond with valid JSON only.'
    : jsonMode ? 'Respond with valid JSON only.'
    : system;
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (temperature !== undefined) args.push('--temperature', String(temperature));
  args.push('--', prompt);

  for await (const event of executeStream('claude', args, { env: CLAUDE_ENV, signal })) {
    if (event.type === 'chunk') {
      yield { type: 'delta', content: event.data };
    }
  }
  yield { type: 'done' };
}

module.exports = {
  name: 'claude',
  chat,
  chatStream,
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
