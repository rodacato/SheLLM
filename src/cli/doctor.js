'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { CONFIG_FILE } = require('./paths');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const CLAUDE_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';

function exec(command, args, env) {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, missing: err?.code === 'ENOENT', stdout, stderr });
    });
  });
}

function pass(name, detail) { return { level: 'pass', name, detail }; }
function warn(name, detail, fix) { return { level: 'warn', name, detail, fix }; }
function fail(name, detail, fix) { return { level: 'fail', name, detail, fix }; }

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 24) return pass('Node.js', process.version);
  return fail('Node.js', `${process.version}, SheLLM needs 24 or newer`, 'nvm install 24 && nvm use 24');
}

function checkConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return fail('Config file', `${CONFIG_FILE} does not exist`, 'shellm init');
  const mode = fs.statSync(CONFIG_FILE).mode & 0o777;
  if (mode & 0o077) return fail('Config file', `${CONFIG_FILE} is readable by other users (${mode.toString(8)})`, `chmod 600 ${CONFIG_FILE}`);
  return pass('Config file', CONFIG_FILE);
}

function checkHost() {
  const host = process.env.HOST || '127.0.0.1';
  if (LOOPBACK_HOSTS.has(host)) return pass('Bind address', host);
  return warn('Bind address', `HOST=${host} exposes SheLLM beyond this machine`, `set HOST=127.0.0.1 in ${CONFIG_FILE}`);
}

async function checkClaude() {
  const version = await exec('claude', ['--version'], { PATH: process.env.PATH, HOME: process.env.HOME });
  if (!version.ok) {
    const detail = version.missing ? 'not found on PATH' : version.stderr.trim();
    return [fail('Claude CLI', detail, CLAUDE_INSTALL), fail('Claude login', 'skipped, the CLI is not usable', CLAUDE_INSTALL)];
  }

  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const status = await exec('claude', ['auth', 'status', '--json'], env);
  let auth = {};
  try { auth = JSON.parse(status.stdout); } catch { /* reported below */ }

  const installed = pass('Claude CLI', version.stdout.trim());
  if (!auth.loggedIn) return [installed, fail('Claude login', 'not logged in', `claude setup-token, then add CLAUDE_CODE_OAUTH_TOKEN to ${CONFIG_FILE}`)];
  // auth status accepts any token string, so only --live proves the token works.
  if (auth.authMethod === 'oauth_token') return [installed, pass('Claude login', 'CLAUDE_CODE_OAUTH_TOKEN set (validity checked only with --live)')];
  return [installed, pass('Claude login', auth.authMethod)];
}

function checkApiKeys() {
  try {
    const { initDb, listClients } = require('../db');
    initDb();
    const active = listClients().filter((client) => client.active).length;
    if (active > 0) return pass('API keys', `${active} active`);
    return fail('API keys', 'no active key, requests will be rejected', 'shellm init');
  } catch (err) {
    return fail('API keys', `database unavailable: ${err.message}`, 'shellm init');
  }
}

async function checkLive() {
  try {
    const { content } = await require('../providers/claude').chat({ prompt: 'Reply with the single word OK.', model: 'claude-haiku' });
    if (/\bOK\b/i.test(content)) return pass('Live request', 'claude-haiku answered');
    return fail('Live request', `unexpected answer: ${content.slice(0, 80)}`, 'claude -p --model haiku "Reply with OK"');
  } catch (err) {
    return fail('Live request', (err.message || err.stderr || 'failed').slice(0, 200), 'claude -p --model haiku "Reply with OK"');
  }
}

const SYMBOLS = { pass: '✓', warn: '!', fail: '✗' };

function report(results) {
  for (const { level, name, detail, fix } of results) {
    console.log(`  ${SYMBOLS[level]} ${name}: ${detail}`);
    if (fix && level !== 'pass') console.log(`      fix: ${fix}`);
  }
}

async function diagnose({ live = false } = {}) {
  require('dotenv').config({ path: CONFIG_FILE, quiet: true });
  const results = [checkNode(), checkConfig(), checkHost(), ...(await checkClaude()), checkApiKeys()];
  if (live) results.push(await checkLive());
  return results;
}

async function run(args = []) {
  const results = await diagnose({ live: args.includes('--live') });
  report(results);
  const failures = results.filter((r) => r.level === 'fail').length;
  console.log('');
  console.log(failures ? `${failures} check(s) failed.` : 'All checks passed.');
  process.exitCode = failures ? 1 : 0;
}

module.exports = { run, diagnose, report };
