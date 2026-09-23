'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '../../src/admin/public/js');

// The page's own file, loaded the way the browser loads it.
function loadKeysPage() {
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams, Set,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    navigator: { onLine: true },
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {}, setInterval: () => 0,
    location: { pathname: '/admin/dashboard', hash: '', origin: 'https://shellm.example', replace: () => {} },
    window: { addEventListener: () => {}, location: { origin: 'https://shellm.example' } },
    document: { addEventListener: () => {} },
  });
  for (const file of ['app.js', 'keys.js']) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), context, { filename: file });
  }
  return context.keysPage();
}

const markup = () => fs.readFileSync(path.join(__dirname, '../../src/admin/views/pages/keys.html'), 'utf8');

describe('the connection card on the Keys page', () => {
  // It is the copy you come back to: creating a key already hands you the same two lines with the
  // key filled in, so this one earns no space on arrival.
  it('is shut until someone asks for it', () => {
    assert.strictEqual(loadKeysPage().connectionOpen, false);
  });

  it('shows the address while it is shut, so the quick look costs no click', () => {
    const html = markup();
    assert.match(html, /x-show="!connectionOpen"[^>]*x-text="baseUrl"/, 'the header hides the address it exists to show');
  });

  it('keeps the SDK lines behind the disclosure rather than deleting them', () => {
    const html = markup();
    assert.match(html, /x-show="connectionOpen"/, 'the card no longer collapses');
    assert.match(html, /x-for="snippet in placeholderSnippets"|x-for="snippet in snippets"/, 'the SDK lines are gone');
    assert.ok(html.includes('$SHELLM_KEY'), 'the note explaining the placeholder went with them');
  });

  it('still hands the key-created banner its own filled-in copy', () => {
    const html = markup();
    const banner = html.slice(0, html.indexOf('connectionOpen'));
    assert.match(banner, /x-for="snippet in snippets"/, 'the banner lost the lines that carry the real key');
  });
});
