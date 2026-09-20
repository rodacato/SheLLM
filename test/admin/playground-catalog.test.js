'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// The page object is built inside the vm, so its arrays belong to that realm and compare unequal
// against a plain one however identical they look. Spread before asserting.
const notes = (page) => [...page.catalogNotes];

function loadPlayground(fetchImpl) {
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
    fetch: fetchImpl,
  });
  for (const f of ['app.js', 'playground.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), context, { filename: f });
  }
  return context.playgroundPage();
}

const answering = (providers) => async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ providers }),
});

// The panel exists to say where the model names came from. Going quiet on a failed read makes
// "the gateway did not answer" and "no provider is enabled" the same screen — which is the
// defect the file's own comment describes, one function above.
describe('the Playground says where its model names came from, or why it cannot', () => {
  it('reports the provenance when the read works', async () => {
    const page = loadPlayground(answering([
      { name: 'claude', enabled: true, version: '2.1.273', catalog: { source: 'cli', models: [{ id: 'claude-fable' }] } },
    ]));
    await page.fetchModels();

    assert.strictEqual(page.catalogsError, null);
    assert.strictEqual(page.catalogsLoaded, true);
    assert.deepStrictEqual(notes(page), ['claude: asked the CLI']);
  });

  it('names the status when the gateway refuses', async () => {
    const page = loadPlayground(async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) }));
    await page.fetchModels();

    assert.ok(page.catalogsError, 'a refused read is reported');
    assert.match(page.catalogsError, /503/);
    assert.deepStrictEqual(notes(page), [], 'and there is nothing to be provenance about');
  });

  it('names the failure when the request never lands', async () => {
    const page = loadPlayground(async () => { throw new Error('network down'); });
    await page.fetchModels();

    assert.strictEqual(page.catalogsError, 'the gateway did not answer',
      'the panel reports what every other read on the dashboard reports');
  });

  // The two states this finding is about: both render nothing from catalogNotes, and the panel
  // must still tell them apart.
  it('tells an empty answer apart from no answer', async () => {
    const empty = loadPlayground(answering([{ name: 'codex', enabled: false }]));
    await empty.fetchModels();

    assert.strictEqual(empty.catalogsError, null, 'an honest empty list is not an error');
    assert.strictEqual(empty.catalogsLoaded, true);
    assert.deepStrictEqual(notes(empty), []);

    const failed = loadPlayground(async () => { throw new Error('offline'); });
    await failed.fetchModels();
    assert.notStrictEqual(failed.catalogsError, empty.catalogsError,
      'the two states are indistinguishable again');
  });

  it('leaves the field usable either way', async () => {
    const page = loadPlayground(async () => { throw new Error('offline'); });
    const before = page.model;
    await page.fetchModels();

    assert.strictEqual(page.model, before, 'a failed catalog read must not clear the typed model');

    const view = fs.readFileSync(path.join(__dirname, '../../src/admin/views/pages/playground.html'), 'utf8');
    assert.match(view, /catalogsError/, 'the view renders the failure');
    assert.match(view, /The field still accepts any name/, 'and says the operator is not blocked');
  });
});
