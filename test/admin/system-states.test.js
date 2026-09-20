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
function loadSystem(fetchImpl, windowOverrides = {}) {
  const stores = {};
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams,
    Alpine: { store: (n, v) => (v === undefined ? stores[n] : (stores[n] = v)) },
    fetch: fetchImpl, navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {}, ...windowOverrides },
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

// P12 in docs/PWA-AUDIT.md: iOS fires no install event, so copy is the only route — and copy that
// shows up where the browser will not offer an install is worse than none.
describe('the System page offers the install only where it is possible', () => {
  const inside = (mode, extra = {}) => ({
    isSecureContext: true,
    matchMedia: (query) => ({ matches: query === `(display-mode: ${mode})` }),
    ...extra,
  });
  const hint = (overrides) => loadSystem(answer(200, { providers: [] }), overrides).installHint;

  it('offers it in a secure browser tab', () => {
    assert.strictEqual(hint(inside('browser')), true);
  });

  it('stays quiet once the app already runs standalone', () => {
    assert.strictEqual(hint(inside('standalone')), false);
  });

  it('stays quiet on iOS, where standalone is a navigator flag and not a media query', () => {
    assert.strictEqual(hint(inside('browser', { navigator: { standalone: true } })), false);
  });

  it('stays quiet on an insecure origin, where no browser will offer it at all', () => {
    assert.strictEqual(hint({ ...inside('browser'), isSecureContext: false }), false);
  });
});

// 0 / 0 is exactly what an idle gateway renders, so a figure that falls back to zero leaves an
// unreachable gateway indistinguishable from a healthy one — assert both states, never one.
describe('the System page never renders an unread gateway as an idle one', () => {
  const FIGURES = ['Running', 'Waiting', 'Streams', 'Open circuits'];

  const concurrencyCard = () => {
    const html = compose();
    const page = html.slice(html.indexOf('<!-- SYSTEM PAGE -->'));
    const start = page.indexOf('>Concurrency<');
    const end = page.indexOf('<!-- ================= PROVIDERS', start);
    assert.ok(start > -1 && end > start, 'the Concurrency card is still a section of the System page');
    return page.slice(start, end);
  };

  const expressionFor = (card, label) => {
    const match = card.slice(card.indexOf(`>${label}</span>`)).match(/x-text="([^"]+)"/);
    assert.ok(match, `${label} renders through an x-text expression`);
    return match[1];
  };

  const render = (expression, scope) => String(vm.runInNewContext(`(${expression})`, { ...scope }));

  const neverAnswered = (healthRead) => ({
    healthRead,
    health: { uptime: null, providers: {}, queue: {} },
    openCircuits: [],
    providersLoaded: false,
    providersError: null,
  });

  const idle = {
    healthRead: 'ok',
    health: {
      uptime: 42,
      providers: {},
      queue: { active: 0, max_concurrent: 0, pending: 0, active_streams: 0, max_stream_concurrent: 0 },
    },
    openCircuits: [],
    providersLoaded: true,
    providersError: null,
  };

  for (const state of ['pending', 'failed']) {
    it(`renders no figure as a reading while the read is ${state}`, () => {
      const card = concurrencyCard();
      for (const label of FIGURES) {
        assert.strictEqual(
          render(expressionFor(card, label), neverAnswered(state)),
          '—',
          `${label} claims a reading the gateway never gave it`,
        );
      }
    });
  }

  it('renders an idle gateway differently from one that never answered', () => {
    const card = concurrencyCard();
    for (const label of FIGURES) {
      const expression = expressionFor(card, label);
      assert.notStrictEqual(
        render(expression, idle),
        render(expression, neverAnswered('failed')),
        `${label} renders an unreachable gateway exactly like an idle one`,
      );
    }
  });

  it('still reports the figures it did read', () => {
    const card = concurrencyCard();
    assert.strictEqual(render(expressionFor(card, 'Running'), idle), '0 / 0');
    assert.strictEqual(render(expressionFor(card, 'Waiting'), idle), '0');
    assert.strictEqual(render(expressionFor(card, 'Streams'), idle), '0 / 0');
    assert.strictEqual(render(expressionFor(card, 'Open circuits'), idle), 'none');
  });
});
