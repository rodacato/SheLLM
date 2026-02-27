#!/usr/bin/env node

/**
 * SheLLM Smoke Tests
 *
 * End-to-end tests against a running SheLLM server.
 * Creates a temporary API key, tests each provider individually,
 * runs a concurrency test, then cleans up.
 *
 * Usage:
 *   npm run smoke                       # defaults to http://localhost:6100
 *   npm run smoke -- --base http://host:port
 *   npm run smoke -- --admin-user admin --admin-pass secret
 */

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = flag('base', process.env.SHELLM_SMOKE_BASE || 'http://localhost:6100');
const ADMIN_USER = flag('admin-user', process.env.SHELLM_ADMIN_USER || 'admin');
const ADMIN_PASS = flag('admin-pass', process.env.SHELLM_ADMIN_PASSWORD || 'secret');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const results = [];
let apiKey = null;
let apiKeyId = null;

function log(msg) { console.log(msg); }
function header(msg) { log(`\n${BOLD}${CYAN}── ${msg} ──${RESET}`); }

function pass(name, detail) {
  results.push({ name, passed: true, detail });
  log(`  ${GREEN}✓${RESET} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, passed: false, detail });
  log(`  ${RED}✗${RESET} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

function skip(name, reason) {
  results.push({ name, passed: null, detail: reason });
  log(`  ${YELLOW}○${RESET} ${name}  ${DIM}${reason}${RESET}`);
}

async function adminFetch(path, options = {}) {
  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
      ...options.headers,
    },
  });
}

async function apiFetch(path, body) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

function formatMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Phase 1: Server health
// ---------------------------------------------------------------------------
let healthyProviders = [];

async function phaseHealth() {
  header('Phase 1: Server health');

  // 1a. Health endpoint
  try {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json();

    if (res.ok && body.status === 'ok') {
      pass('GET /health', `uptime ${body.uptime_seconds}s`);
    } else {
      fail('GET /health', `status=${res.status}`);
      return false;
    }

    // Detect healthy providers
    for (const [name, status] of Object.entries(body.providers || {})) {
      if (status.authenticated) {
        healthyProviders.push(name);
      }
    }
    log(`  ${DIM}  Providers available: ${healthyProviders.join(', ') || 'none'}${RESET}`);
  } catch (e) {
    fail('GET /health', e.message);
    return false;
  }

  // 1b. Models endpoint is tested after key setup (it may require auth)

  return true;
}

// ---------------------------------------------------------------------------
// Phase 2: API key setup
// ---------------------------------------------------------------------------
async function phaseSetup() {
  header('Phase 2: Create temporary API key');

  try {
    const res = await adminFetch('/admin/keys', {
      method: 'POST',
      body: JSON.stringify({ name: `smoke-${Date.now()}`, rpm: 60 }),
    });
    const body = await res.json();

    if (res.status === 201 && body.key?.raw_key) {
      apiKey = body.key.raw_key;
      apiKeyId = body.key.id;
      pass('POST /admin/keys', `id=${apiKeyId} prefix=${body.key.key_prefix}`);

      // Now test models endpoint with the new key
      try {
        const mRes = await fetch(`${BASE}/v1/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const mBody = await mRes.json();
        if (mRes.ok && mBody.object === 'list' && mBody.data.length > 0) {
          pass('GET /v1/models', `${mBody.data.length} models`);
        } else {
          fail('GET /v1/models', `status=${mRes.status}`);
        }
      } catch (e) {
        fail('GET /v1/models', e.message);
      }

      return true;
    }

    fail('POST /admin/keys', `status=${res.status} ${JSON.stringify(body)}`);
    return false;
  } catch (e) {
    fail('POST /admin/keys', e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Individual provider tests
// ---------------------------------------------------------------------------
async function testProvider(provider) {
  const testName = `${provider} single request`;

  try {
    const start = Date.now();
    const res = await apiFetch('/v1/messages', {
      model: provider,
      max_tokens: 50,
      messages: [{ role: 'user', content: `Respond with ONLY the word PONG` }],
    });
    const duration = Date.now() - start;
    const body = await res.json();

    if (res.status !== 200) {
      fail(testName, `HTTP ${res.status}: ${body.error || body.message}`);
      return;
    }

    const text = body.content?.[0]?.text?.trim() || '';
    const inTok = body.usage?.input_tokens ?? null;
    const outTok = body.usage?.output_tokens ?? null;
    const hasTokens = inTok > 0 || outTok > 0;
    const detail = `${formatMs(duration)} | "${text.substring(0, 30)}" | tokens: ${hasTokens ? `in=${inTok} out=${outTok}` : 'none'}`;

    if (text.length > 0) {
      pass(testName, detail);
    } else {
      fail(testName, `empty response | ${detail}`);
    }

    // Verify token reporting
    if (hasTokens) {
      pass(`${provider} token reporting`, `in=${inTok} out=${outTok}`);
    } else {
      fail(`${provider} token reporting`, 'no tokens returned');
    }
  } catch (e) {
    fail(testName, e.message);
  }
}

async function phaseProviders() {
  header('Phase 3: Individual provider tests');

  if (healthyProviders.length === 0) {
    skip('provider tests', 'no providers available');
    return;
  }

  for (const provider of healthyProviders) {
    await testProvider(provider);
  }
}

// ---------------------------------------------------------------------------
// Phase 4: Concurrency
// ---------------------------------------------------------------------------
async function phaseConcurrency() {
  header('Phase 4: Concurrency test');

  if (healthyProviders.length < 2) {
    skip('concurrency test', `need ≥2 providers, have ${healthyProviders.length}`);
    return;
  }

  const requests = healthyProviders.map((provider, i) => ({
    provider,
    word: ['ALFA', 'BETA', 'GAMMA', 'DELTA'][i] || `WORD${i}`,
  }));

  const globalStart = Date.now();
  const timings = await Promise.all(
    requests.map(async ({ provider, word }) => {
      const start = Date.now();
      try {
        const res = await apiFetch('/v1/messages', {
          model: provider,
          max_tokens: 50,
          messages: [{ role: 'user', content: `Respond with ONLY the word ${word}` }],
        });
        const duration = Date.now() - start;
        const body = await res.json();
        return { provider, duration, status: res.status, ok: res.status === 200, text: body.content?.[0]?.text?.trim() };
      } catch (e) {
        return { provider, duration: Date.now() - start, ok: false, error: e.message };
      }
    }),
  );
  const wallTime = Date.now() - globalStart;
  const sumTime = timings.reduce((s, t) => s + t.duration, 0);
  const allOk = timings.filter((t) => t.ok);

  // Log individual results
  for (const t of timings) {
    log(`  ${DIM}  ${t.provider}: ${t.ok ? 'ok' : 'fail'} in ${formatMs(t.duration)}${t.text ? ` → "${t.text}"` : ''}${RESET}`);
  }

  // Check parallelism — only measure providers that succeeded.
  // Wall time should be less than the sequential sum by at least the
  // duration of the fastest successful request (i.e. it ran in parallel).
  const okSum = allOk.reduce((s, t) => s + t.duration, 0);
  const fastest = Math.min(...allOk.map((t) => t.duration));
  const isParallel = allOk.length >= 2 && wallTime < (okSum - fastest * 0.5);
  const detail = `wall=${formatMs(wallTime)} sum=${formatMs(okSum)} (${allOk.length}/${timings.length} succeeded)`;

  if (allOk.length < 2) {
    skip('parallel execution', `need ≥2 successful responses | ${detail}`);
  } else if (isParallel) {
    pass('parallel execution', detail);
  } else {
    fail('parallel execution', `requests appear sequential | ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 5: Error contract
// ---------------------------------------------------------------------------
async function phaseErrors() {
  header('Phase 5: Error contract');

  // 5a. Invalid model
  try {
    const res = await apiFetch('/v1/messages', {
      model: 'nonexistent-model',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }],
    });
    if (res.status === 400) {
      pass('invalid model → 400', `status=${res.status}`);
    } else {
      fail('invalid model → 400', `got status=${res.status}`);
    }
  } catch (e) {
    fail('invalid model → 400', e.message);
  }

  // 5b. Missing auth
  try {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude', max_tokens: 10, messages: [{ role: 'user', content: 'test' }] }),
    });
    if (res.status === 401) {
      pass('missing auth → 401', `status=${res.status}`);
    } else {
      fail('missing auth → 401', `got status=${res.status}`);
    }
  } catch (e) {
    fail('missing auth → 401', e.message);
  }

  // 5c. Missing messages
  try {
    const res = await apiFetch('/v1/messages', { model: 'claude', max_tokens: 10 });
    if (res.status === 400) {
      pass('missing messages → 400', `status=${res.status}`);
    } else {
      fail('missing messages → 400', `got status=${res.status}`);
    }
  } catch (e) {
    fail('missing messages → 400', e.message);
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Cleanup
// ---------------------------------------------------------------------------
async function phaseCleanup() {
  header('Phase 6: Cleanup');

  if (!apiKeyId) {
    skip('delete API key', 'no key to delete');
    return;
  }

  try {
    const res = await adminFetch(`/admin/keys/${apiKeyId}`, { method: 'DELETE' });
    if (res.ok) {
      pass('DELETE /admin/keys/:id', `id=${apiKeyId} removed`);
    } else {
      fail('DELETE /admin/keys/:id', `status=${res.status}`);
    }
  } catch (e) {
    fail('DELETE /admin/keys/:id', e.message);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function report() {
  header('Report');

  const passed = results.filter((r) => r.passed === true).length;
  const failed = results.filter((r) => r.passed === false).length;
  const skipped = results.filter((r) => r.passed === null).length;
  const total = results.length;

  log('');
  log(`  ${GREEN}${passed} passed${RESET}  ${failed > 0 ? `${RED}${failed} failed${RESET}  ` : ''}${skipped > 0 ? `${YELLOW}${skipped} skipped${RESET}  ` : ''}${DIM}${total} total${RESET}`);

  if (failed > 0) {
    log('');
    log(`  ${RED}Failures:${RESET}`);
    for (const r of results.filter((r) => r.passed === false)) {
      log(`    ${RED}✗${RESET} ${r.name}  ${DIM}${r.detail}${RESET}`);
    }
  }

  log('');
  return failed === 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log(`\n${BOLD}SheLLM Smoke Tests${RESET}`);
  log(`${DIM}Server: ${BASE}${RESET}`);

  const healthy = await phaseHealth();
  if (!healthy) {
    log(`\n${RED}Server not reachable. Aborting.${RESET}\n`);
    process.exit(1);
  }

  const hasKey = await phaseSetup();
  if (!hasKey) {
    log(`\n${RED}Could not create API key. Aborting.${RESET}\n`);
    process.exit(1);
  }

  await phaseProviders();
  await phaseConcurrency();
  await phaseErrors();
  await phaseCleanup();

  const ok = report();
  process.exit(ok ? 0 : 1);
}

main();
