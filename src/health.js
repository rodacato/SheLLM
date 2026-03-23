const { execute } = require('./providers/base');
const { queue } = require('./router');
const { getAllCircuitStates, resetCircuit } = require('./circuit-breaker');
const logger = require('./lib/logger');

const CACHE_TTL_MS = parseInt(process.env.HEALTH_CACHE_TTL_MS || '30000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.HEALTH_POLL_INTERVAL_MS || '300000', 10);
const DEEP_CHECK_TIMEOUT = 15000;
const ALERT_WEBHOOK_URL = process.env.SHELLM_ALERT_WEBHOOK_URL || null;

let cache = { data: null, expires: 0 };
let pollerInterval = null;
let previousStatus = {};

// --- Shallow checks (fast, used by lazy health endpoint) ---

async function checkCLI(name, command, testArgs, { timeout = 10000 } = {}) {
  try {
    await execute(command, testArgs, { timeout });
    return { installed: true, authenticated: true };
  } catch (err) {
    return parseCheckError(err);
  }
}

async function checkCerebras() {
  if (!process.env.CEREBRAS_API_KEY) {
    return { installed: true, authenticated: false, error: 'CEREBRAS_API_KEY not set' };
  }
  return { installed: true, authenticated: true };
}

// --- Deep checks (slower, used by poller to detect session-level auth expiry) ---

const DEEP_CHECK_CONFIG = {
  claude: { command: 'claude', args: ['--print', '--dangerously-skip-permissions', '--', 'test'] },
  gemini: { command: 'gemini', args: ['--approval-mode', 'yolo', '-p', 'test'] },
  codex: { command: 'codex', args: ['exec', '--ephemeral', '--skip-git-repo-check', 'test'] },
};

async function checkCLIDeep(name) {
  const config = DEEP_CHECK_CONFIG[name];
  if (!config) return checkCLI(name, name, ['--version']);
  try {
    await execute(config.command, config.args, { timeout: DEEP_CHECK_TIMEOUT });
    return { installed: true, authenticated: true };
  } catch (err) {
    return parseCheckError(err);
  }
}

async function checkCerebrasDeep() {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) return { installed: true, authenticated: false, error: 'CEREBRAS_API_KEY not set' };
  try {
    const res = await fetch('https://api.cerebras.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(DEEP_CHECK_TIMEOUT),
    });
    if (res.ok) return { installed: true, authenticated: true };
    return { installed: true, authenticated: false, error: `API returned ${res.status}` };
  } catch {
    return { installed: true, authenticated: false, error: 'API unreachable' };
  }
}

function parseCheckError(err) {
  const stderr = err.stderr || '';
  const lower = stderr.toLowerCase();
  // Keychain fallback with cached credentials means auth works — check first
  // because the message may contain "not found" for libsecret
  if (lower.includes('loaded cached credentials') || lower.includes('filekeychain fallback')) {
    return { installed: true, authenticated: true };
  }
  if (err.code === -1 || stderr.includes('ENOENT') || lower.includes('command not found')) {
    return { installed: false, authenticated: false };
  }
  if (lower.includes('not authenticated') || lower.includes('please login') || lower.includes('auth required') || lower.includes('unauthenticated')) {
    return { installed: true, authenticated: false };
  }
  // Gemini yolo/approval-mode warnings are harmless — process exited non-zero
  // but stderr only contains mode warnings, not auth errors
  if (lower.includes('yolo') || lower.includes('approval') || lower.includes('auto-approv')) {
    return { installed: true, authenticated: true };
  }
  const redacted = stderr
    .replace(/(sk-|csk-|key-|shellm-)[A-Za-z0-9_-]{10,}/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED]')
    .slice(0, 200);
  return { installed: true, authenticated: false, error: redacted };
}

// --- Health status ---

async function getHealthStatus() {
  const now = Date.now();

  if (cache.data && now < cache.expires) {
    return {
      ...cache.data,
      queue: queue.stats,
      uptime_seconds: Math.floor(process.uptime()),
    };
  }

  const [claudeStatus, geminiStatus, codexStatus, cerebrasStatus] = await Promise.all([
    checkCLI('claude', 'claude', ['--version']),
    checkCLI('gemini', 'gemini', ['--version']),
    checkCLI('codex', 'codex', ['--version']),
    checkCerebras(),
  ]);

  const providers = mergeEnabledStatus({ claude: claudeStatus, gemini: geminiStatus, codex: codexStatus, cerebras: cerebrasStatus });
  const status = computeHealthStatus(providers);
  cache = { data: { status, providers }, expires: now + CACHE_TTL_MS };

  return {
    ...cache.data,
    circuit_breakers: getAllCircuitStates(),
    queue: queue.stats,
    uptime_seconds: Math.floor(process.uptime()),
  };
}

function mergeEnabledStatus(providerStatuses) {
  const { getProviderSettings } = require('./db');
  const enabledMap = {};
  try {
    const rows = getProviderSettings();
    for (const row of rows) enabledMap[row.name] = !!row.enabled;
  } catch { /* DB might not be initialized */ }

  const result = {};
  for (const [name, status] of Object.entries(providerStatuses)) {
    result[name] = { ...status, enabled: enabledMap[name] ?? true };
  }
  return result;
}

function computeHealthStatus(providers) {
  const entries = Object.values(providers);
  const enabled = entries.filter((p) => p.enabled !== false);
  if (enabled.length === 0) return 'ok';
  const healthy = enabled.filter((p) => p.authenticated !== false);
  if (healthy.length === 0) return 'down';
  if (healthy.length < enabled.length) return 'degraded';
  return 'ok';
}

function getCachedProviderStatus(providerName) {
  if (cache.data && Date.now() < cache.expires) {
    return cache.data.providers[providerName] || null;
  }
  return null;
}

// --- Background health poller ---

function sendAlertWebhook(provider, from, to) {
  if (!ALERT_WEBHOOK_URL) return;
  const status = to.authenticated ? 'healthy' : 'unhealthy';
  const payload = {
    text: `[SheLLM] Provider \`${provider}\` is now **${status}**${to.error ? `: ${to.error}` : ''}`,
    provider,
    from: { authenticated: from.authenticated, installed: from.installed },
    to: { authenticated: to.authenticated, installed: to.installed },
    timestamp: new Date().toISOString(),
  };
  fetch(ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => logger.error({ event: 'alert_webhook_error', error: err.message }));
}

async function pollAllProviders({ deep = false } = {}) {
  try {
    const check = deep ? checkCLIDeep : (name) => checkCLI(name, name, ['--version']);
    const results = await Promise.allSettled([
      check('claude'),
      check('gemini'),
      check('codex'),
      deep ? checkCerebrasDeep() : checkCerebras(),
    ]);

    const names = ['claude', 'gemini', 'codex', 'cerebras'];
    const statuses = {};

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const result = results[i];
      const status = result.status === 'fulfilled' ? result.value : { installed: false, authenticated: false, error: String(result.reason) };
      statuses[name] = status;

      const prev = previousStatus[name];
      const changed = !prev || prev.authenticated !== status.authenticated || prev.installed !== status.installed;

      if (changed && prev) {
        logger.warn({ event: 'health_transition', provider: name, from: { authenticated: prev.authenticated, installed: prev.installed }, to: { authenticated: status.authenticated, installed: status.installed } });
        sendAlertWebhook(name, prev, status);
        // Reset circuit breaker when provider recovers
        if (status.authenticated && !prev.authenticated) {
          resetCircuit(name);
        }
      }

      logger.debug({ event: 'health_poll', provider: name, installed: status.installed, authenticated: status.authenticated, changed });
    }

    previousStatus = { ...statuses };

    const providers = mergeEnabledStatus(statuses);
    cache = { data: { status: 'ok', providers }, expires: Date.now() + POLL_INTERVAL_MS + 5000 };
  } catch (err) {
    logger.error({ event: 'health_poll_error', error: err.message });
  }
}

function startHealthPoller() {
  pollAllProviders({ deep: true });
  pollerInterval = setInterval(() => pollAllProviders({ deep: false }), POLL_INTERVAL_MS);
  pollerInterval.unref();
  return pollerInterval;
}

function stopHealthPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

module.exports = { getHealthStatus, getCachedProviderStatus, startHealthPoller, stopHealthPoller, parseCheckError };
