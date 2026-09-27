'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { compose } = require('../../src/admin/views');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// The page's own files, loaded the way the browser loads them. fetch records what was asked and
// answers from `routes`; the timers are hand-driven so a poll is a call, not a wait.
function loadOverview({ routes = {}, outline = '#849397' } = {}) {
  const asked = [];
  const timers = [];
  const built = [];
  class Chart {
    constructor(canvas, config) { built.push(config); }
    destroy() {}
  }
  const context = vm.createContext({
    AbortSignal,
    console, Intl, Date, Math, JSON, Chart,
    getComputedStyle: () => ({ getPropertyValue: (name) => (name === '--outline' ? outline : '#22c55e') }),
    document: { documentElement: {}, hidden: false, addEventListener: () => {} },
    fetch: async (url) => {
      asked.push(url);
      const route = routes[url];
      if (!route) throw new Error('offline');
      return { ok: route.status < 400, status: route.status, json: async () => route.body };
    },
    navigator: { onLine: true },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {},
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'overview.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  const page = Object.assign(context.overviewPage(), { $nextTick: () => {}, $refs: {} });
  return { page, asked, timers, built };
}

const { setImmediate: settle } = require('node:timers/promises');

const overviewMarkup = () => {
  const html = compose();
  const start = html.indexOf('<!-- OVERVIEW PAGE -->');
  assert.ok(start > -1, 'the Overview page is still composed into the dashboard');
  const end = html.indexOf('<!-- LOGS PAGE -->', start);
  assert.ok(end > start, 'the Logs page still follows the Overview');
  return html.slice(start, end);
};

const render = (expression, scope) => String(vm.runInNewContext(`(${expression})`, { ...scope }));

const provider = (over = {}) => ({
  name: 'claude', enabled: true, installed: true, authenticated: true,
  circuit: { state: 'closed', failures: 0 }, ...over,
});

describe('Overview reads everything it shows, every time it reads', () => {
  const routes = {
    '/admin/stats': { status: 200, body: { window: {} } },
    '/admin/providers': { status: 200, body: { providers: [provider()] } },
  };

  // A provider that lost its auth stayed green until a full reload: only /stats was ever re-read.
  it('re-reads the providers on each tick of the loop', async () => {
    const { page, asked, timers } = loadOverview({ routes });
    page.startAutoRefresh();
    assert.strictEqual(timers.length, 1, 'the loop did not arm');
    timers[0].fn();
    await settle();
    assert.deepEqual([...asked].sort(), ['/admin/providers', '/admin/stats']);
  });

  it('re-reads the providers when asked to re-read the page', async () => {
    const { page, asked } = loadOverview({ routes });
    page.refreshNow();
    await settle();
    assert.ok(asked.includes('/admin/providers'), 'the button re-read only part of the page');
    assert.ok(asked.includes('/admin/stats'));
  });

  // Coming back to the page used to show the last visit's figures for a whole interval.
  it('reads on entering the page, with auto-refresh off too', async () => {
    const { page, asked } = loadOverview({ routes });
    page.refreshMs = 0;
    page.startAutoRefresh({ now: true });
    await settle();
    assert.strictEqual(asked.length, 2, 'entering the page did not read it');

    page.stopAutoRefresh();
    page.startAutoRefresh({ now: true });
    await settle();
    assert.strictEqual(asked.length, 4, 'returning to the page did not read it again');
  });

  it('enters through that read rather than guarding on data it already holds', () => {
    const root = /<div x-show="page === 'overview'"[^>]*>/.exec(overviewMarkup());
    assert.ok(root, 'the Overview root is gone');
    assert.match(root[0], /startAutoRefresh\(\{ now: true \}\)/);
    assert.doesNotMatch(root[0], /!stats|providers\.length === 0/, 'a guard skips the read on revisit again');
  });

  it('drops the providers it can no longer vouch for when a read fails', async () => {
    const { page } = loadOverview({ routes });
    await page.fetchProviders();
    assert.strictEqual(page.providers.length, 1, 'the fixture must load a provider first');

    const failing = loadOverview({ routes: {} });
    failing.page.providers = page.providers;
    await failing.page.fetchProviders();
    assert.strictEqual(failing.page.providers.length, 0, 'a stale green row sat beside the error');
    assert.ok(failing.page.providersError);
  });
});

describe('the queue never draws a reading it did not get', () => {
  const card = () => {
    const html = overviewMarkup();
    const start = html.indexOf('>Request Queue<');
    const end = html.indexOf('>Providers<', start);
    assert.ok(start > -1 && end > start, 'the Request Queue card is still on the Overview');
    return html.slice(start, end);
  };

  const expressionsAfter = (text, label) => {
    const from = text.indexOf(`>${label}</span>`);
    assert.ok(from > -1, `${label} is still a figure on the card`);
    const next = text.indexOf('</div>', from);
    return [...text.slice(from, next).matchAll(/x-text="([^"]+)"/g)].map((m) => m[1]);
  };

  const stale = (healthRead) => ({
    healthRead,
    health: { queue: { active: 2, max_concurrent: 4, pending: 1, active_streams: 1, max_stream_concurrent: 2 } },
    queueSaturation: () => 50,
  });

  for (const label of ['Active', 'Streams']) {
    it(`leaves ${label}'s denominator out until the read succeeds`, () => {
      const [value, denominator] = expressionsAfter(card(), label);
      assert.ok(denominator, `${label} has no denominator to check`);
      for (const state of ['pending', 'failed']) {
        assert.strictEqual(render(value, stale(state)), '—');
        assert.strictEqual(render(denominator, stale(state)), '', `${label} rendered — / N while ${state}`);
      }
      assert.match(render(denominator, stale('ok')), /^\/ \d$/);
    });
  }

  // After a failure health keeps its last good reading, and the bar kept drawing it.
  it('empties the bar once a read fails', () => {
    const { page } = loadOverview();
    page.health = stale('ok').health;
    page.healthRead = 'ok';
    assert.strictEqual(page.queueSaturation(), 50, 'the fixture must fill the bar when read');
    page.healthRead = 'failed';
    assert.strictEqual(page.queueSaturation(), 0);
  });

  it('says it could not read, not that it has not read yet', () => {
    const text = card();
    const caption = /x-text="(healthRead === 'ok' \? queueSaturation\(\)[^"]+)"/.exec(text);
    assert.ok(caption, 'the saturation caption is gone');
    assert.strictEqual(render(caption[1], stale('failed')), 'could not read');
    assert.strictEqual(render(caption[1], stale('pending')), 'not read yet');
    assert.strictEqual(render(caption[1], stale('ok')), '50% of concurrency in use');
  });

  // A title attribute is reachable by mouse alone.
  it('shows its explanation instead of hiding it behind a hover', () => {
    const text = card();
    assert.doesNotMatch(text, /\[\?\]/);
    assert.match(text, />CLI providers run as subprocesses\. Active = running now \(max concurrent\)\. Pending = waiting in line\.</);
  });
});

describe('a provider row says what routing will actually do', () => {
  const { page } = loadOverview();

  it('does not call a provider behind an open circuit ready', () => {
    const open = provider({ circuit: { state: 'open', failures: 5 } });
    assert.strictEqual(page.providerLabel(open), 'open · 5 failures');
    assert.strictEqual(page.providerDot(open), 'dot-red');
    assert.strictEqual(page.providerReady(open), false);
  });

  it('marks a half-open circuit as a warning, not a failure', () => {
    const half = provider({ circuit: { state: 'half_open', failures: 3 } });
    assert.strictEqual(page.providerLabel(half), 'half_open · 3 failures');
    assert.strictEqual(page.providerDot(half), 'bg-status-warn');
  });

  it('still reads ready when the circuit is closed or unreported', () => {
    for (const prov of [provider(), provider({ circuit: undefined })]) {
      assert.strictEqual(page.providerLabel(prov), 'ready');
      assert.strictEqual(page.providerDot(prov), 'dot-green');
    }
  });

  it('names the missing sign-in before the circuit it caused', () => {
    const prov = provider({ authenticated: false, circuit: { state: 'open', failures: 3 } });
    assert.strictEqual(page.providerLabel(prov), 'no auth');
    assert.strictEqual(page.providerLabel(provider({ installed: false })), 'missing');
    assert.strictEqual(page.providerLabel(provider({ enabled: false })), 'disabled');
  });

  // The command that fixes a provider lives on System; a row that only reports it is a dead end.
  it('links every row short of ready to System, and no ready row', () => {
    const html = overviewMarkup();
    const row = /<template x-for="prov in providers"[^>]*>\s*<a ([^>]*)>/.exec(html);
    assert.ok(row, 'the provider rows are not links');
    const href = /:href="([^"]+)"/.exec(row[1]);
    assert.ok(href, 'the row has no conditional href');

    const scope = (prov) => ({ prov, providerReady: page.providerReady.bind(page) });
    assert.strictEqual(render(href[1], scope(provider())), 'null');
    for (const prov of [provider({ authenticated: false }), provider({ enabled: false }),
      provider({ circuit: { state: 'open', failures: 3 } })]) {
      assert.strictEqual(render(href[1], scope(prov)), '#system');
    }
  });
});

describe('the Overview charts read the palette and say why they are empty', () => {
  const stats = () => {
    const now = Date.now();
    return {
      total_requests: 2,
      window: { from: new Date(now - 7200000).toISOString(), hours: 2 },
      timeline: [0, 1].map((h) => ({ bucket_at: new Date(now - (1 - h) * 3600000).toISOString(), requests: 1, errors: 0 })),
      recent_requests: [
        { created_at: '2026-09-19 12:00:00', duration_ms: 900, status: 200 },
        { created_at: '2026-09-19 13:00:00', duration_ms: 400, status: 200 },
      ],
    };
  };

  // Retyped, the grid kept the old grey the day --outline changed.
  it('draws the grid from --outline rather than a copy of it', () => {
    const { page, built } = loadOverview({ outline: '#102030' });
    page.stats = stats();
    page.$refs = { timeline: {}, scatter: {} };
    page.renderTimeline();
    page.renderScatter();
    assert.strictEqual(built.length, 2, 'both charts must render for this to mean anything');
    for (const config of built) {
      assert.strictEqual(config.options.scales.y.grid.color, 'rgba(16,32,48,0.1)');
      assert.strictEqual(config.options.scales.x.grid.color, 'rgba(16,32,48,0.1)');
    }
    assert.doesNotMatch(fs.readFileSync(path.join(JS_DIR, 'overview.js'), 'utf8'), /'rgba\(\d/);
  });

  it('keeps each chart card and puts a line where the chart cannot draw', () => {
    const html = overviewMarkup();
    for (const ref of ['scatter', 'timeline']) {
      const at = html.indexOf(`x-ref="${ref}"`);
      assert.ok(at > -1, `the ${ref} canvas is gone`);
      const cardStart = html.lastIndexOf('class="bg-surface-container p-5', at);
      const cardTag = html.slice(html.lastIndexOf('<div', cardStart), html.indexOf('>', cardStart));
      assert.doesNotMatch(cardTag, /x-show/, `the ${ref} card still vanishes`);
      const after = html.slice(at, html.indexOf('</div>', html.indexOf('</div>', at) + 6));
      assert.match(after, /x-text="sparseCaption\(\)"/, `the ${ref} card says nothing when empty`);
    }
  });

  it('says there were no requests, or how many there were', () => {
    const { page } = loadOverview();
    page.stats = { total_requests: 0, window: { hours: 0 } };
    assert.strictEqual(page.sparseCaption(), 'No requests in this window.');
    page.stats = { total_requests: 1, window: { hours: 0.2 } };
    assert.strictEqual(page.sparseCaption(), '1 request over 12 min');
  });
});

describe('the Overview frame', () => {
  it('hides the window line until there is a window to describe', () => {
    const html = overviewMarkup();
    const line = html.slice(html.indexOf('<!-- Every figure below is over this window'));
    const tag = /<div[^>]*>/.exec(line)[0];
    assert.match(tag, /x-show="stats"/);
    assert.doesNotMatch(line.slice(0, line.indexOf('</div>')), /: '—'/, 'a stray dash is still the fallback');
  });

  // Demoted below Capacity with no label of its own, Errors read as part of Capacity.
  it('gives Errors its own section eyebrow', () => {
    const html = overviewMarkup();
    const eyebrow = /<span class="([^"]*)">Errors<\/span>/.exec(html);
    assert.ok(eyebrow, 'Errors has no eyebrow');
    assert.match(eyebrow[1], /tracking-\[0\.2em\] text-outline uppercase/);
  });

  it('hides its icons from screen readers', () => {
    const icons = [...overviewMarkup().matchAll(/<span class="material-symbols-outlined[^"]*"[^>]*>/g)];
    assert.ok(icons.length > 0, 'found no icons — this check proves nothing');
    for (const [tag] of icons) assert.match(tag, /aria-hidden="true"/, tag);
  });
});
