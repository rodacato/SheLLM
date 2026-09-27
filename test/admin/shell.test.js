'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHELL = path.join(__dirname, '../../src/admin/views/index.html');

describe('the shell can be read without seeing it', () => {
  let html;
  before(() => { html = fs.readFileSync(SHELL, 'utf8'); });

  // A screen reader read the ligature names aloud: "settings_heart System".
  it('hides every icon ligature from assistive technology', () => {
    const icons = [...html.matchAll(/<span class="material-symbols-outlined[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.ok(icons.length >= 4, `found ${icons.length} icons — this check proves nothing`);
    for (const icon of icons) assert.match(icon, /aria-hidden="true"/, icon);
  });

  it('announces the degraded banner as a status', () => {
    const banner = /<div x-show="\$store\.connection\.degraded"[^>]*>/.exec(html);
    assert.ok(banner, 'the degraded banner is gone');
    assert.match(banner[0], /role="status"/);
  });

  // Buttons could not be opened in another tab, although every page already has a hash.
  it('makes every nav item a link to its page, marked when current', () => {
    const nav = /<nav[\s\S]*?<\/nav>/.exec(html)[0];
    assert.match(nav, /<a\s[^>]*:href="'#' \+ item\.id"/);
    assert.match(nav, /:aria-current="page === item\.id \? 'page' : null"/);
    assert.doesNotMatch(nav, /<button/);
  });
});

// Uptime showed twice and the brand three times; while degraded, two clocks disagreed on screen.
describe('the footer carries only the read stamp', () => {
  let footer;
  before(() => { footer = /<footer[\s\S]*?<\/footer>/.exec(fs.readFileSync(SHELL, 'utf8'))[0]; });

  it('drops the uptime and the brand the sidebar already shows', () => {
    assert.doesNotMatch(footer, /uptime/i);
    assert.doesNotMatch(footer, /SheLLM/);
    assert.match(footer, /'Read ' \+ lastReadAt/);
  });

  it('steps aside while the banner shows its own last read', () => {
    assert.match(footer, /x-show="lastReadAt && !\$store\.connection\.degraded"/);
  });
});
