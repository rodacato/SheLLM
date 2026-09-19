const { execute } = require('../providers/base');
const { getBuildInfo } = require('./build-info');
const { queue } = require('./queue');
const { getAllCircuitStates, resetCircuit } = require('./circuit-breaker');
const logger = require('../lib/logger');

const PROBE_TIMEOUT = 15000;

function getCacheTtl() {
  return parseInt(process.env.HEALTH_CACHE_TTL_MS || '30000', 10);
}
function getPollInterval() {
  return parseInt(process.env.HEALTH_POLL_INTERVAL_MS || '300000', 10);
}
function getAlertWebhookUrl() {
  return process.env.SHELLM_ALERT_WEBHOOK_URL || null;
}

let cache = { data: null, expires: 0 };
let pollerInterval = null;
let previousStatus = {};

// --- Provider list from DB (with fallback) ---

function getProviderList() {
  try {
    const { getProviders, getDb } = require('../db');
    if (!getDb()) throw new Error('DB not initialized');
    return getProviders();
  } catch {
    // Fallback for tests/early boot — hardcoded defaults
    // The probe command is the provider module's, not this list's: the `health_check` column in
    // the providers table is left over and no longer read.
    return [
      { name: 'claude', type: 'subprocess', enabled: 1 },
      { name: 'codex', type: 'subprocess', enabled: 1 },
    ];
  }
}

// --- Checks by provider type ---

// Probes must run with the same environment as real calls, or a provider authenticated by
// token reports itself as logged out. The provider module owns that environment.
function providerEnv(name) {
  const { engines } = require('../routing/engines');
  return engines[name]?.env;
}

// Pattern matching cannot know what a provider's credential looks like; its own value can.
function providerSecrets(name) {
  return Object.values(providerEnv(name) || {}).filter((value) => typeof value === 'string' && value.length >= 8);
}

function providerModule(name) {
  const { engines } = require('../routing/engines');
  return engines[name];
}

const VERSION_PATTERN = /\d+\.\d+\.\d+/;
const versions = new Map();

// Kept for the life of the process rather than polled: a binary's version changes when someone
// installs a new one, which restarts the service anyway. Health is volatile, this is not.
async function getProviderVersion(name) {
  if (versions.has(name)) return versions.get(name);

  const module = providerModule(name);
  const run = () => execute(name, ['--version'], { timeout: PROBE_TIMEOUT, env: providerEnv(name) });
  let version = null;
  try {
    const result = module?.withLock ? await module.withLock(run) : await run();
    version = VERSION_PATTERN.exec(result.stdout)?.[0] ?? null;
  } catch { /* an uninstalled or broken CLI has no version to report */ }

  versions.set(name, version);
  return version;
}

function resetProviderVersions() {
  versions.clear();
}

// A probe asks the provider how to check itself, because only the provider knows which of its
// commands costs nothing. Spending a real request to find out whether requests work is a bill,
// not a health check.
async function checkProvider(provider) {
  const name = provider.name;
  const module = providerModule(name);
  const probe = module?.authProbe;
  const args = probe ? probe.args : ['--version'];
  const run = () => execute(name, args, { timeout: PROBE_TIMEOUT, env: providerEnv(name) });

  try {
    const result = module?.withLock ? await module.withLock(run) : await run();
    if (!probe) return { installed: true, authenticated: null };
    const loggedIn = probe.parse(result.stdout);
    return { installed: true, authenticated: loggedIn === null ? null : loggedIn };
  } catch (err) {
    return parseCheckError(err, providerSecrets(name));
  }
}

// Only these mean "the credentials are the problem". Everything else is a probe that failed for
// a reason we cannot name, and guessing "logged out" there took a whole provider offline: an
// unsupported default model answered 400 and every request to codex got 503 until the next poll.
const AUTH_FAILURE = /not authenticated|please login|please log ?out|auth required|unauthenticated|unauthorized|invalid bearer token|failed to authenticate|could not be refreshed|401/;

function parseCheckError(err, secrets = []) {
  const stderr = secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), err.stderr || '');
  const lower = stderr.toLowerCase();
  const error = stderr
    .replace(/(sk-|csk-|key-|shellm-)[A-Za-z0-9_-]{10,}/gi, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[REDACTED]')
    .slice(0, 200);

  // Keychain fallback with cached credentials means auth works — check first
  // because the message may contain "not found" for libsecret
  if (lower.includes('loaded cached credentials') || lower.includes('filekeychain fallback')) {
    return { installed: true, authenticated: true };
  }
  if (err.code === -1 || stderr.includes('ENOENT') || lower.includes('command not found')) {
    return { installed: false, authenticated: false, error };
  }
  if (AUTH_FAILURE.test(lower)) {
    return { installed: true, authenticated: false, error };
  }
  return { installed: true, authenticated: null, error };
}

// --- Health status ---

async function getHealthStatus() {
  const now = Date.now();

  if (cache.data && now < cache.expires) {
    return {
      ...cache.data,
      build: getBuildInfo(),
      queue: queue.stats,
      uptime_seconds: Math.floor(process.uptime()),
    };
  }

  const providerList = getProviderList();
  const results = await Promise.all(providerList.map((p) => checkProvider(p)));

  const providers = {};
  for (let i = 0; i < providerList.length; i++) {
    const p = providerList[i];
    const version = results[i].installed ? await getProviderVersion(p.name) : null;
    providers[p.name] = { ...results[i], enabled: !!p.enabled, version };
  }

  const status = computeHealthStatus(providers);
  cache = { data: { status, providers }, expires: now + getCacheTtl() };

  return {
    ...cache.data,
    build: getBuildInfo(),
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

async function pollAllProviders() {
  try {
    const providerList = getProviderList();
    const results = await Promise.allSettled(providerList.map((p) => checkProvider(p)));

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
  pollAllProviders();
  pollerInterval = setInterval(() => pollAllProviders(), getPollInterval());
  pollerInterval.unref();
  return pollerInterval;
}

function stopHealthPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

module.exports = { getHealthStatus, getCachedProviderStatus, startHealthPoller, stopHealthPoller, parseCheckError, checkProvider, getProviderVersion, resetProviderVersions };
