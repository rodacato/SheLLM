'use strict';

// Asks each CLI what models it offers, then sends every one of them a one-word prompt to find out
// which the account can actually run. A catalog entry the subscription refuses is worse than a
// missing one, and neither CLI reports entitlement — only a real call does.
//
// This spends subscription quota. It reads codex's rate limits either side of the run and prints
// the delta, so the cost of asking is itself measured.

const { spawn } = require('node:child_process');
const claude = require('../src/providers/claude');
const codex = require('../src/providers/codex');

// Every call goes out through the provider's own buildArgs, so what is validated is the path a
// request takes — not the alias the CLI happens to accept. Those differ: SheLLM sends
// `claude-fable`, and only the provider decides whether the prefix comes off before the CLI
// sees it. A probe that skips that step validates a command nobody runs.
const BUILDERS = { claude: claude.buildArgs, codex: codex.buildArgs };

const PROMPT = 'Reply with the single word: ok';
const TIMEOUT_MS = 90_000;

function run(cmd, args, { timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err) }); });
  });
}

function appServer(requests) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const seen = new Map();
    let buffer = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(seen); }, 30_000);

    child.stdout.on('data', (d) => {
      buffer += d;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === undefined) continue;
        seen.set(msg.id, msg.result ?? msg.error);
        if (seen.size > requests.length) { clearTimeout(timer); child.kill(); resolve(seen); }
      }
    });

    const send = (id, method, params = {}) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);

    send(0, 'initialize', { clientInfo: { name: 'shellm-probe', title: 'SheLLM probe', version: '0.0.1' } });
    setTimeout(() => requests.forEach(([id, method]) => send(id, method)), 1500);
    setTimeout(() => { clearTimeout(timer); child.kill(); resolve(seen); }, 12_000);
  });
}

async function codexCatalog() {
  const seen = await appServer([[1, 'model/list']]);
  return (seen.get(1)?.data ?? []).filter((m) => !m.hidden);
}

async function codexRateLimits() {
  const seen = await appServer([[1, 'account/rateLimits/read']]);
  return seen.get(1)?.rateLimits ?? null;
}

// The line reads: "Usage: /model <name>. Available: sonnet, opus, …, or a full model ID."
async function claudeCatalog() {
  const { stdout } = await run('claude', [
    '-p', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '/model',
  ]);
  const available = /Available:\s*([^.]+?)(?:,\s*or a full model ID)?\./.exec(stdout);
  const current = /Current model:\s*`([^`]+)`/.exec(stdout);
  return {
    current: current?.[1] ?? null,
    models: available ? available[1].split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
}

function answered(text) {
  return /\bok\b/i.test(text);
}

const REFUSED = /is not supported when using Codex|invalid_request_error|unrecognized_model|issue with the selected model|isn't described by/;

async function tryModel(provider, id) {
  const args = BUILDERS[provider]({ prompt: PROMPT, model: id });
  const started = Date.now();
  const { stdout, stderr } = await run(provider, args);
  const refused = REFUSED.exec(stdout + stderr);
  return {
    ok: !refused && answered(stdout),
    ms: Date.now() - started,
    sent: (() => {
      const i = args.indexOf(provider === 'codex' ? '-m' : '--model');
      return i === -1 ? "(the CLI's own default)" : args[i + 1];
    })(),
    why: refused ? 'refused' : null,
  };
}

function row(id, res, note = '') {
  const mark = res.ok ? 'ok  ' : 'FAIL';
  const sent = res.sent === id ? '' : ` -> ${res.sent}`;
  console.log(`  ${mark}  ${String(res.ms).padStart(6)} ms  ${id}${sent}${note}${res.why ? `  ${res.why}` : ''}`);
}

async function main() {
  const before = await codexRateLimits();

  console.log('\ncodex — catalog from model/list');
  const codexModels = await codexCatalog();
  if (codexModels.length === 0) console.log('  (model/list returned nothing)');
  for (const m of codexModels) row(m.id, await tryModel('codex', m.id), m.isDefault ? '  (default)' : '');
  row('codex', await tryModel('codex', 'codex'), '  (bare)');

  console.log('\nclaude — aliases from /model');
  const { current, models: claudeModels } = await claudeCatalog();
  console.log(`  current: ${current ?? 'unknown'}`);
  const bases = claudeModels.filter((m) => !m.endsWith('[1m]'));
  for (const alias of bases) row(`claude-${alias}`, await tryModel('claude', `claude-${alias}`));
  row('claude', await tryModel('claude', 'claude'), '  (bare)');

  const after = await codexRateLimits();
  console.log('\ncodex rate limits, either side of this run');
  for (const [label, win] of [['primary', 'primary'], ['secondary', 'secondary']]) {
    const b = before?.[win];
    const a = after?.[win];
    if (!b || !a) { console.log(`  ${label}: unavailable`); continue; }
    console.log(`  ${label.padEnd(10)} ${b.usedPercent}% -> ${a.usedPercent}%   window ${b.windowDurationMins} min`);
  }
  console.log(`  plan: ${after?.planType ?? 'unknown'}\n`);
}

main();
