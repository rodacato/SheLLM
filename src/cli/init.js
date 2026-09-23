'use strict';

const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const dotenv = require('dotenv');
const { CONFIG_FILE } = require('./paths');

const DEFAULTS = {
  PORT: '6100',
  HOST: '127.0.0.1',
  MAX_CONCURRENT: '4',
  MAX_STREAM_CONCURRENT: '4',
  SHELLM_GLOBAL_RPM: '60',
};

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { text: '', values: {} };
  const text = fs.readFileSync(CONFIG_FILE, 'utf8');
  return { text, values: dotenv.parse(text) };
}

async function askToken() {
  console.log('Claude needs a long-lived token for the user that runs SheLLM.');
  console.log('Run `claude setup-token` in another terminal and paste the token here.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Token (Enter to skip if claude is already logged in for this user): ')).trim();
  } finally {
    rl.close();
  }
}

async function collectMissing(values) {
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!values[key]) missing[key] = value;
  }
  if (!values.SHELLM_ADMIN_PASSWORD) missing.SHELLM_ADMIN_PASSWORD = randomBytes(24).toString('base64url');
  if (!values.CLAUDE_CODE_OAUTH_TOKEN) {
    const token = await askToken();
    if (token) missing.CLAUDE_CODE_OAUTH_TOKEN = token;
  }
  return missing;
}

function writeConfig(text, additions) {
  const lines = Object.entries(additions).map(([key, value]) => `${key}=${value}`);
  if (lines.length === 0) return;
  const separator = text && !text.endsWith('\n') ? '\n' : '';
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, `${text}${separator}${lines.join('\n')}\n`, { mode: 0o600 });
}

function ensureApiKey() {
  const { initDb, listClients, createClient } = require('../db');
  initDb();
  if (listClients().some((client) => client.active)) return null;
  return createClient({ name: 'default', rpm: 60 }).rawKey;
}

function printUsage(config, rawKey) {
  const base = `http://${config.HOST}:${config.PORT}`;
  const key = rawKey || '<your SheLLM API key>';
  console.log(`
Start SheLLM:
  shellm start

Dashboard:
  ${base}/admin/dashboard/
  Any username works unless SHELLM_ADMIN_USER is set; the password is
  SHELLM_ADMIN_PASSWORD in ${CONFIG_FILE}

Try it:
  curl ${base}/v1/chat/completions \\
    -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
    -d '{"model": "claude-haiku", "messages": [{"role": "user", "content": "Hello"}]}'

Official SDKs read these:
  export OPENAI_BASE_URL=${base}/v1 OPENAI_API_KEY=${key}
  export ANTHROPIC_BASE_URL=${base} ANTHROPIC_API_KEY=${key}

Node:
  const client = new Anthropic();
  await client.messages.create({ model: 'claude-haiku', max_tokens: 256, messages: [{ role: 'user', content: 'Hello' }] });

Ruby:
  client = Anthropic::Client.new(api_key: ENV["ANTHROPIC_API_KEY"], base_url: ENV["ANTHROPIC_BASE_URL"])
  client.messages.create(model: "claude-haiku", max_tokens: 256, messages: [{ role: "user", content: "Hello" }])
`);
}

async function run() {
  const { text, values } = readConfig();
  const additions = await collectMissing(values);
  writeConfig(text, additions);
  if (fs.existsSync(CONFIG_FILE)) fs.chmodSync(CONFIG_FILE, 0o600);

  const config = { ...values, ...additions };
  Object.assign(process.env, config);
  console.log(`Config: ${CONFIG_FILE}${Object.keys(additions).length ? ` (added ${Object.keys(additions).join(', ')})` : ' (unchanged)'}`);

  const rawKey = ensureApiKey();
  if (rawKey) console.log(`\nAPI key (shown once, store it now): ${rawKey}`);
  if (additions.SHELLM_ADMIN_PASSWORD) {
    console.log(`Admin password (shown once, store it now): ${additions.SHELLM_ADMIN_PASSWORD}`);
  }

  printUsage(config, rawKey);

  const { diagnose, report } = require('./doctor');
  const results = await diagnose();
  console.log('Doctor:');
  report(results);
  process.exitCode = results.some((r) => r.level === 'fail') ? 1 : 0;
}

module.exports = { run };
