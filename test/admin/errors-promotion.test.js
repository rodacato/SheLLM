'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { initDb, closeDb, getDb, insertRequestLog } = require('../../src/db');
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

describe('the Errors section says whose failures they were', () => {
  after(() => { try { closeDb(); } catch { /* not open */ } });

  function freshDb() {
    try { closeDb(); } catch { /* not open */ }
    initDb(':memory:');
  }

  it('counts every unauthenticated failure, past the rows the breakdown keeps', () => {
    freshDb();
    for (let i = 0; i < 25; i++) {
      insertRequestLog({ request_id: `u${i}`, client_name: null, status: 401, error_code: 'auth_required', path: `/probe/${i}` });
    }
    insertRequestLog({ request_id: 'k', client_name: 'app', status: 401, error_code: 'auth_required', path: '/v1/messages' });
    insertRequestLog({ request_id: 'ok', client_name: null, status: 200, path: '/health' });

    assert.strictEqual(dbStats.errorBreakdown(WINDOW).length, 20, 'the fixture must overflow the breakdown, or this proves nothing');
    assert.strictEqual(dbStats.unauthenticatedErrors(WINDOW), 25);
  });

  it('lists the most recent group first, even when an older one is larger', () => {
    freshDb();
    ['a', 'b', 'c'].forEach((id) => insertRequestLog({ request_id: id, client_name: 'app', status: 400, error_code: 'invalid_request' }));
    getDb().prepare("UPDATE request_logs SET created_at = datetime('now', '-2 days')").run();
    insertRequestLog({ request_id: 'd', client_name: 'app', status: 502, error_code: 'provider_error' });

    assert.deepStrictEqual(dbStats.errorBreakdown(WINDOW).map((row) => [row.status, row.count]), [[502, 1], [400, 3]]);
  });

  it('splits the failures so they add up to the headline count', () => {
    const page = overviewPage({
      total_requests: 200,
      error_rate: { success_pct: 80, server_error_pct: 2.5, by_class: { '2xx': 160, '4xx': 35, '5xx': 5 }, unauthenticated: 30 },
    });
    const count = Object.fromEntries(page.outcomeParts.map((part) => [part.key, part.count]));
    assert.deepStrictEqual(count, { ok: 160, server: 5, caller: 5, unauthenticated: 30 });
    assert.strictEqual(count.server + count.caller + count.unauthenticated, page.errorCount(page.stats.error_rate));
    assert.deepStrictEqual(Array.from(page.outcomeParts, (part) => part.pct), [80, 2.5, 2.5, 15]);
  });

  it('draws nothing to divide when the period has no requests', () => {
    const page = overviewPage({ total_requests: 0, error_rate: { success_pct: 0, server_error_pct: 0, by_class: {}, unauthenticated: 0 } });
    assert.ok(page.outcomeParts.every((part) => part.count === 0 && part.pct === 0));
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

  it('keeps history below current status even when it contains a 5xx', () => {
    assert.match(html, /<section class="mb-8 order-3">/);
    assert.doesNotMatch(html, /hasServerErrors/);
    assert.match(html, /<div class="order-1">/);
    assert.ok(html.indexOf('<div class="order-1">') < html.indexOf('<section class="mb-8 order-3">'), 'screen readers must encounter current status before history');
  });

  // Collapsed, the section hid the one answer it exists for: whether any of it was SheLLM's.
  it('shows the split without opening anything', () => {
    assert.doesNotMatch(html, /<details/);
    assert.match(html, /x-for="part in outcomeParts"/);
  });

  it('provides a real link for keyboard navigation to the error requests', () => {
    const link = /<a :href="errorLogsHref\(row\)"[^>]*>/.exec(html);
    assert.ok(link, 'error navigation has no focusable link');
    assert.match(link[0], /:aria-label=/);
    assert.doesNotMatch(html, /<tr @click=/);
  });
});
