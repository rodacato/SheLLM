'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

function loadPage(file, factory, extra = {}) {
  const stores = {};
  const context = vm.createContext({
    console, Intl, Date, Math, URLSearchParams, Promise, AbortController, Error,
    Alpine: { store: (n, v) => (v === undefined ? stores[n] : (stores[n] = v)) },
    performance: { now: () => 0 },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#849397' }),
    document: { documentElement: {}, addEventListener: () => {} },
    navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
    ...extra,
  });
  for (const f of ['app.js', file]) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), context, { filename: f });
  }
  return context[factory]();
}

function appGlobals() {
  const context = vm.createContext({
    console, Intl, Date, Math, URLSearchParams, Promise,
    Alpine: { store: () => ({}) },
    document: { documentElement: {}, addEventListener: () => {} },
    navigator: { onLine: true }, setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/admin/dashboard', hash: '' }, window: { addEventListener: () => {} },
  });
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  return context;
}

describe('a request in flight is visible, with whose it is and how long it has run', () => {
  const g = appGlobals();

  it('ages a job from the last health read, so the list ticks between polls', () => {
    assert.strictEqual(g.inFlightAge({ age_ms: 60000 }, 1_000_000, 1_012_000), 72000);
    assert.strictEqual(g.inFlightAge({ age_ms: 60000 }, 1_000_000, 999_000), 60000, 'a clock behind the read never shrinks it');
  });

  it('reads minutes as minutes', () => {
    assert.strictEqual(g.formatAge(51900), '51.9s');
    assert.strictEqual(g.formatAge(192000), '3m 12s');
  });

  it('names a queued request by its place in line', () => {
    assert.strictEqual(g.inFlightState({ state: 'running' }), 'Running');
    assert.strictEqual(g.inFlightState({ state: 'queued', position: 2 }), 'Queued #2');
  });

  it('flags a request close to the timeout that kills it, not one past a fixed two minutes', () => {
    const running = { state: 'running' };
    assert.strictEqual(g.isNearTimeout(running, 192000, 300000), false, 'a 3-minute stream under a 5-minute limit is fine');
    assert.strictEqual(g.isNearTimeout(running, 250000, 300000), true);
    assert.strictEqual(g.isNearTimeout({ state: 'queued' }, 250000, 300000), false, 'waiting in line is not the CLI hanging');
    assert.strictEqual(g.isNearTimeout(running, 250000, undefined), false, 'an older server that sends no limit flags nothing');
  });
});

describe('the Playground can give up on a request that never returns', () => {
  it('builds an abort signal and hands it to the request', async () => {
    let seen = null;
    const page = loadPage('playground.js', 'playgroundPage', {
      fetch: async (_url, opts) => {
        seen = opts.signal;
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
      },
    });
    page.apiKey = 'shellm-test';
    await page.send();

    assert.ok(seen, 'the request carries a signal, or nothing can cancel it');
    assert.strictEqual(typeof seen.aborted, 'boolean');
  });

  it('stops waiting, and says the CLI did not stop with it', async () => {
    const page = loadPage('playground.js', 'playgroundPage', {
      fetch: (_url, opts) => new Promise((_res, rej) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          rej(err);
        });
      }),
    });
    page.apiKey = 'shellm-test';

    const sending = page.send();
    await Promise.resolve();
    page.stopWaiting();
    await sending;

    assert.strictEqual(page.running, false, 'the button comes back');
    assert.ok(page.error.includes('still running on the server'),
      `the operator must not think aborting killed the CLI: ${JSON.stringify(page.error)}`);
  });

  // The wait is measured in seconds and the screen said one static sentence for all of them, so
  // a normal call and a wedged one looked identical until the clock landed.
  it('counts the wait while it is happening, not after it ends', async () => {
    let clock = 0;
    const ticks = [];
    const page = loadPage('playground.js', 'playgroundPage', {
      fetch: () => new Promise(() => {}),
      performance: { now: () => clock },
      setInterval: (fn) => { ticks.push(fn); return 7; },
      clearInterval: () => {},
    });
    page.apiKey = 'shellm-test';

    page.send();
    await Promise.resolve();
    assert.strictEqual(page.waitingMs, 0, 'the counter starts at zero, not at the last request');
    assert.strictEqual(ticks.length, 1, 'exactly one ticker runs');

    clock = 4230;
    ticks[0]();
    assert.strictEqual(page.waitingMs, 4230);
    assert.strictEqual(page.running, true, 'and the request is still in flight');
  });

  it('stops the ticker when the answer arrives', async () => {
    let cleared = null;
    const page = loadPage('playground.js', 'playgroundPage', {
      fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }),
      setInterval: () => 7,
      clearInterval: (id) => { cleared = id; },
    });
    page.apiKey = 'shellm-test';
    await page.send();

    assert.strictEqual(cleared, 7, 'a ticker left running would keep writing to a finished request');
  });

  it('still reports an ordinary failure as an ordinary failure', async () => {
    const page = loadPage('playground.js', 'playgroundPage', {
      fetch: async () => { throw new Error('offline'); },
    });
    page.apiKey = 'shellm-test';
    await page.send();

    assert.ok(page.error.includes('is the server still running?'));
    assert.ok(!page.error.includes('still running on the server'), 'and not as an abort');
  });
});
