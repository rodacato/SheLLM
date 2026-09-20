'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const { compose } = require('../../src/admin/views');

// The page's own files, loaded the way the browser loads them; only fetch is stood in for. Arrays
// the page builds belong to the vm's realm, so assert on length rather than deep-equality.
function loadSystem(fetchImpl) {
  const stores = {};
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams,
    Alpine: { store: (n, v) => (v === undefined ? stores[n] : (stores[n] = v)) },
    fetch: fetchImpl, navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'system.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return context.systemPage();
}

const answer = (status, body) => async () => ({
  ok: status < 400, status,
  json: async () => body,
  headers: { get: () => null },
});

describe('the System page tells a failed provider read apart from an empty one', () => {
  it('has read nothing before it reads', async () => {
    const page = loadSystem(answer(200, { providers: [] }));
    assert.strictEqual(page.providersLoaded, false);
  });

  it('says it could not read, rather than rendering nothing', async () => {
    const page = loadSystem(answer(500, { error: 'boom' }));
    await page.fetchProviders();

    assert.strictEqual(page.providersLoaded, true);
    assert.ok(page.providersError, 'a failed read has to leave something to render');
    assert.strictEqual(page.providers.length, 0, 'and it must not invent providers');
  });

  it('tells an empty answer apart from a failed one', async () => {
    const page = loadSystem(answer(200, { providers: [] }));
    await page.fetchProviders();

    assert.strictEqual(page.providersLoaded, true);
    assert.strictEqual(page.providersError, null, 'a 200 with no providers is not an error');
    assert.strictEqual(page.providers.length, 0);
  });

  it('keeps the providers it did read', async () => {
    const page = loadSystem(answer(200, { providers: [{ name: 'claude', enabled: true }] }));
    await page.fetchProviders();

    assert.strictEqual(page.providersError, null);
    assert.strictEqual(page.providers.length, 1);
  });

  it('renders a distinct line for each of the three states', () => {
    const html = compose();
    const start = html.indexOf('<!-- SYSTEM PAGE -->');
    assert.ok(start > -1);
    const page = html.slice(start);

    // The control: this page has always had a loading line. If it ever stops matching, the two
    // assertions under it are checking a page that moved, not a page that gained two states.
    assert.ok(page.includes('Loading…'), 'the loading line is still there');

    assert.ok(page.includes('Could not read the providers'), 'unreachable');
    assert.ok(page.includes('No providers configured.'), 'genuinely empty');
  });
});

describe('the System page reports a provider toggle that did not apply', () => {
  it('says so when the gateway refuses the write', async () => {
    const page = loadSystem(answer(403, { error: 'nope' }));
    await page.toggleProvider({ name: 'claude', enabled: true });

    assert.ok(page.toggleError, 'a silent failed write leaves the operator believing a false state');
    assert.ok(page.toggleError.includes('claude'), 'and it names which provider did not change');
    assert.strictEqual(page.busy, null, 'the spinner clears either way');
  });

  it('says so when the gateway does not answer at all', async () => {
    const page = loadSystem(async () => { throw new Error('offline'); });
    await page.toggleProvider({ name: 'codex', enabled: false });

    assert.ok(page.toggleError.includes('codex'));
  });

  it('stays quiet when the write lands', async () => {
    const page = loadSystem(answer(200, { providers: [{ name: 'claude', enabled: false }] }));
    await page.toggleProvider({ name: 'claude', enabled: true });

    assert.strictEqual(page.toggleError, null, 'a successful toggle reports nothing');
  });
});
