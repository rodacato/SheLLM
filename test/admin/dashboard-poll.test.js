'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// A hand-driven clock and a hand-driven visibility flag — the two boundaries the poller does not
// own. Everything below them is the real factory, loaded the way the browser loads it.
function browser(localStorage) {
  let nextId = 1;
  const timers = new Map();
  const onVisibility = [];

  const document = {
    hidden: false,
    addEventListener(type, fn) { if (type === 'visibilitychange') onVisibility.push(fn); },
  };

  const context = vm.createContext({
    console,
    document,
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    location: { pathname: '/admin/dashboard', hash: '', replace() {} },
    window: { addEventListener() {} },
    localStorage: localStorage || { getItem: () => null, setItem: () => {} },
  });

  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf8'), context, { filename: 'app.js' });

  return {
    read: (key, fallback) => vm.runInContext('storedInterval', context)(key, fallback),
    write: (key, ms) => vm.runInContext('storeInterval', context)(key, ms),
    ladder: () => vm.runInContext('REFRESH_LADDER', context),
    make() {
      const reads = { count: 0 };
      const poller = vm.runInContext('poller', context);
      return { reads, poller: poller(() => { reads.count += 1; }) };
    },
    get armed() { return [...timers.values()]; },
    get armedIds() { return [...timers.keys()]; },
    tick(times = 1) {
      for (let i = 0; i < times; i += 1) for (const timer of [...timers.values()]) timer.fn();
    },
    setHidden(hidden) {
      document.hidden = hidden;
      for (const fn of onVisibility) fn();
    },
  };
}

describe('the poller only runs while someone is looking', () => {
  it('arms nothing until it is given an interval', () => {
    const page = browser();
    page.make();
    assert.strictEqual(page.armed.length, 0, 'creating a poller must not start one');
  });

  it('reads once per interval', () => {
    const page = browser();
    const { poller, reads } = page.make();
    poller.every(1000);
    page.tick(3);

    assert.strictEqual(reads.count, 3);
    assert.strictEqual(page.armed.length, 1);
    assert.strictEqual(page.armed[0].ms, 1000);
  });

  it('re-arms on a new interval instead of stacking a second timer', () => {
    const page = browser();
    const { poller, reads } = page.make();
    poller.every(1000);
    poller.every(5000);

    assert.strictEqual(page.armed.length, 1, 'a changed interval left the old timer running');
    assert.strictEqual(page.armed[0].ms, 5000);
    page.tick(1);
    assert.strictEqual(reads.count, 1, 'one tick must produce exactly one read');
  });

  // The whole point: a dashboard left open on a second monitor was polling all night.
  it('stops asking while the tab is hidden', () => {
    const page = browser();
    const { poller, reads } = page.make();
    poller.every(1000);
    page.tick(1);

    page.setHidden(true);
    assert.strictEqual(page.armed.length, 0, 'the timer survived the tab being hidden');
    page.tick(5);
    assert.strictEqual(reads.count, 1, 'a hidden tab read the gateway');
  });

  // Waiting out a full period on return would show stale figures on a page the operator just
  // came back to look at.
  it('reads once immediately on return, then resumes — not twice', () => {
    const page = browser();
    const { poller, reads } = page.make();
    poller.every(1000);
    page.setHidden(true);
    page.setHidden(false);

    assert.strictEqual(reads.count, 1, 'returning to the tab owes exactly one immediate read');
    assert.strictEqual(page.armed.length, 1, 'the loop did not resume');
    page.tick(1);
    assert.strictEqual(reads.count, 2);
  });

  it('does not arm while the tab is already hidden', () => {
    const page = browser();
    const { poller, reads } = page.make();
    page.setHidden(true);
    poller.every(1000);

    assert.strictEqual(page.armed.length, 0, 'an interval set on a hidden tab started a timer');
    page.setHidden(false);
    assert.strictEqual(reads.count, 1);
    assert.strictEqual(page.armed.length, 1);
  });

  it('stays stopped after stop(), including across a visibility change', () => {
    const page = browser();
    const { poller, reads } = page.make();
    poller.every(1000);
    poller.stop();

    assert.strictEqual(page.armed.length, 0);
    page.setHidden(true);
    page.setHidden(false);
    page.tick(3);
    assert.strictEqual(reads.count, 0, 'a stopped poller came back on a visibility change');
  });

  // The Alpine effects that drive these call startAutoRefresh on every read. Re-arming there would
  // reset the countdown each time the loop completed, so the next read never arrives.
  it('ignores a repeated call with the interval it is already running', () => {
    const page = browser();
    const { poller } = page.make();
    poller.every(1000);
    const first = page.armedIds[0];
    poller.every(1000);

    assert.deepEqual(page.armedIds, [first], 'the timer was torn down and rebuilt');
  });

  it('treats an interval of zero as off', () => {
    const page = browser();
    const { poller, reads } = page.make();
    poller.every(0);
    page.tick(3);

    assert.strictEqual(page.armed.length, 0);
    assert.strictEqual(reads.count, 0);
  });
});

// A repeating read that calls setInterval directly is one the visibility rule cannot reach, and
// nothing about it looks wrong at the call site.
describe('every repeating read goes through the poller', () => {
  it('leaves no bare setInterval in the files that read the gateway', () => {
    for (const file of ['app.js', 'overview.js', 'logs.js']) {
      const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
      const calls = (source.match(/setInterval\(/g) || []).length;
      const expected = file === 'app.js' ? 1 : 0;
      assert.strictEqual(calls, expected, `${file} schedules a read outside poller()`);
    }
  });
});

describe('the remembered interval', () => {
  const KEY = 'shellm.refresh.overview';
  const stored = (value) => ({ getItem: () => value, setItem: () => {} });

  it('offers Off and four rungs, in ascending order', () => {
    const ladder = browser().ladder();
    assert.deepEqual(Array.from(ladder, (step) => step.label), ['Off', '10s', '30s', '1m', '5m']);
    assert.deepEqual(Array.from(ladder, (step) => step.ms), [0, 10000, 30000, 60000, 300000]);
  });

  // Number(null) is 0 and 0 is a real rung, so a page that has never been configured would
  // silently come up with auto-refresh switched off.
  it('falls back when nothing was ever stored, rather than reading it as Off', () => {
    assert.strictEqual(browser().read(KEY, 30000), 30000);
  });

  it('honours a stored Off', () => {
    assert.strictEqual(browser(stored('0')).read(KEY, 30000), 0);
  });

  it('restores a value that is on the ladder', () => {
    assert.strictEqual(browser(stored('10000')).read(KEY, 30000), 10000);
  });

  it('ignores a value that is not on the ladder', () => {
    assert.strictEqual(browser(stored('7000')).read(KEY, 30000), 30000);
    assert.strictEqual(browser(stored('every minute')).read(KEY, 30000), 30000);
  });

  // Private windows and blocked site data throw on access instead of answering.
  it('survives storage that throws in either direction', () => {
    const hostile = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    const page = browser(hostile);
    assert.strictEqual(page.read(KEY, 30000), 30000);
    assert.doesNotThrow(() => page.write(KEY, 10000));
  });
});
