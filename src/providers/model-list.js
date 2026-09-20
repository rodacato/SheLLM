'use strict';

const { spawn } = require('node:child_process');
const { buildSafeEnv, execute } = require('./base');

const LIST_TIMEOUT_MS = 25_000;

// The app server speaks newline-delimited JSON-RPC over stdio and answers nothing until it has
// been initialized, so a caller cannot simply pipe one request in and read one line out.
function appServerCall(method, { env, timeout = LIST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], env: buildSafeEnv(env) });
    } catch {
      return resolve(null);
    }

    let buffer = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);

    child.on('error', () => finish(null));
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) finish(msg.result ?? null);
      }
    });

    const send = (id, name, params = {}) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: name, params })}\n`);

    send(0, 'initialize', { clientInfo: { name: 'shellm', title: 'SheLLM', version: '1' } });
    setTimeout(() => { if (!settled) send(1, method); }, 1500);
  });
}

function codexEntry(model) {
  return {
    id: `codex-${model.id}`,
    label: model.displayName || model.id,
    description: model.description || null,
    isDefault: Boolean(model.isDefault),
    retiresAt: model.upgradeInfo?.retirementAt
      ? new Date(model.upgradeInfo.retirementAt * 1000).toISOString().slice(0, 10)
      : null,
    upgradeTo: model.upgrade ? `codex-${model.upgrade}` : null,
  };
}

async function listCodexModels({ env } = {}) {
  const result = await appServerCall('model/list', { env });
  const data = result?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  return data.filter((m) => m && m.id && !m.hidden).map(codexEntry);
}

// `/model` is answered by the CLI itself rather than by the API, so this costs no tokens. Its one
// line carries the aliases; the `[1m]` entries are context-window variants of a model already
// listed, not models of their own.
const AVAILABLE = /Available:\s*([^.]+?)(?:,\s*or a full model ID)?\s*\./;

function parseClaudeModels(stdout) {
  const match = AVAILABLE.exec(String(stdout));
  if (!match) return null;
  const aliases = match[1].split(',').map((s) => s.trim()).filter((s) => s && !s.endsWith('[1m]'));
  if (aliases.length === 0) return null;
  return aliases.map((alias) => ({
    id: `claude-${alias}`,
    label: alias,
    description: null,
    isDefault: false,
    retiresAt: null,
    upgradeTo: null,
  }));
}

async function listClaudeModels({ env, run = execute } = {}) {
  try {
    const { stdout } = await run('claude', [
      '-p', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '/model',
    ], { timeout: LIST_TIMEOUT_MS, env });
    return parseClaudeModels(stdout);
  } catch {
    return null;
  }
}

module.exports = { listCodexModels, listClaudeModels, parseClaudeModels, appServerCall };
