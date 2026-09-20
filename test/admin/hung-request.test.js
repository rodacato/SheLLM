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

describe('a wedged request is visible on the Overview queue panel', () => {
  const page = () => loadPage('overview.js', 'overviewPage', { fetch: async () => {} });
  const withQueue = (q) => { const p = page(); p.health = { queue: q }; return p; };

  it('says nothing when nothing is running', () => {
    assert.strictEqual(withQueue({ active: 0, in_flight: [], oldest_age_ms: null }).queueVerdict(), '');
  });

  it('names the age and what is running it', () => {
    const p = withQueue({ active: 1, in_flight: [{ age_ms: 540000, label: 'claude · claude-fable' }], oldest_age_ms: 540000 });
    const v = p.queueVerdict();
    assert.ok(v.includes('claude · claude-fable'), `expected the label, got ${JSON.stringify(v)}`);
    assert.ok(/9\.0s|540|9 min|540\.0s/.test(v) || v.includes('540.0s'), `expected the age, got ${JSON.stringify(v)}`);
  });

  it('calls nine minutes what it is, and two seconds what it is', () => {
    const wedged = withQueue({ in_flight: [{ age_ms: 540000, label: null }], oldest_age_ms: 540000 });
    const fine = withQueue({ in_flight: [{ age_ms: 2000, label: null }], oldest_age_ms: 2000 });

    assert.ok(wedged.queueVerdict().includes('long past a normal call'));
    assert.ok(!fine.queueVerdict().includes('long past a normal call'));
    assert.notStrictEqual(wedged.queueVerdict(), fine.queueVerdict());
  });

  it('flags the stall separately, so the line can be coloured', () => {
    assert.strictEqual(withQueue({ oldest_age_ms: 540000, in_flight: [{ age_ms: 540000 }] }).queueIsStalling(), true);
    assert.strictEqual(withQueue({ oldest_age_ms: 2000, in_flight: [{ age_ms: 2000 }] }).queueIsStalling(), false);
    assert.strictEqual(withQueue({ oldest_age_ms: null, in_flight: [] }).queueIsStalling(), false);
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
