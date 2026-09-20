'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// app.js is loaded the way the browser loads it, so the formatters under test are the ones the
// page actually calls. Nothing here stubs a clock: every assertion names an absolute instant.
function loadApp() {
  const context = vm.createContext({
    console, Intl, Date, fetch: async () => {}, navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
  });
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  return context;
}

describe('the dashboard renders time in one configured zone', () => {
  // 23:00 UTC is the previous evening in Mexico City and the next morning in Helsinki, so a
  // formatter that ignores the zone cannot pass both halves of this.
  const INSTANT = '2026-09-19T23:00:00Z';
  let page;

  before(() => { page = loadApp(); });

  it('speaks Mexico City until the server says otherwise', () => {
    assert.strictEqual(page.formatTime(INSTANT), '09/19 17:00:00');
  });

  it('moves the reading when the zone changes, date included', () => {
    page.setDashboardTimezone('Europe/Helsinki');
    assert.strictEqual(page.formatTime(INSTANT), '09/20 02:00:00',
      'the same instant is the next day in Helsinki — a browser-local formatter would not move');

    page.setDashboardTimezone('America/Mexico_City');
    assert.strictEqual(page.formatTime(INSTANT), '09/19 17:00:00');
  });

  it('reads a bare SQLite datetime as the UTC it is, not as local time', () => {
    assert.strictEqual(page.formatTime('2026-09-19 23:00:00'), page.formatTime(INSTANT));
  });

  it('keeps an already-marked instant parseable', () => {
    assert.strictEqual(page.formatTime('2026-09-19T23:00:00.000Z'), '09/19 17:00:00');
    assert.strictEqual(page.formatTime(null), '-');
    assert.strictEqual(page.formatTime('not a date'), '-');
  });

  it('formats axis labels in the same zone as the tables', () => {
    assert.strictEqual(page.formatHourMinute(INSTANT), '17:00');
    assert.strictEqual(page.formatDayHour(INSTANT), '09/19 17:00');
  });

  it('ignores an empty zone rather than blanking the clock', () => {
    page.setDashboardTimezone(undefined);
    assert.strictEqual(page.formatTime(INSTANT), '09/19 17:00:00');
  });
});
