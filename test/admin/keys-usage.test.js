'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');
const { compose } = require('../../src/admin/views');

function loadKeys(origin) {
  const stores = {};
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams,
    Alpine: { store: (n, v) => (v === undefined ? stores[n] : (stores[n] = v)) },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }),
    navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', replace: () => {} },
    window: { addEventListener: () => {}, location: { origin } },
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

  it('shows the header base URL whether or not a key was just created', () => {
    const page = keysPageHtml();
    assert.match(page, /x-text="baseUrl"/);
  });

  // The asymmetry is the whole reason the snippet exists: an OpenAI client appends nothing to the
  // base URL and an Anthropic one appends /v1, so a single shared value breaks one of them.
  it('gives the OpenAI base URL a /v1 the Anthropic one must not have', () => {
    const page = loadKeys('https://shellm.example.dev');
    page.newKeyResult = { raw_key: 'shellm-deadbeef', action: 'created' };
    const [openai, anthropic] = page.usageSnippet.split('\n');

    assert.match(openai, /OPENAI_BASE_URL=https:\/\/shellm\.example\.dev\/v1 /);
    assert.match(anthropic, /ANTHROPIC_BASE_URL=https:\/\/shellm\.example\.dev /);
    assert.doesNotMatch(anthropic, /ANTHROPIC_BASE_URL=\S+\/v1/);
    for (const line of [openai, anthropic]) assert.match(line, /shellm-deadbeef$/);
  });

  it('has nothing to show before a key is created', () => {
    assert.strictEqual(loadKeys('https://shellm.example.dev').usageSnippet, '');
  });

  // Both endpoints return raw_key, so a banner that infers the verb from its presence can only
  // ever say one of the two words.
  it('calls a rotation a rotation', () => {
    const page = keysPageHtml();
    assert.match(page, /x-text="newKeyResult\?\.action"/);
    assert.doesNotMatch(page, /'created' : 'rotated'/);
  });
});
