'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { initDb, closeDb, insertRequestLog } = require('../../src/db');
const dbStats = require('../../src/db/stats');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const OVERVIEW_HTML = path.join(__dirname, '../../src/admin/views/pages/overview.html');
const WINDOW = '-30 days';

// The page's own files, loaded the way the browser loads them. hasServerErrors reads the rows the
// server really sends, so nothing needs stubbing past the browser globals.
function overviewPage(stats) {
  const context = vm.createContext({
    console, Intl, Date, Math, JSON,
    Chart: class { destroy() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { documentElement: {}, addEventListener: () => {} },
    fetch: async () => {}, navigator: { onLine: true },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'overview.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return Object.assign(vm.runInContext('overviewPage()', context), { stats });
}

function statsWith(rows) {
  try { closeDb(); } catch { /* not open */ }
  initDb(':memory:');
  rows.forEach((status, i) => insertRequestLog({
    request_id: `e${i}`, client_name: 'app', provider: 'claude', model: 'claude',
    status, duration_ms: 10,
  }));
  return { error_breakdown: dbStats.errorBreakdown(WINDOW) };
}

describe('Errors leads the page only when the gateway is what failed', () => {
  after(() => { try { closeDb(); } catch { /* not open */ } });

  it('does not promote a period of refused callers', () => {
    const page = overviewPage(statsWith([200, 401, 404, 400]));
    assert.ok(page.errorRows.length > 0, 'the fixture must produce error rows, or this proves nothing');
    assert.strictEqual(page.hasServerErrors, false);
  });

  it('promotes as soon as one request failed upstream', () => {
    const page = overviewPage(statsWith([200, 401, 502]));
    assert.strictEqual(page.hasServerErrors, true);
  });

  it('says nothing either way when the period is clean', () => {
    const page = overviewPage(statsWith([200, 200]));
    assert.deepStrictEqual(page.errorRows, []);
    assert.strictEqual(page.hasServerErrors, false);
  });
});

describe('the Errors table spends its columns on facts it has', () => {
  let html;

  before(() => { html = fs.readFileSync(OVERVIEW_HTML, 'utf8'); });

  // path was '-' on every row the page could draw; the query already groups by model.
  it('reports the model rather than the route', () => {
    assert.match(html, /<th[^>]*>Model<\/th>/);
    assert.doesNotMatch(html, /<th[^>]*>Route<\/th>/);
    assert.match(html, /x-text="row\.model"/);
  });

  it('orders the block by severity rather than by presence', () => {
    assert.match(html, /hasServerErrors \? 'order-1' : 'order-3'/);
    assert.doesNotMatch(html, /x-if="stats && errorRows\.length > 0"[^]{0,120}order-1"/);
  });
});
