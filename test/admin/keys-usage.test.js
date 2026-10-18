'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const { compose } = require('../../src/admin/views');

const scrolled = [];

function loadKeys(origin, clipboard, realTimers = false) {
  const stores = {};
  const context = vm.createContext({
    AbortSignal,
    console, Intl, Date, URLSearchParams,
    Alpine: { store: (n, v) => (v === undefined ? stores[n] : (stores[n] = v)) },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }),
    navigator: { onLine: true, clipboard },
    setTimeout: realTimers ? setTimeout : (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {}, location: { origin }, scrollTo: (...a) => scrolled.push(a) },
    document: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'keys.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return context.keysPage();
}

const keysPageHtml = () => {
  const html = compose();
  const start = html.indexOf('<!-- KEYS PAGE -->');
  const end = html.indexOf('<!-- Table -->', start);
  assert.ok(start > -1 && end > start, 'the Keys page still starts with its banner and header');
  const page = html.slice(start, end);
  return page;
};

describe('a created key says where to send it', () => {
  it('reads the base URL off the origin the operator is already on', () => {
    assert.strictEqual(loadKeys('https://shellm.example.dev').baseUrl, 'https://shellm.example.dev');
    assert.strictEqual(loadKeys('http://127.0.0.1:6100').baseUrl, 'http://127.0.0.1:6100');
  });

  // It answers "where do I send this?", which is asked long after the banner that created the key
  // was dismissed — so it cannot live inside that banner.
  it('states the base URL outside the banner that only a fresh key shows', () => {
    const html = compose();
    const start = html.indexOf('<!-- How a key is used -->');
    const end = html.indexOf('<!-- Table -->', start);
    assert.ok(start > -1 && end > start, 'the usage block is still a section of the Keys page');
    const usage = html.slice(start, end);

    assert.match(usage, /x-text="baseUrl"/);
    assert.doesNotMatch(usage, /x-show="newKeyResult"/, 'the usage block does not disappear with the banner');
  });

  // The asymmetry is the whole reason the two lines are separate: an OpenAI client appends nothing
  // to the base URL and an Anthropic one appends /v1, so one shared value breaks one of them.
  it('gives the OpenAI base URL a /v1 the Anthropic one must not have', () => {
    const page = loadKeys('https://shellm.example.dev');
    page.newKeyResult = { raw_key: 'shellm-deadbeef', action: 'created' };
    const [openai, anthropic] = page.snippets;

    assert.deepEqual([openai.id, anthropic.id], ['openai', 'anthropic']);
    assert.match(openai.command, /OPENAI_BASE_URL=https:\/\/shellm\.example\.dev\/v1 /);
    assert.match(anthropic.command, /ANTHROPIC_BASE_URL=https:\/\/shellm\.example\.dev /);
    assert.doesNotMatch(anthropic.command, /ANTHROPIC_BASE_URL=\S+\/v1/);
    for (const s of [openai, anthropic]) assert.match(s.command, /shellm-deadbeef$/);
  });

  it('says what each line is for, so neither is a wall of shell', () => {
    const page = loadKeys('https://shellm.example.dev');
    page.newKeyResult = { raw_key: 'shellm-deadbeef', action: 'created' };
    for (const s of page.snippets) {
      assert.ok(s.label.length > 0 && s.help.length > 0, `${s.id} carries a label and a help line`);
    }
  });

  it('has nothing to show before a key is created', () => {
    assert.strictEqual(loadKeys('https://shellm.example.dev').snippets.length, 0);
  });

  it('marks what it copied, and hands the mark to a timer to take back', async () => {
    const written = [];
    const clip = { writeText: async (t) => written.push(t) };

    const page = loadKeys('https://shellm.example.dev', clip, true);
    await page.copy('base', 'https://shellm.example.dev');
    assert.strictEqual(written[0], 'https://shellm.example.dev');
    assert.strictEqual(page.copied, 'base');
    assert.strictEqual(page.copyError, null);

    // The harness' default setTimeout fires at once, so this second page shows the reset the first
    // one is still waiting on — without the test sleeping for it.
    const fastForward = loadKeys('https://shellm.example.dev', clip);
    await fastForward.copy('base', 'https://shellm.example.dev');
    await Promise.resolve();
    assert.strictEqual(fastForward.copied, null);
  });

  // An insecure origin has no navigator.clipboard at all, and a button that silently does nothing
  // is worse than one that says the text has to be selected by hand.
  it('reports a clipboard it could not reach instead of pretending', async () => {
    const page = loadKeys('http://192.168.1.10:6100', undefined);
    await page.copy('key', 'shellm-deadbeef');
    assert.strictEqual(page.copied, null);
    assert.strictEqual(page.copyError, 'key');

    const refused = loadKeys('https://shellm.example.dev', { writeText: async () => { throw new Error('denied'); } });
    await refused.copy('key', 'shellm-deadbeef');
    assert.strictEqual(refused.copyError, 'key');
  });

  // A key is shown once. Everyone who did not copy it then still has to know the shape of the two
  // lines, so the page states them with a placeholder rather than only at creation.
  it('states both lines with a placeholder, for keys that already exist', () => {
    const page = loadKeys('https://shellm.example.dev');
    assert.strictEqual(page.newKeyResult, null);
    const [openai, anthropic] = page.sampleSnippets;

    assert.match(openai.command, /OPENAI_API_KEY=\$SHELLM_KEY$/);
    assert.match(anthropic.command, /ANTHROPIC_API_KEY=\$SHELLM_KEY$/);
    assert.doesNotMatch(anthropic.command, /ANTHROPIC_BASE_URL=\S+\/v1/);
  });

  it('keeps the sample copy buttons from claiming the real key was copied', () => {
    const page = keysPageHtml();
    assert.match(page, /copy\('sample-' \+ snippet\.id \+ ':export', snippet\.command\)/);
    assert.match(page, /copy\(snippet\.id \+ ':export', snippet\.command\)/);
  });

  // Pasted into a tool's base-URL field, the whole line has to be cut back down by hand.
  it('copies one value on its own', async () => {
    const written = [];
    const page = loadKeys('https://shellm.example.dev', { writeText: async (t) => written.push(t) }, true);
    page.newKeyResult = { raw_key: 'shellm-deadbeef', action: 'created' };
    const url = page.snippets[0].vars.find((v) => v.name === 'OPENAI_BASE_URL');
    await page.copy('openai:' + url.name, url.value);
    assert.deepStrictEqual(written, ['https://shellm.example.dev/v1']);
    assert.strictEqual(page.keyCopied, false, 'copying the URL counted as copying the key');
  });

  it('copies a snippet as .env lines, one variable per line and no export', () => {
    const page = loadKeys('https://shellm.example.dev');
    page.newKeyResult = { raw_key: 'shellm-deadbeef', action: 'created' };
    const [openai, anthropic] = page.snippets;
    assert.strictEqual(openai.env, 'OPENAI_BASE_URL=https://shellm.example.dev/v1\nOPENAI_API_KEY=shellm-deadbeef');
    assert.strictEqual(anthropic.env, 'ANTHROPIC_BASE_URL=https://shellm.example.dev\nANTHROPIC_API_KEY=shellm-deadbeef');
  });

  it('counts the bare key copied from a snippet as the key copied', async () => {
    const page = loadKeys('https://shellm.example.dev', { writeText: async () => {} }, true);
    page.newKeyResult = { raw_key: 'shellm-deadbeef', action: 'created' };
    const key = page.snippets[0].vars.find((v) => v.name === 'OPENAI_API_KEY');
    await page.copy('openai:' + key.name, key.value);
    assert.strictEqual(page.keyCopied, true);
  });

  it('offers no control that copies the placeholder as if it were a key', () => {
    const page = loadKeys('https://shellm.example.dev');
    for (const snippet of page.sampleSnippets) {
      const key = snippet.vars.find((v) => v.value === '$SHELLM_KEY');
      assert.strictEqual(key.copyable, false, `${snippet.id} copies the placeholder on its own`);
    }
    assert.match(keysPageHtml(), /x-show="v\.copyable"/, 'the value control ignores copyable');
  });

  // The string is authored on the canvas first and the artboard renders it verbatim, so a silent
  // edit here is a drift the drawing cannot report. It is also the only thing on that form saying
  // the field is a browser mechanism at all.
  it('says the origins field is a browser mechanism, in the words the artboard draws', () => {
    const html = compose();
    const start = html.indexOf('<!-- Create Key Modal -->');
    assert.ok(start > -1, 'the create modal is still part of the Keys page');
    const modal = html.slice(start);
    assert.match(modal, /Browsers only — a caller that sends no Origin header is never checked against this\./);
  });

  it('offers a copy control for the base URL and for every snippet', () => {
    const page = keysPageHtml();
    assert.match(page, /@click="copy\('base', baseUrl\)"/);
    assert.match(page, /@click="copy\('key', newKeyResult\?\.raw_key\)"/);
    assert.match(page, /@click="copy\(snippet\.id \+ ':env', snippet\.env\)"/);
    assert.match(page, /@click="copy\(snippet\.id \+ ':' \+ v\.name, v\.value\)"/);
  });

  // Both endpoints return raw_key, so a banner that infers the verb from its presence can only
  // ever say one of the two words.
  // Shown once, rendered at the top of the page, and created from a modal that can be opened with
  // the table scrolled down — without this the one glimpse of the key is off-screen.
  it('brings the banner into view when a key is created', () => {
    const page = loadKeys('https://shellm.example.dev');
    const before = scrolled.length;
    page.showNewKey({ raw_key: 'shellm-deadbeef', action: 'created' });
    assert.strictEqual(page.newKeyResult.raw_key, 'shellm-deadbeef');
    assert.deepEqual(scrolled[before], [0, 0]);
  });

  it('routes both the create and the rotate path through it', () => {
    const src = fs.readFileSync(path.join(JS_DIR, 'keys.js'), 'utf8');
    assert.strictEqual((src.match(/this\.showNewKey\(/g) || []).length, 2);
    assert.doesNotMatch(src, /this\.newKeyResult = \{/, 'nothing assigns the banner around showNewKey');
  });

  // An icon-only control has no name without one, and the dashboard installs on a phone, where
  // there is no hover and title never fires. aria-label is the only label those callers get.
  it('names every row action, since none of them carries a word any more', () => {
    const html = compose();
    const anchor = html.indexOf('@click="startEdit(key)"');
    const start = html.lastIndexOf('<div', anchor);
    const end = html.indexOf('</td>', anchor);
    assert.ok(anchor > -1 && start > -1 && end > anchor, 'the row actions are still a cell of the Keys table');
    const cell = html.slice(start, end);

    const buttons = cell.match(/<button[\s\S]*?>/g) || [];
    assert.strictEqual(buttons.length, 3, 'edit, rotate and delete');
    for (const b of buttons) assert.match(b, /aria-label="[^"]+"/, `unnamed action: ${b.slice(0, 60)}`);
    assert.doesNotMatch(cell, />\s*(Edit|Rotate|Delete)\s*</, 'the words are gone, so the labels carry the meaning');
  });

  // The product keeps its other destructive action's label (Delete logs). This one gave its word up,
  // so the colour is what is left to say it is not the other two.
  it('keeps the destructive action visually apart from the safe ones', () => {
    const html = compose();
    const start = html.indexOf('@click="deleteKey(key)"');
    assert.ok(start > -1);
    assert.match(html.slice(start - 200, start + 200), /text-error/);
  });

  it('calls a rotation a rotation', () => {
    const page = keysPageHtml();
    assert.match(page, /x-text="newKeyResult\?\.action"/);
    assert.doesNotMatch(page, /'created' : 'rotated'/);
  });
});
