'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

function loadPage(file, factory) {
  const stores = {};
  const context = vm.createContext({
    console, Intl, Date, Math, URLSearchParams,
    Alpine: { store: (n, v) => (v === undefined ? stores[n] : (stores[n] = v)) },
    fetch: async () => {}, navigator: { onLine: true },
    getComputedStyle: () => ({ getPropertyValue: () => '#849397' }),
    document: { documentElement: {}, addEventListener: () => {} },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
  });
  for (const f of ['app.js', file]) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), context, { filename: f });
  }
  return context[factory]();
}

const sentence = (s) => typeof s === 'string' && s.split(' ').length >= 4;

describe('the circuit says what its state costs and what ends it', () => {
  const page = loadPage('system.js', 'systemPage');
  const prov = (circuit) => ({ name: 'claude', enabled: true, installed: true, authenticated: true, circuit });

  it('says nothing when there is nothing to say', () => {
    assert.strictEqual(page.circuitVerdict(prov({ state: 'closed', failures: 0, threshold: 3 })), '');
  });

  it('names the cost and the moment it is retried when open', () => {
    const v = page.circuitVerdict(prov({
      state: 'open', failures: 3, threshold: 3, retry_at: '2026-09-20T12:00:00Z',
    }));
    assert.ok(sentence(v), `expected a sentence, got ${JSON.stringify(v)}`);
    assert.ok(v.includes('claude'), 'it names the provider');
    assert.ok(/\d{2}:\d{2}/.test(v), 'and when one request is let through');
  });

  it('says something different in each state, so a constant cannot pass', () => {
    const seen = [
      page.circuitVerdict(prov({ state: 'open', failures: 3, threshold: 3, retry_at: '2026-09-20T12:00:00Z' })),
      page.circuitVerdict(prov({ state: 'half_open', failures: 3, threshold: 3 })),
      page.circuitVerdict(prov({ state: 'closed', failures: 1, threshold: 3 })),
    ];
    assert.strictEqual(new Set(seen).size, 3, `three states must read differently: ${JSON.stringify(seen)}`);
    assert.ok(seen.every(sentence));
  });

  it('counts down the failures that would stop routing', () => {
    const v = page.circuitVerdict(prov({ state: 'closed', failures: 2, threshold: 3 }));
    assert.ok(v.includes('1 more failure'), `expected the singular count, got ${JSON.stringify(v)}`);
  });
});

describe('an unsigned-in provider is told how to sign in', () => {
  const page = loadPage('system.js', 'systemPage');

  it('hands back the command the server sent, not one the page invented', () => {
    const v = page.authVerdict({
      name: 'codex', enabled: true, installed: true, authenticated: false,
      login_help: 'run `codex login` on the host as the service user',
    });
    assert.strictEqual(v, 'run `codex login` on the host as the service user');
  });

  it('still says something useful when the server sent no help', () => {
    const v = page.authVerdict({ name: 'codex', enabled: true, installed: true, authenticated: false });
    assert.ok(sentence(v));
  });

  it('reads differently for paused, missing, unknown and ready', () => {
    const base = { name: 'claude', enabled: true, installed: true };
    const seen = [
      page.authVerdict({ ...base, enabled: false }),
      page.authVerdict({ ...base, installed: false }),
      page.authVerdict({ ...base, authenticated: null }),
      page.authVerdict({ ...base, authenticated: true }),
    ];
    assert.strictEqual(new Set(seen).size, 4, JSON.stringify(seen));
    assert.strictEqual(seen[3], '', 'a healthy provider needs no sentence');
  });
});

describe('the burn rate is read against the week, not asserted', () => {
  const page = loadPage('overview.js', 'overviewPage');
  const withWindows = (shortRate, weekRate) => {
    page.stats = { quota: { windows: [
      { hours: 5, cost_per_hour: shortRate }, { hours: 168, cost_per_hour: weekRate },
    ] } };
    return page.stats.quota.windows[0];
  };

  it('calls a spike a spike, with the multiple', () => {
    assert.strictEqual(page.burnVerdict(withWindows(0.30, 0.10)), '3.0× the weekly pace');
  });

  it('calls a lull a lull', () => {
    assert.strictEqual(page.burnVerdict(withWindows(0.02, 0.10)), '5.0× slower than the week');
  });

  it('says so when there is nothing unusual', () => {
    assert.strictEqual(page.burnVerdict(withWindows(0.11, 0.10)), 'in line with the week');
  });

  it('judges nothing when there is nothing to judge against', () => {
    assert.strictEqual(page.burnVerdict(withWindows(0.30, 0)), '');
    const week = (page.stats.quota.windows)[1];
    assert.strictEqual(page.burnVerdict(week), '', 'the week is not compared with itself');
  });
});
