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

function overviewPage(stats) {
  const context = vm.createContext({
    AbortSignal,
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

describe('the Overview keeps historical failures available', () => {
  after(() => { try { closeDb(); } catch { /* not open */ } });

  it('retains refused callers in the history', () => {
    const page = overviewPage(statsWith([200, 401, 404, 400]));
    assert.ok(page.errorRows.length > 0, 'the fixture must produce error rows, or this proves nothing');
    assert.ok(page.errorRows.every((row) => row.status < 500));
  });

  it('retains upstream failures alongside refused callers', () => {
    const page = overviewPage(statsWith([200, 401, 502]));
    assert.ok(page.errorRows.some((row) => row.status === 502));
  });

  it('says nothing either way when the period is clean', () => {
    const page = overviewPage(statsWith([200, 200]));
    assert.deepStrictEqual(page.errorRows, []);
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

  it('keeps history collapsed below current status even when it contains a 5xx', () => {
    assert.match(html, /<details class="mb-8 order-3">/);
    assert.doesNotMatch(html, /hasServerErrors|<details[^>]+\bopen\b/);
    assert.match(html, /<div class="order-1">/);
    assert.ok(html.indexOf('<div class="order-1">') < html.indexOf('<details class="mb-8 order-3">'), 'screen readers must encounter current status before history');
  });

  it('provides a real link for keyboard navigation to the error requests', () => {
    const link = /<a href="#logs"[^>]*@click="openErrorLogs\(row\)"[^>]*>/.exec(html);
    assert.ok(link, 'error navigation has no focusable link');
    assert.match(link[0], /:aria-label=/);
    assert.doesNotMatch(html, /<tr @click=/);
  });
});
