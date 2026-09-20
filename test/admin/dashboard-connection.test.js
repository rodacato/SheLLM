'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// app.js is loaded the way the browser loads it. Alpine's store is the one thing stood in for —
// it arrives from a CDN — and the page's own `alpine:init` body then runs for real against it.
function loadApp(fetchImpl, extraFiles = []) {
  const stores = {};
  const listeners = {};
  const context = vm.createContext({
    console,
    Alpine: { store: (name, value) => (value === undefined ? stores[name] : (stores[name] = value)) },
    fetch: fetchImpl,
    navigator: { onLine: true },
    URLSearchParams,
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: (event, fn) => { listeners[event] = fn; } },
    document: { addEventListener: (event, fn) => { listeners[event] = fn; } },
  });

  for (const file of ['app.js', ...extraFiles]) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  listeners['alpine:init']();

  return { context, stores, listeners, page: vm.runInContext('app()', context) };
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const HEALTHY = { uptime_seconds: 271_000, status: 'ok', queue: { active: 0, max_concurrent: 3 } };
const VIEWS = path.join(__dirname, '../../src/admin/views/pages');

describe('the admin knows when it could not ask', () => {
  // The sidebar dot is the one element whose job is to say the server is alive. It kept saying so
  // after it died: fetchHealth assigned only on res.ok and swallowed the throw, so an unreachable
  // gateway left the last good uptime on screen, refreshed every 30s and never changing.
  it('stops reporting the last good uptime once a health read fails', async () => {
    let reachable = true;
    const { page } = loadApp(async () => {
      if (!reachable) throw new TypeError('Failed to fetch');
      return json(200, HEALTHY);
    });

    await page.fetchHealth();
    assert.strictEqual(page.healthRead, 'ok');
    assert.strictEqual(page.health.uptime, 271_000);

    reachable = false;
    await page.fetchHealth();
    assert.strictEqual(page.healthRead, 'failed', 'a dead gateway still read as UP');
  });

  it('marks the connection degraded on a failed read and clears it on the next good one', async () => {
    let status = 500;
    const { page, stores } = loadApp(async () => json(status, HEALTHY));

    await page.fetchHealth();
    assert.strictEqual(stores.connection.degraded, true);
    assert.match(stores.connection.message, /answered 500/);
    assert.strictEqual(page.lastReadAt, null, 'a failed read must not count as a read');

    status = 200;
    await page.fetchHealth();
    assert.strictEqual(stores.connection.degraded, false);
    assert.match(page.lastReadAt, /^\d{2}:\d{2}:\d{2}$/, 'the footer had no read time to show');
  });

  // A table cannot tell "nothing happened" from "I could not ask" while both answer with nothing.
  it('apiRead throws rather than answering a failed read with no rows', async () => {
    const { context } = loadApp(async () => json(503, { error: 'down' }));
    const apiRead = vm.runInContext('apiRead', context);
    await assert.rejects(() => apiRead('/admin/logs'), { name: 'ApiError', status: 503 });
  });

  // "No logs found" on a gateway that never answered reads as an empty database. The table has to
  // hold the failure itself — the shell banner says the connection is down, not which read failed.
  it('a table that could not be read does not report itself as empty', async () => {
    let reachable = false;
    const { context } = loadApp(
      async () => { if (!reachable) throw new TypeError('Failed to fetch'); return json(200, { logs: [{ id: 1 }], total: 1 }); },
      ['logs.js'],
    );
    const page = vm.runInContext('logsPage()', context);

    await page.fetchLogs();
    assert.ok(page.loadError, 'the table kept no record that the read failed');
    assert.strictEqual(page.logs.length, 0);
    assert.strictEqual(page.total, 0, 'a failed read left a count next to an error');

    reachable = true;
    await page.fetchLogs();
    assert.strictEqual(page.loadError, null, 'the failure outlived the read that fixed it');
    assert.strictEqual(page.total, 1);
  });

  // The state above is worth nothing if the markup never asks for it.
  it('both tables branch their empty row on that failure', () => {
    for (const [file, field] of [['logs.html', 'loadError'], ['keys.html', 'loadError']]) {
      const html = fs.readFileSync(path.join(VIEWS, file), 'utf8');
      const emptyRow = html.split('\n').find((line) => line.includes('Loading...'));
      assert.ok(emptyRow, `${file} no longer has an empty-row cell — this check proves nothing`);
      assert.match(emptyRow, new RegExp(field), `${file} still renders a failed read as an empty table`);
    }
  });

  it('goes degraded when the browser goes offline, with no request involved', async () => {
    const { stores, listeners, context } = loadApp(async () => json(200, HEALTHY));
    assert.strictEqual(stores.connection.degraded, false);

    vm.runInContext('navigator', context).onLine = false;
    listeners.offline();

    assert.strictEqual(stores.connection.degraded, true);
    assert.match(stores.connection.message, /offline/);
  });
});
