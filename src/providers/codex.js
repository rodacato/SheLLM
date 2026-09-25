const { execute, executeStream, stripNonPrintable } = require('./base');
const { modelNotFound, rateLimited, cliFailed, invalidRequest } = require('../errors');
const { createMutex } = require('../infra/provider-lock');

// Codex CLI needs config/data paths for auth tokens
const CODEX_ENV = {
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};

const MODEL_PREFIX = 'codex-';
const models = ['codex'];

// Two codex processes race on the OAuth refresh and corrupt it (openai/codex#17340).
const lock = createMutex();

// Runs fn with the provider's process slot held. Health probes spawn codex too, so they take
// the same lock or they race the refresh they are supposed to be reporting on.
async function withLock(fn) {
  const release = await lock();
  try {
    return await fn();
  } finally {
    release();
  }
}

const LOGIN_HELP = 'run `codex login` on the host as the service user';

// `login status` proves credentials are stored, not that they still refresh: it answered
// "Logged in using ChatGPT" here while every call failed with an expired refresh token. That is
// the honest limit of a free probe — a dead token surfaces on the first real request instead.
//
// It writes both verdicts to stderr and leaves stdout empty, and exits 1 for the negative one.
// "Not logged in" contains "logged in", so the refusal has to be matched first.
const authProbe = {
  args: ['login', 'status'],
  parse(stdout, stderr) {
    const said = `${stdout || ''}${stderr || ''}`;
    if (/not logged in/i.test(said)) return false;
    if (/logged in/i.test(said)) return true;
    return null;
  },
};

function cliModel(model) {
  if (!model || model === 'codex') return defaultModel();
  return model.startsWith(MODEL_PREFIX) ? model.slice(MODEL_PREFIX.length) : model;
}

// Without -m the CLI falls back to whatever config.toml names, and a ChatGPT account answers
// "model is not supported" to it. The catalog carries the default the CLI itself reports.
function defaultModel() {
  const { bakedDefault } = require('../infra/model-catalog');
  const id = bakedDefault('codex');
  return id && id.startsWith(MODEL_PREFIX) ? id.slice(MODEL_PREFIX.length) : null;
}

// Codex has no --system-prompt flag — prepend to prompt
function buildPrompt({ prompt, system, response_format }) {
  const jsonMode = response_format?.type === 'json_object';
  const systemText = jsonMode && system
    ? system + '\n\nRespond with valid JSON only.'
    : jsonMode ? 'Respond with valid JSON only.'
    : system;
  return systemText ? `${systemText}\n\n---\n\n${prompt}` : prompt;
}

// Relative to the request's working directory, which is where base.js writes request files.
const SCHEMA_FILE = 'output-schema.json';

function wantsSchema(response_format) {
  return response_format?.type === 'json_schema';
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function imagesOf(parts) {
  return (parts || []).filter((part) => part.type === 'image');
}

// The prompt names each image "[image N]"; the files follow the same numbering.
function imageFile(image) {
  return `image-${image.number}.${EXTENSIONS[image.media_type]}`;
}

function buildArgs({ prompt, parts, system, response_format, model, effort }) {
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json'];
  if (cliModel(model)) args.push('-m', cliModel(model));
  // Without a level codex keeps its own configuration's.
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  if (wantsSchema(response_format)) args.push('--output-schema', SCHEMA_FILE);
  const images = imagesOf(parts);
  for (const image of images) args.push('-i', imageFile(image));
  // -i takes several values, so without the separator the prompt would be read as one more image.
  if (images.length > 0) args.push('--');
  args.push(buildPrompt({ prompt, system, response_format }));
  return args;
}

function buildFiles({ parts, response_format }) {
  const files = {};
  if (wantsSchema(response_format)) files[SCHEMA_FILE] = JSON.stringify(response_format.json_schema.schema);
  for (const image of imagesOf(parts)) files[imageFile(image)] = Buffer.from(image.data, 'base64');
  return Object.keys(files).length > 0 ? files : undefined;
}

// A JSONL line is a codex event only if it carries an event type; anything else is output
// from some other shape entirely, and parseOutput falls back to the raw text for it.
function parseLine(line) {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    return typeof parsed?.type === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

// A failed turn is reported as an event and the process can still exit 0
// (openai/codex#1018), so the events decide what went wrong, never the exit code.
function failureFrom(event, model) {
  const raw = event.type === 'turn.failed' ? event.error?.message
    : event.type === 'error' ? event.message
    : null;
  if (!raw) return null;

  let status = null;
  let code = null;
  let message = raw;
  try {
    const payload = JSON.parse(raw);
    status = payload.status ?? null;
    code = payload.error?.code ?? null;
    message = payload.error?.message || raw;
  } catch { /* the message is plain text */ }

  // OpenAI's strict mode refuses the schema before the model runs; the caller has to fix it.
  if (code === 'invalid_json_schema') return invalidRequest(`codex: ${message}`);
  if (status === 429 || /usage limit|rate limit|quota/i.test(message)) {
    return rateLimited(`codex: ${message}`);
  }
  if (/not supported|model metadata/i.test(message)) return modelNotFound(model);
  return cliFailed('codex', message);
}

// A counter the CLI never sent stays absent, so the log keeps "not reported" (NULL) and a
// measured zero apart.
function reported(value) {
  return typeof value === 'number' ? value : null;
}

// codex breaks its cache counters out OF input_tokens, the shared usage shape is Anthropic's
// (input_tokens is the fresh remainder), and subtracting here is what keeps one logging path.
function usageFrom(event) {
  if (!event.usage) return null;
  const cacheRead = reported(event.usage.cached_input_tokens);
  const cacheWrite = reported(event.usage.cache_write_input_tokens);
  const usage = {
    input_tokens: Math.max((event.usage.input_tokens || 0) - (cacheRead || 0) - (cacheWrite || 0), 0),
    output_tokens: event.usage.output_tokens || 0,
  };
  if (cacheRead !== null) usage.cache_read_input_tokens = cacheRead;
  if (cacheWrite !== null) usage.cache_creation_input_tokens = cacheWrite;
  return usage;
}

function parseOutput(stdout, model) {
  let content = '';
  let usage = null;
  let failure = null;
  let sawEvent = false;

  for (const line of stdout.split('\n')) {
    const event = parseLine(line);
    if (!event) continue;
    sawEvent = true;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      content = event.item.text || '';
    }
    if (event.type === 'turn.completed') usage = usageFrom(event);
    failure = failure || failureFrom(event, model);
  }

  return { content: stripNonPrintable(sawEvent ? content : stdout), cost_usd: null, usage, failure };
}

function toProviderError(err, model) {
  const failure = err.stdout ? parseOutput(err.stdout, model).failure : null;
  return failure || err;
}

async function chat({ prompt, parts, system, response_format, model, effort }) {
  const args = buildArgs({ prompt, parts, system, response_format, model, effort });
  const files = buildFiles({ parts, response_format });
  return withLock(async () => {
    const result = await execute('codex', args, { env: CODEX_ENV, files })
      .catch((err) => { throw toProviderError(err, model); });
    const { failure, ...parsed } = parseOutput(result.stdout, model);
    if (failure) throw failure;
    return parsed;
  });
}

async function* chatStream({ prompt, parts, system, response_format, model, effort, signal }) {
  const args = buildArgs({ prompt, parts, system, response_format, model, effort });
  const files = buildFiles({ parts, response_format });
  const release = await lock();
  let failure = null;
  try {
    let pending = '';
    try {
      for await (const chunk of executeStream('codex', args, { env: CODEX_ENV, signal, files })) {
        if (chunk.type !== 'chunk') continue;
        pending += chunk.data;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          const event = parseLine(line);
          if (!event) continue;
          failure = failure || failureFrom(event, model);
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
            yield { type: 'delta', content: stripNonPrintable(event.item.text) };
          }
          if (event.type === 'turn.completed' && event.usage) {
            yield { type: 'usage', usage: usageFrom(event), cost_usd: null };
          }
        }
      }
    } catch (err) {
      throw failure || toProviderError(err, model);
    }
    if (failure) throw failure;
    yield { type: 'done' };
  } finally {
    release();
  }
}

module.exports = {
  name: 'codex',
  models,
  LOGIN_HELP,
  env: CODEX_ENV,
  chat,
  chatStream,
  buildArgs,
  buildFiles,
  parseOutput,
  failureFrom,
  authProbe,
  withLock,
};
