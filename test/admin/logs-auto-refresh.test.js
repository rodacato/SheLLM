'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// The real component, loaded the way the browser loads it. Only the clock, the visibility flag
// and the two reads it makes are stood in for; the guard under test is the shipped one.
function logsPage(stored = null) {
  const timers = new Map();
  let nextId = 1;
  const document = { hidden: false, addEventListener() {} };

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
    localStorage: { getItem: () => stored, setItem: () => {} },
    URLSearchParams,
  });

  for (const file of ['app.js', 'logs.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }

  const page = vm.runInContext('logsPage()', context);
  const reads = { logs: 0, stats: 0, manual: 0 };
  page.fetchLogs = ({ manual = true } = {}) => { reads.logs += 1; if (manual) reads.manual += 1; };
  page.fetchStats = () => { reads.stats += 1; };

  return {
    page,
    reads,
    tick(times = 1) {
      for (let i = 0; i < times; i += 1) for (const timer of [...timers.values()]) timer.fn();
    },
  };
}

describe('the Logs table holds its loop while you are reading it', () => {
  it('is off by default, so the table only moves when asked', () => {
    const { page } = logsPage();
    assert.strictEqual(page.refreshMs, 0);
    assert.strictEqual(page.autoRefreshHeld, false, 'nothing to hold when there is no loop');
    assert.strictEqual(page.intervalTitle, 'Auto-refresh is off');
  });

  it('runs when the table is at the top with nothing expanded', () => {
    const { page } = logsPage('10000');
    assert.strictEqual(page.refreshMs, 10000);
    assert.strictEqual(page.autoRefreshHeld, false);
    assert.strictEqual(page.intervalTitle, 'How often the table re-reads itself');
  });

  // Replacing the rows under an open detail is the behaviour the whole guard exists to prevent.
  it('holds while a row is open, and says which reason it is', () => {
    const { page } = logsPage('10000');
    page.toggleRow('abc');

    assert.strictEqual(page.autoRefreshHeld, true);
    assert.strictEqual(page.intervalTitle, 'Paused while a row is open');
  });

  it('holds while the table is past page 1', () => {
    const { page } = logsPage('10000');
    page.offset = 25;

    assert.strictEqual(page.autoRefreshHeld, true);
    assert.strictEqual(page.intervalTitle, 'Paused while you are past page 1');
  });

  // "Off" and "held" are different states and only one of them is worth showing a pause glyph for.
  it('is not "held" merely because it is off', () => {
    const { page } = logsPage('0');
    page.toggleRow('abc');
    page.offset = 25;

    assert.strictEqual(page.autoRefreshHeld, false);
    assert.strictEqual(page.intervalTitle, 'Auto-refresh is off');
  });

  it('reads the table and its panels on every tick while it is running', () => {
    const { page, reads, tick } = logsPage('10000');
    page.startAutoRefresh();
    tick(2);

    assert.strictEqual(reads.logs, 2);
    assert.strictEqual(reads.stats, 2);
    assert.strictEqual(reads.manual, 0, 'an automatic read must not count as a press');
  });

  it('stops reading the moment a row is opened, and resumes when it is closed', () => {
    const { page, reads, tick } = logsPage('10000');
    page.startAutoRefresh();
    tick(1);
    assert.strictEqual(reads.logs, 1);

    page.toggleRow('abc');
    tick(3);
    assert.strictEqual(reads.logs, 1, 'the table was replaced under an open row');

    page.toggleRow('abc');
    tick(1);
    assert.strictEqual(reads.logs, 2, 'closing the row did not resume the loop');
  });

  it('arms nothing at all while the interval is off', () => {
    const { page, reads, tick } = logsPage('0');
    page.startAutoRefresh();
    tick(3);

    assert.strictEqual(reads.logs, 0);
  });

  it('remembers a chosen interval and arms it without waiting for a page change', () => {
    const { page, reads, tick } = logsPage('0');
    page.startAutoRefresh();
    page.setRefresh('30000');
    tick(1);

    assert.strictEqual(page.refreshMs, 30000);
    assert.strictEqual(reads.logs, 1);
  });
});
