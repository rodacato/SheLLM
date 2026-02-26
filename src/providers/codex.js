const { execute } = require('./base');

const VALID_MODELS = ['codex', 'codex-mini'];

function buildArgs({ prompt, system }) {
  // Codex has no --system-prompt flag — prepend to prompt
  let fullPrompt = '';
  if (system) {
    fullPrompt += system + '\n\n---\n\n';
  }
  fullPrompt += prompt;

  return [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--json',
    '--quiet',
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
  const result = await execute('codex', args);
  return parseOutput(result.stdout);
}

module.exports = {
  name: 'codex',
  chat,
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
