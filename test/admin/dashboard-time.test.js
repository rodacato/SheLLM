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

// Every case names its own `now`, so these pin the boundaries rather than one comfortable value.
describe('the dashboard says how long ago, not only when', () => {
  const NOW = Date.parse('2026-09-20T12:00:00Z');
  let page;
  const ago = (seconds) => page.formatRelative(new Date(NOW - seconds * 1000).toISOString(), NOW);

  before(() => { page = loadApp(); });

  it('calls the last few seconds what they are', () => {
    assert.strictEqual(ago(0), 'just now');
    assert.strictEqual(ago(44), 'just now');
  });

  it('counts minutes, singular at the boundary', () => {
    assert.strictEqual(ago(45), '1 min ago');
    assert.strictEqual(ago(120), '2 mins ago');
    assert.strictEqual(ago(59 * 60 + 59), '59 mins ago', 'it never reads "60 mins ago"');
  });

  it('switches to hours on the hour, and to days on the day', () => {
    assert.strictEqual(ago(3600), '1 hr ago');
    assert.strictEqual(ago(90 * 60), '1 hr ago', 'floored: an hour and a half is not two hours');
    assert.strictEqual(ago(23 * 3600 + 3599), '23 hrs ago');
    assert.strictEqual(ago(86400), '1 day ago');
    assert.strictEqual(ago(29 * 86400), '29 days ago');
  });

  it('does not read a clock skew as the far future', () => {
    assert.strictEqual(page.formatRelative(new Date(NOW + 30000).toISOString(), NOW), 'just now');
  });

  it('says nothing about a time it does not have', () => {
    assert.strictEqual(page.formatRelative(null, NOW), '-');
    assert.strictEqual(page.formatRelative('not a date', NOW), '-');
  });

  it('keeps the exact time available beside it', () => {
    assert.strictEqual(page.formatTime('2026-09-20T12:00:00Z'), '09/20 06:00:00');
  });
});
