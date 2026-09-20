const { execute, executeStream, stripNonPrintable } = require('./base');
const { modelNotFound, rateLimited, cliFailed } = require('../errors');
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
const authProbe = {
  args: ['login', 'status'],
  parse: () => true,
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

function buildArgs({ prompt, system, response_format, model }) {
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json'];
  if (cliModel(model)) args.push('-m', cliModel(model));
  args.push(buildPrompt({ prompt, system, response_format }));
  return args;
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
  let message = raw;
  try {
    const payload = JSON.parse(raw);
    status = payload.status ?? null;
    message = payload.error?.message || raw;
  } catch { /* the message is plain text */ }

  if (status === 429 || /usage limit|rate limit|quota/i.test(message)) {
    return rateLimited(`codex: ${message}`);
  }
  if (/not supported|model metadata/i.test(message)) return modelNotFound(model);
  return cliFailed('codex', message);
}

function usageFrom(event) {
  if (!event.usage) return null;
  return {
    input_tokens: event.usage.input_tokens || 0,
    output_tokens: event.usage.output_tokens || 0,
  };
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

async function chat({ prompt, system, response_format, model }) {
  const args = buildArgs({ prompt, system, response_format, model });
  return withLock(async () => {
    const result = await execute('codex', args, { env: CODEX_ENV })
      .catch((err) => { throw toProviderError(err, model); });
    const { failure, ...parsed } = parseOutput(result.stdout, model);
    if (failure) throw failure;
    return parsed;
  });
}

async function* chatStream({ prompt, system, response_format, model, signal }) {
  const args = buildArgs({ prompt, system, response_format, model });
  const release = await lock();
  let failure = null;
  try {
    let pending = '';
    try {
      for await (const chunk of executeStream('codex', args, { env: CODEX_ENV, signal })) {
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
  parseOutput,
  failureFrom,
  authProbe,
  withLock,
};
