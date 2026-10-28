'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_FILE } = require('./paths');
const config = require('../config');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const CLAUDE_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';
const CLI_PINS = require('../../config/cli-versions/package.json').dependencies;
const VPS_SCRIPT = path.resolve(__dirname, '../../scripts/setup/vps.sh');
const PIN_FIX = `sudo bash ${VPS_SCRIPT} to install the pinned version, or move the pin in config/cli-versions/package.json`;

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

const NODE_FLOOR = require('../../package.json').engines.node.replace(/^>=\s*/, '');

function versionParts(version) {
  return version.replace(/^v/, '').split('.').map(Number);
}

function isBelow(version, floor) {
  const a = versionParts(version);
  const b = versionParts(floor);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}

// A CLI that drifted from its pin still answers, so this warns: the combination is untested, not broken.
function checkPin(name, pkg, versionOutput) {
  const installed = /\d+\.\d+\.\d+/.exec(versionOutput)?.[0] ?? versionOutput.trim();
  const pinned = CLI_PINS[pkg];
  if (installed === pinned) return pass(name, `${installed}, the pinned version`);
  return warn(name, `${installed}, pinned ${pinned}`, PIN_FIX);
}

// The floor is the newest patch release SheLLM was tested against; an older 24.x still runs.
function checkNode(version = process.versions.node) {
  if (versionParts(version)[0] < 24) {
    return fail('Node.js', `v${version}, SheLLM needs 24 or newer`, 'nvm install 24 && nvm use 24');
  }
  if (isBelow(version, NODE_FLOOR)) {
    return warn('Node.js', `v${version} is older than ${NODE_FLOOR}`, 'sudo apt-get update && sudo apt-get install --only-upgrade nodejs');
  }
  return pass('Node.js', `v${version}`);
}

function checkConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return fail('Config file', `${CONFIG_FILE} does not exist`, 'shellm init');
  const mode = fs.statSync(CONFIG_FILE).mode & 0o777;
  if (mode & 0o077) return fail('Config file', `${CONFIG_FILE} is readable by other users (${mode.toString(8)})`, `chmod 600 ${CONFIG_FILE}`);
  return pass('Config file', CONFIG_FILE);
}

function checkHost() {
  const hosts = config.get('HOST');
  const exposed = hosts.filter((host) => !LOOPBACK_HOSTS.has(host));
  if (exposed.length === 0) return pass('Bind address', hosts.join(','));
  return warn('Bind address', `HOST=${hosts.join(',')} exposes SheLLM beyond loopback on ${exposed.join(',')}`, `set HOST=127.0.0.1 in ${CONFIG_FILE}, or keep only internal addresses a firewall guards`);
}

async function checkClaude() {
  const version = await exec('claude', ['--version'], { PATH: process.env.PATH, HOME: process.env.HOME });
  if (!version.ok) {
    const detail = version.missing ? 'not found on PATH' : version.stderr.trim();
    return [fail('Claude CLI', detail, CLAUDE_INSTALL), fail('Claude login', 'skipped, the CLI is not usable', CLAUDE_INSTALL)];
  }

  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const token = config.get('CLAUDE_CODE_OAUTH_TOKEN');
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  const status = await exec('claude', ['auth', 'status', '--json'], env);
  let auth = {};
  try { auth = JSON.parse(status.stdout); } catch { /* reported below */ }

  const installed = checkPin('Claude CLI', '@anthropic-ai/claude-code', version.stdout);
  if (!auth.loggedIn) return [installed, fail('Claude login', 'not logged in', `claude setup-token, then add CLAUDE_CODE_OAUTH_TOKEN to ${CONFIG_FILE}`)];
  // auth status accepts any token string, so only --live proves the token works.
  if (auth.authMethod === 'oauth_token') return [installed, pass('Claude login', 'CLAUDE_CODE_OAUTH_TOKEN set (validity checked only with --live)')];
  // A file session expires on its own and nothing renews it for a service, so the token is the path.
  return [installed, warn('Claude login', `${auth.authMethod} session, which expires; the service is meant to run on CLAUDE_CODE_OAUTH_TOKEN`, `claude setup-token, then add CLAUDE_CODE_OAUTH_TOKEN to ${CONFIG_FILE}`)];
}

async function checkCodex() {
  // The unit puts ~/.npm-global/bin on PATH, where vps.sh installs codex; a login shell usually does not.
  const env = { PATH: `${process.env.PATH}:${path.join(process.env.HOME, '.npm-global', 'bin')}`, HOME: process.env.HOME };
  const version = await exec('codex', ['--version'], env);
  if (!version.ok) {
    const detail = version.missing ? 'not found on PATH, the codex provider cannot answer' : version.stderr.trim();
    return warn('Codex CLI', detail, PIN_FIX);
  }
  return checkPin('Codex CLI', '@openai/codex', version.stdout);
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

// Settings a release introduced that this config has never been shown. The operator learns about
// a new knob here rather than from a failure weeks later; `shellm config --new` prints them.
function checkNewSettings() {
  const names = config.unseen();
  if (names.length === 0) return pass('Settings', 'nothing new since this release');
  return warn('Settings', `${names.length} available and unset: ${names.join(', ')}`, 'shellm config --new');
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
  const results = [checkNode(), checkConfig(), checkHost(), ...(await checkClaude()), await checkCodex(), checkApiKeys(), checkNewSettings()];
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

module.exports = { run, diagnose, report, checkNode, NODE_FLOOR };
