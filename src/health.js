const { execute } = require('./providers/base');
const { queue } = require('./router');
const { getAllCircuitStates, resetCircuit } = require('./circuit-breaker');
const logger = require('./lib/logger');

const DEEP_CHECK_TIMEOUT = 15000;

function getCacheTtl() {
  try { const { getSetting } = require('./db/settings'); return getSetting('health_cache_ttl_ms'); }
  catch { return parseInt(process.env.HEALTH_CACHE_TTL_MS || '30000', 10); }
}
function getPollInterval() {
  try { const { getSetting } = require('./db/settings'); return getSetting('health_poll_interval_ms'); }
  catch { return parseInt(process.env.HEALTH_POLL_INTERVAL_MS || '300000', 10); }
}
function getAlertWebhookUrl() {
  try { const { getSetting } = require('./db/settings'); return getSetting('alert_webhook_url'); }
  catch { return process.env.SHELLM_ALERT_WEBHOOK_URL || null; }
}

let cache = { data: null, expires: 0 };
let pollerInterval = null;
let previousStatus = {};

// --- Provider list from DB (with fallback) ---

function getProviderList() {
  try {
    const { getProviders, getDb } = require('./db');
    if (!getDb()) throw new Error('DB not initialized');
    return getProviders();
  } catch {
    // Fallback for tests/early boot — hardcoded defaults
    return [
      { name: 'claude', type: 'subprocess', enabled: 1, health_check: { command: 'claude', args: ['--print', '--dangerously-skip-permissions', '--', 'test'] } },
      { name: 'gemini', type: 'subprocess', enabled: 1, health_check: { command: 'gemini', args: ['--approval-mode', 'yolo', '-p', 'test'] } },
      { name: 'codex', type: 'subprocess', enabled: 1, health_check: { command: 'codex', args: ['exec', '--ephemeral', '--skip-git-repo-check', 'test'] } },
      { name: 'cerebras', type: 'http', enabled: 1, health_check: { url: 'https://api.cerebras.ai/v1/models', auth_env: 'CEREBRAS_API_KEY' } },
    ];
  }
}

// --- Checks by provider type ---

async function checkSubprocess(name, { timeout = 10000 } = {}) {
  try {
    await execute(name, ['--version'], { timeout });
    return { installed: true, authenticated: true };
  } catch (err) {
    return parseCheckError(err);
  }
}

async function checkSubprocessDeep(provider) {
  const hc = provider.health_check || {};
  if (!hc.command) return checkSubprocess(provider.name);
  try {
    await execute(hc.command, hc.args || [], { timeout: DEEP_CHECK_TIMEOUT });
    return { installed: true, authenticated: true };
  } catch (err) {
    return parseCheckError(err);
  }
}

async function checkHttp(provider) {
  const hc = provider.health_check || {};
  const envKey = hc.auth_env;
  if (envKey && !process.env[envKey]) {
    return { installed: true, authenticated: false, error: `${envKey} not set` };
  }
  return { installed: true, authenticated: true };
}

async function checkHttpDeep(provider) {
  const hc = provider.health_check || {};
  const envKey = hc.auth_env;
  const key = envKey ? process.env[envKey] : null;
  if (envKey && !key) {
    return { installed: true, authenticated: false, error: `${envKey} not set` };
  }
  if (!hc.url) return { installed: true, authenticated: !!key };
  try {
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const res = await fetch(hc.url, {
      headers,
      signal: AbortSignal.timeout(DEEP_CHECK_TIMEOUT),
    });
    if (res.ok) return { installed: true, authenticated: true };
    return { installed: true, authenticated: false, error: `API returned ${res.status}` };
  } catch {
    return { installed: true, authenticated: false, error: 'API unreachable' };
  }
}

// Check a single provider (shallow or deep)
async function checkProvider(provider, { deep = false } = {}) {
  if (provider.type === 'http') {
    return deep ? checkHttpDeep(provider) : checkHttp(provider);
  }
  // Default: subprocess
  return deep ? checkSubprocessDeep(provider) : checkSubprocess(provider.name);
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

  const providerList = getProviderList();
  const results = await Promise.all(
    providerList.map((p) => checkProvider(p, { deep: false }))
  );

  const providers = {};
  for (let i = 0; i < providerList.length; i++) {
    const p = providerList[i];
    providers[p.name] = { ...results[i], enabled: !!p.enabled };
  }

  const status = computeHealthStatus(providers);
  cache = { data: { status, providers }, expires: now + getCacheTtl() };

  return {
    ...cache.data,
    circuit_breakers: getAllCircuitStates(),
    queue: queue.stats,
    uptime_seconds: Math.floor(process.uptime()),
  };
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
  const webhookUrl = getAlertWebhookUrl();
  if (!webhookUrl) return;
  const status = to.authenticated ? 'healthy' : 'unhealthy';
  const payload = {
    text: `[SheLLM] Provider \`${provider}\` is now **${status}**${to.error ? `: ${to.error}` : ''}`,
    provider,
    from: { authenticated: from.authenticated, installed: from.installed },
    to: { authenticated: to.authenticated, installed: to.installed },
    timestamp: new Date().toISOString(),
  };
  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => logger.error({ event: 'alert_webhook_error', error: err.message }));
}

async function pollAllProviders({ deep = false } = {}) {
  try {
    const providerList = getProviderList();
    const results = await Promise.allSettled(
      providerList.map((p) => checkProvider(p, { deep }))
    );

    const statuses = {};
    for (let i = 0; i < providerList.length; i++) {
      const name = providerList[i].name;
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

    // Merge enabled status from DB
    const providers = {};
    for (let i = 0; i < providerList.length; i++) {
      const p = providerList[i];
      providers[p.name] = { ...statuses[p.name], enabled: !!p.enabled };
    }
    cache = { data: { status: 'ok', providers }, expires: Date.now() + getPollInterval() + 5000 };
  } catch (err) {
    logger.error({ event: 'health_poll_error', error: err.message });
  }
}

function startHealthPoller() {
  pollAllProviders({ deep: true });
  pollerInterval = setInterval(() => pollAllProviders({ deep: false }), getPollInterval());
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
