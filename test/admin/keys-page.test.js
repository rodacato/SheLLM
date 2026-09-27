'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const markup = () => fs.readFileSync(path.join(__dirname, '../../src/admin/views/pages/keys.html'), 'utf8');

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: { get: () => null },
});

// `answer(method, url, body)` returns a response or throws; every request is recorded.
function loadPage({ answer = () => json(200, { keys: [], logs: [] }), confirmAnswer = true, clipboard } = {}) {
  const requests = [];
  const confirms = [];
  const focused = [];
  const context = vm.createContext({
    AbortSignal,
    console, Intl, Date, URLSearchParams,
    Alpine: { store: () => undefined },
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      const body = options.body === undefined ? undefined : JSON.parse(options.body);
      requests.push({ method, url, body });
      return answer(method, url, body);
    },
    confirm: (message) => { confirms.push(message); return confirmAnswer; },
    navigator: { onLine: true, clipboard },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {}, location: { origin: 'https://shellm.example' }, scrollTo: () => {} },
    document: { addEventListener: () => {}, hidden: false },
  });
  for (const file of ['app.js', 'keys.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  const page = context.keysPage();
  page.$nextTick = (fn) => fn();
  page.$refs = { createName: { focus: () => focused.push('createName') } };
  const run = (code) => vm.runInContext(code, context);
  return { page, requests, confirms, focused, run };
}

const writes = (requests) => requests.filter((r) => r.method !== 'GET');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Keys: expiry colouring', () => {
  const DAY = 24 * 60 * 60 * 1000;

  // The dashboard writes expiries with toISOString(), so what comes back already ends in Z.
  it('reads an expiry that already carries its Z', () => {
    const { page } = loadPage();
    const now = Date.parse('2026-09-27T12:00:00Z');
    assert.strictEqual(page.isExpired({ expires_at: '2026-09-26T12:00:00.000Z' }, now), true);
    assert.strictEqual(page.isExpired({ expires_at: '2026-10-27T12:00:00.000Z' }, now), false);
    assert.strictEqual(page.isExpiringSoon({ expires_at: new Date(now + 3 * DAY).toISOString() }, now), true);
  });

  it('still reads the zoneless shape SQLite stores', () => {
    const { page } = loadPage();
    const now = Date.parse('2026-09-27T12:00:00Z');
    assert.strictEqual(page.isExpired({ expires_at: '2026-09-26 12:00:00' }, now), true);
    assert.strictEqual(page.isExpiringSoon({ expires_at: '2026-09-29 12:00:00' }, now), true);
  });

  it('calls a key with no expiry neither expired nor expiring', () => {
    const { page } = loadPage();
    assert.strictEqual(page.isExpired({ expires_at: null }), false);
    assert.strictEqual(page.isExpiringSoon({ expires_at: null }), false);
  });
});

describe('Keys: one clock for the expiry field', () => {
  it('turns a wall-clock value into the instant it names in a zone without DST', () => {
    const { run } = loadPage();
    const at = run("instantFromZonedInput('2026-10-01T12:00', 'America/Mexico_City')");
    assert.strictEqual(at.toISOString(), '2026-10-01T18:00:00.000Z');
  });

  it('follows DST on both sides of the change', () => {
    const { run } = loadPage();
    assert.strictEqual(run("instantFromZonedInput('2026-07-01T12:00', 'America/New_York')").toISOString(), '2026-07-01T16:00:00.000Z');
    assert.strictEqual(run("instantFromZonedInput('2026-12-01T12:00', 'America/New_York')").toISOString(), '2026-12-01T17:00:00.000Z');
  });

  it('pre-fills the value an instant reads as in the zone, for both stored shapes', () => {
    const { run } = loadPage();
    assert.strictEqual(run("zonedInputValue('2026-07-01T16:00:00.000Z', 'America/New_York')"), '2026-07-01T12:00');
    assert.strictEqual(run("zonedInputValue('2026-12-01 17:00:00', 'America/New_York')"), '2026-12-01T12:00');
    assert.strictEqual(run("zonedInputValue('2026-10-01 18:00:00', 'America/Mexico_City')"), '2026-10-01T12:00');
    assert.strictEqual(run("zonedInputValue(null, 'America/Mexico_City')"), '');
  });

  it('round-trips through the edit form without moving the expiry', () => {
    const { run } = loadPage();
    for (const tz of ['America/Mexico_City', 'America/New_York', 'Asia/Kolkata']) {
      const value = run(`zonedInputValue('2026-11-15T09:30:00.000Z', '${tz}')`);
      assert.strictEqual(run(`instantFromZonedInput('${value}', '${tz}')`).toISOString(), '2026-11-15T09:30:00.000Z', tz);
    }
  });

  it('creates and edits in the dashboard zone, not the browser\'s and not UTC', async () => {
    const { page, requests, run } = loadPage({
      answer: (method) => (method === 'POST' ? json(201, { key: { id: 1, raw_key: 'shellm-x', name: 'app' } }) : json(200, { keys: [], logs: [] })),
    });
    run("setDashboardTimezone('America/New_York')");

    page.openCreate();
    assert.strictEqual(page.timezone, 'America/New_York');
    page.createForm = { ...page.createForm, name: 'app', expires_at: '2026-07-01T12:00' };
    await page.createKey();
    assert.strictEqual(writes(requests)[0].body.expires_at, '2026-07-01T16:00:00.000Z');

    page.startEdit({ id: 1, name: 'app', rpm: 10, expires_at: '2026-07-01T16:00:00.000Z' });
    assert.strictEqual(page.editForm.expires_at, '2026-07-01T12:00');
    await page.saveEdit({ id: 1, name: 'app', rpm: 10 });
    assert.strictEqual(writes(requests)[1].body.expires_at, '2026-07-01T16:00:00.000Z');
  });

  it('names the zone in both expiry labels', () => {
    const html = markup();
    assert.doesNotMatch(html, /Expires \(UTC/, 'the edit label still claims UTC');
    const labels = html.match(/<label[^>]*(create-expires|edit-expires)[^>]*>/g) || [];
    assert.strictEqual(labels.length, 2);
    for (const l of labels) assert.match(l, /timezone/, `label does not name the zone: ${l}`);
  });
});

describe('Keys: reads on every visit', () => {
  it('reads again after a failed read once the page is entered again', async () => {
    let reachable = false;
    const { page } = loadPage({
      answer: (_m, url) => {
        if (!reachable) throw new Error('down');
        return url.includes('/keys') ? json(200, { keys: [{ id: 1, name: 'app' }] }) : json(200, { logs: [] });
      },
    });

    page.visit(true);
    await settle();
    assert.ok(page.loadError, 'the failure was not recorded');

    reachable = true;
    page.visit(false);
    page.visit(true);
    await settle();
    assert.strictEqual(page.loadError, null, 'the failed read outlived the page visit');
    assert.strictEqual(page.keys.length, 1);
  });

  it('reads once per entry, not once per effect re-run', async () => {
    const { page, requests } = loadPage();
    page.visit(true);
    page.visit(true);
    await settle();
    assert.strictEqual(requests.filter((r) => r.url.endsWith('/admin/keys')).length, 1);
  });

  it('is what the page wires its entry to', () => {
    assert.match(markup(), /x-effect="visit\(page === 'keys'\)"/);
  });
});

describe('Keys: a refused write is said where it happened', () => {
  it('shows alert() nowhere', () => {
    assert.doesNotMatch(fs.readFileSync(path.join(JS_DIR, 'keys.js'), 'utf8'), /alert\(/);
  });

  it('keeps the modal open with the server\'s reason when create is refused', async () => {
    const { page } = loadPage({
      answer: (method) => (method === 'POST' ? json(400, { message: 'Client name already exists' }) : json(200, { keys: [], logs: [] })),
    });
    page.openCreate();
    page.createForm.name = 'dup';
    await page.createKey();
    assert.strictEqual(page.createError, 'Client name already exists');
    assert.strictEqual(page.showCreateModal, true);
    assert.strictEqual(page.newKeyResult, null);

    page.openCreate();
    assert.strictEqual(page.createError, null, 'a reopened modal still shows the last refusal');
  });

  it('says an HTML error page is a status, not a network error', async () => {
    const { page } = loadPage({
      answer: (method) => (method === 'POST'
        ? { ok: false, status: 502, json: async () => { throw new SyntaxError('html'); }, headers: { get: () => null } }
        : json(200, { keys: [], logs: [] })),
    });
    page.createForm.name = 'app';
    await page.createKey();
    assert.strictEqual(page.createError, 'the gateway answered 502');
  });

  it('keeps the edit row open with the reason when save is refused', async () => {
    const { page } = loadPage({ answer: () => json(400, { message: 'Client name already exists' }) });
    page.startEdit({ id: 7, name: 'app', rpm: 10 });
    await page.saveEdit({ id: 7, name: 'app', rpm: 10 });
    assert.strictEqual(page.editing, 7);
    assert.strictEqual(page.editError, 'Client name already exists');
  });

  it('puts a refused toggle, rotate or delete on the row it refused', async () => {
    const { page } = loadPage({ answer: () => { throw new Error('down'); } });
    const key = { id: 3, name: 'app', active: 1 };

    await page.toggleActive(key);
    assert.deepStrictEqual({ ...page.rowError }, { id: 3, message: 'the gateway did not answer' });

    page.rowError = null;
    await page.rotateKey(key);
    assert.strictEqual(page.rowError.id, 3);
    assert.strictEqual(page.newKeyResult, null);

    page.rowError = null;
    await page.deleteKey(key);
    assert.strictEqual(page.rowError.id, 3);
  });

  it('clears the row line when the next action on it succeeds', async () => {
    const { page } = loadPage();
    page.rowError = { id: 3, message: 'old' };
    await page.toggleActive({ id: 3, name: 'app', active: 1 });
    assert.strictEqual(page.rowError, null);
  });

  it('renders each surface\'s line', () => {
    const html = markup();
    assert.match(html, /x-text="createError"/);
    assert.match(html, /x-text="editError"/);
    assert.match(html, /x-show="rowError\?\.id === key\.id"/);
  });
});

describe('Keys: expired is a state of its own', () => {
  it('sends nothing when an expired key is toggled', async () => {
    const { page, requests } = loadPage();
    await page.toggleActive({ id: 1, name: 'old', active: 1, expires_at: '2020-01-01T00:00:00.000Z' });
    assert.deepStrictEqual(writes(requests), []);
  });

  it('draws Expired with the toggle inert', () => {
    const html = markup();
    assert.match(html, /:disabled="isExpired\(key\)"/);
    assert.match(html, /isExpired\(key\) \? 'Expired'/);
    assert.match(html, /isExpired\(key\) \? 'text-error'/);
  });
});

describe('Keys: the create modal', () => {
  it('sends one POST however often it is submitted while one is in flight', async () => {
    let release;
    const { page, requests } = loadPage({
      answer: (method) => (method === 'POST'
        ? new Promise((resolve) => { release = () => resolve(json(201, { key: { id: 1, raw_key: 'shellm-x' } })); })
        : json(200, { keys: [], logs: [] })),
    });
    page.createForm.name = 'app';
    const first = page.createKey();
    const second = page.createKey();
    assert.strictEqual(page.creating, true);
    await settle();
    release();
    await Promise.all([first, second]);
    assert.strictEqual(writes(requests).length, 1);
    assert.strictEqual(page.creating, false);
  });

  it('lets a refused create be retried', async () => {
    const { page } = loadPage({ answer: () => json(400, { message: 'nope' }) });
    page.createForm.name = 'app';
    await page.createKey();
    assert.strictEqual(page.creating, false);
  });

  it('puts focus on Client Name when it opens', () => {
    const { page, focused } = loadPage();
    page.openCreate();
    assert.strictEqual(page.showCreateModal, true);
    assert.deepStrictEqual(focused, ['createName']);
  });

  it('is a form, a dialog, and closes on Escape', () => {
    const html = markup();
    const start = html.indexOf('<!-- Create Key Modal -->');
    const modal = html.slice(start);
    assert.match(modal, /<form[^>]*@submit\.prevent="createKey\(\)"/);
    assert.match(modal, /role="dialog" aria-modal="true" aria-labelledby="create-key-title"/);
    assert.match(modal, /id="create-key-title"/);
    assert.match(modal, /@keydown\.escape="showCreateModal = false"/);
    assert.match(modal, /x-ref="createName"/);
    assert.match(modal, /<button type="submit" :disabled="creating"/);
    assert.match(modal, /<button type="button" @click="showCreateModal = false"/, 'Cancel would submit the form');
  });
});

describe('Keys: the only readable copy of a key', () => {
  const WARNING = 'A key that was never copied cannot be read back — rotate it for a new one.';

  it('asks before dismissing a key nobody copied, in the page\'s own words', () => {
    const { page, confirms } = loadPage({ confirmAnswer: false });
    page.showNewKey({ raw_key: 'shellm-x', action: 'created' });
    page.dismissNewKey();
    assert.deepStrictEqual(confirms, [WARNING]);
    assert.ok(page.newKeyResult, 'declining the confirm threw the key away anyway');
    assert.ok(markup().includes(WARNING), 'the confirm no longer quotes the sentence the page shows');
  });

  it('dismisses without asking once the key itself was copied', async () => {
    const { page, confirms } = loadPage({ clipboard: { writeText: async () => {} } });
    page.showNewKey({ raw_key: 'shellm-x', action: 'created' });
    await page.copy('openai', 'export OPENAI_API_KEY=shellm-x');
    page.dismissNewKey();
    assert.strictEqual(confirms.length, 1, 'copying a snippet is not copying the key');

    page.showNewKey({ raw_key: 'shellm-y', action: 'rotated' });
    await page.copy('key', 'shellm-y');
    page.dismissNewKey();
    assert.strictEqual(confirms.length, 1, 'asked about a key that was copied');
    assert.strictEqual(page.newKeyResult, null);
  });

  it('forgets the copy when a new key replaces the banner', async () => {
    const { page, confirms } = loadPage({ clipboard: { writeText: async () => {} }, confirmAnswer: false });
    page.showNewKey({ raw_key: 'shellm-x', action: 'created' });
    await page.copy('key', 'shellm-x');
    page.showNewKey({ raw_key: 'shellm-y', action: 'rotated' });
    page.dismissNewKey();
    assert.strictEqual(confirms.length, 1);
  });

  it('routes the dismiss control through the check', () => {
    assert.match(markup(), /@click="dismissNewKey\(\)"/);
    assert.doesNotMatch(markup(), /@click="newKeyResult = null"/);
  });
});

describe('Keys: markup', () => {
  it('offers the create action from the empty table, keeping its header', () => {
    const html = markup();
    const start = html.indexOf('No keys created yet');
    const cell = html.slice(start, html.indexOf('</td>', start));
    assert.match(cell, /@click="openCreate\(\)"[^>]*>\s*\+ Create Key\s*</);
    assert.ok(html.indexOf('<thead') < start, 'the table header is gone');
  });

  it('uses the brand button for Save', () => {
    const html = markup();
    assert.match(html, /@click="saveEdit\(key\)"\s+class="btn-brand /);
  });

  it('titles the page with its one h1', () => {
    const html = markup();
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1);
    assert.strictEqual((html.match(/<h2[\s>]/g) || []).length, 0);
  });

  it('hides every icon ligature from screen readers', () => {
    const icons = markup().match(/<span[^>]*material-symbols-outlined[^>]*>/g) || [];
    assert.ok(icons.length >= 8);
    for (const icon of icons) assert.match(icon, /aria-hidden="true"/, icon);
  });

  it('binds every label to a control that exists', () => {
    const html = markup();
    const labels = html.match(/<label[^>]*>/g) || [];
    assert.strictEqual(labels.length, 12);
    for (const label of labels) {
      const [, bound, target] = label.match(/(:?)for="([^"]+)"/) || [];
      assert.ok(target, `unbound label: ${label}`);
      const id = bound ? `:id="${target}"` : `id="${target}"`;
      assert.ok(html.includes(id), `no control carries ${id}`);
    }
  });
});
