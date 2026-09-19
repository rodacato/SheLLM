const { execute, executeStream, stripNonPrintable } = require('./base');
const { modelNotFound } = require('../errors');

const MODEL_ALIASES = { 'claude-haiku': 'haiku', 'claude-sonnet': 'sonnet', 'claude-opus': 'opus' };
const models = ['claude', ...Object.keys(MODEL_ALIASES)];

function cliModel(model) {
  if (!model || model === 'claude') return null;
  return MODEL_ALIASES[model] || model;
}

function shouldSkipPermissions() {
  return process.env.SHELLM_CLAUDE_SKIP_PERMISSIONS !== 'false';
}

function systemPromptFor({ system, response_format }) {
  if (response_format?.type !== 'json_object') return system;
  return system ? system + '\n\nRespond with valid JSON only.' : 'Respond with valid JSON only.';
}

// The claude CLI has no temperature flag, so temperature is ignored.
function buildStreamArgs({ prompt, system, response_format, model }) {
  const args = ['--print'];
  if (shouldSkipPermissions()) args.push('--dangerously-skip-permissions');
  if (cliModel(model)) args.push('--model', cliModel(model));
  const systemPrompt = systemPromptFor({ system, response_format });
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  args.push('--', prompt);
  return args;
}

function buildArgs(params) {
  const args = buildStreamArgs(params);
  args.splice(args.indexOf('--'), 0, '--output-format', 'json');
  return args;
}

function parseOutput(stdout, stderr) {
  let content = stdout;
  let cost_usd = null;
  let usage = null;

  try {
    const data = JSON.parse(stdout || stderr);
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

  return { content: stripNonPrintable(content), cost_usd, usage };
}

// The token from `claude setup-token` is the only SheLLM setting the CLI may see.
const CLAUDE_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
};

function toProviderError(err, model) {
  try {
    if (JSON.parse(err.stdout).api_error_status === 404) return modelNotFound(model);
  } catch { /* not a JSON result */ }
  return err;
}

async function chat({ prompt, system, response_format, model }) {
  const args = buildArgs({ prompt, system, response_format, model });
  const result = await execute('claude', args, { env: CLAUDE_ENV }).catch((err) => { throw toProviderError(err, model); });
  return parseOutput(result.stdout, result.stderr);
}

async function* chatStream({ prompt, system, response_format, model, signal }) {
  // Without --output-format json, tokens emit incrementally
  const args = buildStreamArgs({ prompt, system, response_format, model });

  for await (const event of executeStream('claude', args, { env: CLAUDE_ENV, signal })) {
    if (event.type === 'chunk') {
      yield { type: 'delta', content: event.data };
    }
  }
  yield { type: 'done' };
}

module.exports = {
  name: 'claude',
  models,
  env: CLAUDE_ENV,
  chat,
  chatStream,
  buildArgs,
  buildStreamArgs,
  parseOutput,
};
