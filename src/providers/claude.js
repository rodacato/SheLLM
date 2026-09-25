const { execute, executeStream, stripNonPrintable } = require('./base');
const { modelNotFound, cliFailed, contextLengthExceeded } = require('../errors');
const config = require('../config');

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
  return config.get('SHELLM_CLAUDE_SKIP_PERMISSIONS');
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

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Checked here because the CLI only warns on an unknown level and carries on at its own default.
function effortFor(requested) {
  const effort = requested || config.get('SHELLM_CLAUDE_EFFORT');
  return EFFORTS.includes(effort) ? effort : null;
}

function wantsSchema(response_format) {
  return response_format?.type === 'json_schema';
}

// The claude CLI has no temperature flag, so temperature is ignored.
function buildBaseArgs({ system, response_format, model, effort }) {
  const args = ['--print', ...ISOLATION_ARGS];
  if (shouldSkipPermissions()) args.push('--dangerously-skip-permissions');
  if (cliModel(model)) args.push('--model', cliModel(model));
  if (effortFor(effort)) args.push('--effort', effortFor(effort));
  if (systemPromptFor({ system, response_format })) args.push('--system-prompt-file', SYSTEM_FILE);
  // The flag takes the schema inline only; a path is refused as invalid JSON.
  if (wantsSchema(response_format)) args.push('--json-schema', JSON.stringify(response_format.json_schema.schema));
  return args;
}

// --verbose is not optional: under --print the CLI refuses stream-json without it.
const NDJSON_OUTPUT = ['--output-format', 'stream-json', '--verbose'];
const STREAM_OUTPUT = [...NDJSON_OUTPUT, '--include-partial-messages'];

// Nothing the caller wrote goes on the command line, where Linux caps each argument at 128 KiB:
// the prompt goes to stdin and the system prompt to a file in the request's directory. A message
// with images goes as one stream-json user message, which the CLI takes only with stream-json output.
const SYSTEM_FILE = 'system-prompt.txt';

function hasImages(params) {
  return Array.isArray(params.parts);
}

function withPrompt(args, params) {
  return hasImages(params) ? [...args, '--input-format', 'stream-json'] : args;
}

function buildArgs(params) {
  const output = hasImages(params) ? NDJSON_OUTPUT : ['--output-format', 'json'];
  return withPrompt([...buildBaseArgs(params), ...output], params);
}

function buildStreamArgs(params) {
  return withPrompt([...buildBaseArgs(params), ...STREAM_OUTPUT], params);
}

function contentBlock(part) {
  if (part.type === 'text') return { type: 'text', text: part.text };
  return { type: 'image', source: { type: 'base64', media_type: part.media_type, data: part.data } };
}

function buildFiles(params) {
  const systemPrompt = systemPromptFor(params);
  return systemPrompt ? { [SYSTEM_FILE]: systemPrompt } : undefined;
}

function buildInput(params) {
  if (!hasImages(params)) return params.prompt;
  const message = { role: 'user', content: params.parts.map(contentBlock) };
  return `${JSON.stringify({ type: 'user', message })}\n`;
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

// `--output-format json` prints one object; stream-json prints NDJSON ending in the same object
// as its `result` event.
function resultOf(output) {
  try {
    return JSON.parse(output);
  } catch {
    const lines = (output || '').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]);
        if (event.type === 'result') return event;
      } catch { /* a truncated or foreign line */ }
    }
    return null;
  }
}

function parseOutput(stdout, stderr) {
  const data = resultOf(stdout || stderr);
  if (!data || typeof data !== 'object') {
    return { content: stripNonPrintable(stdout), cost_usd: null, usage: null, metrics: null };
  }

  const content = data.structured_output !== undefined
    ? JSON.stringify(data.structured_output)
    : data.result || data.content || stdout;
  return {
    content: stripNonPrintable(content),
    cost_usd: data.total_cost_usd || data.cost_usd || null,
    usage: usageFrom(data),
    metrics: metricsFrom(data),
  };
}

// Under --json-schema the answer is the input of a StructuredOutput tool call, so it arrives as
// input_json_delta. Any prose around it would corrupt the JSON the caller asked for.
function deltaText(delta, structured) {
  if (structured) return delta?.type === 'input_json_delta' ? delta.partial_json : null;
  return delta?.text;
}

// One NDJSON line of `--output-format stream-json`; anything else is progress noise.
function parseStreamLine(line, { structured = false } = {}) {
  if (!line.trim()) return null;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
    const text = deltaText(event.event.delta, structured);
    return text ? { type: 'delta', content: stripNonPrintable(text) } : null;
  }
  if (event.type === 'result') {
    return {
      type: 'usage',
      usage: usageFrom(event),
      cost_usd: event.total_cost_usd ?? null,
      metrics: metricsFrom(event),
      structured_output: event.structured_output,
    };
  }
  return null;
}

// Shown verbatim when the probe says this provider is not signed in. The updater does the same
// with TRIGGER_HELP: a state nobody can act on is a state reported badly.
const LOGIN_HELP = 'run `claude setup-token` on the host, or set CLAUDE_CODE_OAUTH_TOKEN';

// The token from `claude setup-token` is the only SheLLM setting the CLI may see.
const CLAUDE_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  // An unset value has to stay undefined: spawn() renders a null as the literal string "null".
  CLAUDE_CODE_OAUTH_TOKEN: config.get('CLAUDE_CODE_OAUTH_TOKEN') ?? undefined,
};

// `auth status` reads the stored credentials and prints JSON. It spends no quota, which is the
// whole point: a health probe must not cost a request. It prints the JSON on stdout and exits 1
// when `loggedIn` is false, so the refusal arrives as a rejected execute().
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

// The CLI refuses an over-long prompt before the API call, at no cost, and exits 1 with no
// message: without this the caller got a 502 "Unknown error".
function isPromptTooLong(result) {
  return result?.terminal_reason === 'prompt_too_long';
}

function toProviderError(err, model) {
  const result = resultOf(err.stdout);
  if (result?.api_error_status === 404) return modelNotFound(model);
  if (isPromptTooLong(result)) return contextLengthExceeded(model, result.result);
  return err;
}

// A prose answer where JSON was promised is a failure, not a success with the wrong content.
function noStructuredOutput() {
  return cliFailed('claude', 'response_format json_schema: the CLI returned no structured output');
}

function hasStructuredOutput(stdout) {
  return resultOf(stdout)?.structured_output !== undefined;
}

async function chat({ prompt, parts, system, response_format, model, effort }) {
  const params = { prompt, parts, system, response_format, model, effort };
  const result = await execute('claude', buildArgs(params), { env: CLAUDE_ENV, input: buildInput(params), files: buildFiles(params) })
    .catch((err) => { throw toProviderError(err, model); });
  if (wantsSchema(response_format) && !hasStructuredOutput(result.stdout)) throw noStructuredOutput();
  return parseOutput(result.stdout, result.stderr);
}

async function* chatStream({ prompt, parts, system, response_format, model, effort, signal }) {
  const params = { prompt, parts, system, response_format, model, effort };
  const args = buildStreamArgs(params);
  const structured = wantsSchema(response_format);
  let pending = '';
  let streamed = false;

  function* emit(line) {
    const result = resultOf(line);
    if (isPromptTooLong(result)) throw contextLengthExceeded(model, result.result);
    const parsed = parseStreamLine(line, { structured });
    if (!parsed) return;
    if (parsed.type === 'delta') streamed = true;
    if (parsed.type === 'usage' && structured && !streamed) {
      if (parsed.structured_output === undefined) throw noStructuredOutput();
      streamed = true;
      yield { type: 'delta', content: JSON.stringify(parsed.structured_output) };
    }
    const { structured_output: _, ...event } = parsed;
    yield event;
  }

  for await (const event of executeStream('claude', args, { env: CLAUDE_ENV, signal, input: buildInput(params), files: buildFiles(params) })) {
    if (event.type !== 'chunk') continue;
    pending += event.data;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) yield* emit(line);
  }

  yield* emit(pending);
  yield { type: 'done' };
}

module.exports = {
  name: 'claude',
  models,
  LOGIN_HELP,
  env: CLAUDE_ENV,
  chat,
  chatStream,
  buildArgs,
  buildStreamArgs,
  buildInput,
  buildFiles,
  SYSTEM_FILE,
  ISOLATION_ARGS,
  authProbe,
  parseOutput,
  parseStreamLine,
};
