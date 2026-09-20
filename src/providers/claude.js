const { execute, executeStream, stripNonPrintable } = require('./base');
const { modelNotFound } = require('../errors');

const MODEL_ALIASES = { 'claude-haiku': 'haiku', 'claude-sonnet': 'sonnet', 'claude-opus': 'opus' };
const models = ['claude', ...Object.keys(MODEL_ALIASES)];

const PREFIX = 'claude-';

// A full model id must reach the CLI untouched, so the prefix comes off only for a name the
// catalog says is an alias. MODEL_ALIASES stays as the floor: tier names outlive the catalog.
function cliModel(model) {
  if (!model || model === 'claude') return null;
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model];
  if (!model.startsWith(PREFIX)) return model;
  const short = model.slice(PREFIX.length);
  const { bakedAliases } = require('../infra/model-catalog');
  return bakedAliases('claude').has(short) ? short : model;
}

function shouldSkipPermissions() {
  return process.env.SHELLM_CLAUDE_SKIP_PERMISSIONS !== 'false';
}

function systemPromptFor({ system, response_format }) {
  if (response_format?.type !== 'json_object') return system;
  return system ? system + '\n\nRespond with valid JSON only.' : 'Respond with valid JSON only.';
}

// An HTTP service must not run whatever the server user has configured for their own shell:
// slash commands, MCP servers from ~/.claude.json, and hooks all execute code we never reviewed.
// The CLI's own tools go with them (ADR-0002): a one-shot request has an empty working directory
// and nothing to use them on, and their definitions are what costs latency in this set.
const ISOLATION_ARGS = [
  '--tools', '',
  '--disable-slash-commands',
  '--strict-mcp-config',
  '--settings', '{"disableAllHooks":true}',
  '--permission-mode', 'dontAsk',
];

// The claude CLI has no temperature flag, so temperature is ignored.
function buildBaseArgs({ prompt, system, response_format, model }) {
  const args = ['--print', ...ISOLATION_ARGS];
  if (shouldSkipPermissions()) args.push('--dangerously-skip-permissions');
  if (cliModel(model)) args.push('--model', cliModel(model));
  const systemPrompt = systemPromptFor({ system, response_format });
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  args.push('--', prompt);
  return args;
}

function withOutputFormat(args, format) {
  const formatted = [...args];
  formatted.splice(formatted.indexOf('--'), 0, ...format);
  return formatted;
}

function buildArgs(params) {
  return withOutputFormat(buildBaseArgs(params), ['--output-format', 'json']);
}

// --verbose is not optional: under --print the CLI refuses stream-json without it.
function buildStreamArgs(params) {
  return withOutputFormat(buildBaseArgs(params), [
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]);
}

function usageFrom(data) {
  if (!data.usage) return null;
  return {
    input_tokens: data.usage.input_tokens || 0,
    output_tokens: data.usage.output_tokens || 0,
    cache_creation_input_tokens: data.usage.cache_creation_input_tokens || 0,
    cache_read_input_tokens: data.usage.cache_read_input_tokens || 0,
  };
}

// modelUsage lists every model a turn touched; the costliest one did the work.
function upstreamModelFrom(data) {
  const entries = Object.entries(data.modelUsage || {});
  if (entries.length === 0) return null;
  return entries.reduce((a, b) => ((b[1]?.costUSD || 0) > (a[1]?.costUSD || 0) ? b : a))[0];
}

function metricsFrom(data) {
  return {
    ttft_ms: data.ttft_ms ?? null,
    api_ms: data.duration_api_ms ?? null,
    upstream_model: upstreamModelFrom(data),
    api_error_status: data.api_error_status ?? null,
  };
}

function parseOutput(stdout, stderr) {
  let content = stdout;
  let cost_usd = null;
  let usage = null;
  let metrics = null;

  try {
    const data = JSON.parse(stdout || stderr);
    content = data.result || data.content || stdout;
    cost_usd = data.total_cost_usd || data.cost_usd || null;
    usage = usageFrom(data);
    metrics = metricsFrom(data);
  } catch {
    // Not JSON — use raw stdout as content
  }

  return { content: stripNonPrintable(content), cost_usd, usage, metrics };
}

// One NDJSON line of `--output-format stream-json`; anything else is progress noise.
function parseStreamLine(line) {
  if (!line.trim()) return null;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
    const text = event.event.delta?.text;
    return text ? { type: 'delta', content: stripNonPrintable(text) } : null;
  }
  if (event.type === 'result') {
    return { type: 'usage', usage: usageFrom(event), cost_usd: event.total_cost_usd ?? null, metrics: metricsFrom(event) };
  }
  return null;
}

// The token from `claude setup-token` is the only SheLLM setting the CLI may see.
const CLAUDE_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
};

// `auth status` reads the stored credentials and prints JSON. It spends no quota, which is the
// whole point: a health probe must not cost a request.
const authProbe = {
  args: ['auth', 'status'],
  parse(stdout) {
    try {
      return JSON.parse(stdout).loggedIn === true;
    } catch {
      return null;
    }
  },
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
  const args = buildStreamArgs({ prompt, system, response_format, model });
  let pending = '';

  for await (const event of executeStream('claude', args, { env: CLAUDE_ENV, signal })) {
    if (event.type !== 'chunk') continue;
    pending += event.data;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      const parsed = parseStreamLine(line);
      if (parsed) yield parsed;
    }
  }

  const last = parseStreamLine(pending);
  if (last) yield last;
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
  ISOLATION_ARGS,
  authProbe,
  parseOutput,
  parseStreamLine,
};
