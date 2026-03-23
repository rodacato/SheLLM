const { execute, executeStream } = require('./base');

const VALID_MODELS = ['codex', 'codex-mini'];

// Codex CLI needs config/data paths for auth tokens
const CODEX_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};

function buildArgs({ prompt, system, response_format }) {
  // Codex has no --system-prompt flag — prepend to prompt
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

  return [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--json',
    fullPrompt,
  ];
}

function parseOutput(stdout) {
  // Codex --json outputs JSONL events, one per line
  let content = '';
  let usage = null;

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        content = event.item.text || '';
      }
      if (event.type === 'turn.completed' && event.usage) {
        usage = {
          input_tokens: event.usage.input_tokens || 0,
          output_tokens: event.usage.output_tokens || 0,
        };
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return { content: content || stdout, cost_usd: null, usage };
}

async function chat({ prompt, system }) {
  const args = buildArgs({ prompt, system });
  const result = await execute('codex', args, { env: CODEX_ENV });
  return parseOutput(result.stdout);
}

async function* chatStream({ prompt, system, signal }) {
  const args = buildArgs({ prompt, system });
  let buffer = '';

  for await (const event of executeStream('codex', args, { env: CODEX_ENV, signal })) {
    if (event.type === 'chunk') {
      buffer += event.data;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && evt.item.text) {
            yield { type: 'delta', content: evt.item.text };
          }
        } catch { /* skip non-JSON */ }
      }
    }
  }
  yield { type: 'done' };
}

module.exports = {
  name: 'codex',
  chat,
  chatStream,
  buildArgs,
  parseOutput,
  validModels: VALID_MODELS,
  capabilities: {
    supports_system_prompt: false,
    supports_json_output: true,
    supports_max_tokens: false,
    cli_command: 'codex exec',
  },
};
